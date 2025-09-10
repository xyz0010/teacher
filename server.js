const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');

// 导入配置
const db = require('./config/database');
const storage = require('./config/storage');

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// 在非生产环境中提供uploads静态文件服务
if (!process.env.VERCEL && process.env.NODE_ENV !== 'production') {
  fs.ensureDirSync('uploads');
  app.use('/uploads', express.static('uploads'));
}

// 初始化数据库
(async () => {
  try {
    await db.initialize();
    console.log('数据库初始化完成');
  } catch (error) {
    console.error('数据库初始化失败:', error);
  }
})();

// 邀请码配置
const INVITE_CODES = {
  teacher: 'TEACHER2024',
  student: 'STUDENT2024'
};

// API路由

// 验证邀请码
app.post('/api/verify-invite', (req, res) => {
  const { inviteCode } = req.body;
  
  if (!inviteCode) {
    return res.status(400).json({ error: '请输入邀请码' });
  }
  
  let role = null;
  if (inviteCode === INVITE_CODES.teacher) {
    role = 'teacher';
  } else if (inviteCode === INVITE_CODES.student) {
    role = 'student';
  } else {
    return res.status(401).json({ error: '邀请码无效' });
  }
  
  res.json({ 
    success: true, 
    role: role,
    message: `欢迎${role === 'teacher' ? '教师' : '学生'}！`
  });
});

// 学生上传图片
app.post('/api/upload', async (req, res) => {
  try {
    const isProduction = process.env.VERCEL || process.env.NODE_ENV === 'production';
    
    if (isProduction) {
      // 生产环境：使用云存储
      const { imageData, studentName, studentId, filename } = req.body;
      
      if (!imageData || !studentName || !studentId) {
        return res.status(400).json({ error: '请填写完整信息并选择图片' });
      }
      
      // 将base64转换为Buffer
      const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      
      // 上传到云存储
      const uploadResult = await storage.upload(buffer, filename || `${Date.now()}.jpg`);
      
      if (!uploadResult.success) {
        return res.status(500).json({ error: uploadResult.error });
      }
      
      // 保存到数据库
      const result = await db.query(
        'INSERT INTO student_images (student_name, student_id, filename, original_name, file_url, file_size) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [studentName, studentId, uploadResult.filename, filename, uploadResult.url, uploadResult.size]
      );
      
      res.json({
        message: '图片上传成功',
        imageId: result.rows[0].id,
        filename: uploadResult.filename,
        url: uploadResult.url
      });
      
    } else {
      // 开发环境：使用本地存储
      const uploadResult = await storage.upload(req);
      
      if (!uploadResult.success) {
        return res.status(400).json({ error: uploadResult.error });
      }
      
      const { studentName, studentId } = req.body;
      
      if (!studentName || !studentId) {
        return res.status(400).json({ error: '请填写学生姓名和学号' });
      }
      
      // 保存到数据库
      const result = await db.query(
        'INSERT INTO student_images (student_name, student_id, filename, original_name, file_url, file_size) VALUES (?, ?, ?, ?, ?, ?)',
        [studentName, studentId, uploadResult.filename, uploadResult.originalName, uploadResult.url, uploadResult.size]
      );
      
      res.json({
        message: '图片上传成功',
        imageId: result.insertId,
        filename: uploadResult.filename
      });
    }
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: '服务器错误，请稍后重试',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 获取所有图片
app.get('/api/images', async (req, res) => {
  try {
    const query = `
      SELECT 
        si.*,
        r.score,
        r.comment,
        r.teacher_name,
        r.review_time,
        COUNT(l.id) as like_count
      FROM student_images si
      LEFT JOIN reviews r ON si.id = r.image_id
      LEFT JOIN likes l ON si.id = l.image_id
      GROUP BY si.id
      ORDER BY si.upload_time DESC
    `;
    
    const result = await db.query(query);
    res.json(result.rows || result);
  } catch (error) {
    console.error('Get images error:', error);
    res.status(500).json({ error: '获取图片列表失败' });
  }
});

// 点赞作品
app.post('/api/like', async (req, res) => {
  try {
    const { imageId, studentName, studentId } = req.body;
    
    if (!imageId || !studentName || !studentId) {
      return res.status(400).json({ error: '请提供完整的点赞信息' });
    }
    
    const isProduction = process.env.VERCEL || process.env.NODE_ENV === 'production';
    
    if (isProduction) {
      await db.query(
        'INSERT INTO likes (image_id, student_name, student_id) VALUES ($1, $2, $3)',
        [imageId, studentName, studentId]
      );
    } else {
      await db.query(
        'INSERT INTO likes (image_id, student_name, student_id) VALUES (?, ?, ?)',
        [imageId, studentName, studentId]
      );
    }
    
    res.json({ message: '点赞成功' });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === '23505') {
      return res.status(409).json({ error: '您已经点赞过这个作品了' });
    }
    console.error('Like error:', error);
    res.status(500).json({ error: '点赞失败' });
  }
});

// 取消点赞
app.delete('/api/like', async (req, res) => {
  try {
    const { imageId, studentId } = req.body;
    
    if (!imageId || !studentId) {
      return res.status(400).json({ error: '请提供完整的信息' });
    }
    
    const isProduction = process.env.VERCEL || process.env.NODE_ENV === 'production';
    
    if (isProduction) {
      await db.query('DELETE FROM likes WHERE image_id = $1 AND student_id = $2', [imageId, studentId]);
    } else {
      await db.query('DELETE FROM likes WHERE image_id = ? AND student_id = ?', [imageId, studentId]);
    }
    
    res.json({ message: '取消点赞成功' });
  } catch (error) {
    console.error('Unlike error:', error);
    res.status(500).json({ error: '取消点赞失败' });
  }
});

// 检查用户是否已点赞
app.get('/api/like-status/:imageId/:studentId', async (req, res) => {
  try {
    const { imageId, studentId } = req.params;
    
    const isProduction = process.env.VERCEL || process.env.NODE_ENV === 'production';
    
    let result;
    if (isProduction) {
      result = await db.query('SELECT id FROM likes WHERE image_id = $1 AND student_id = $2', [imageId, studentId]);
    } else {
      result = await db.query('SELECT id FROM likes WHERE image_id = ? AND student_id = ?', [imageId, studentId]);
    }
    
    const liked = (result.rows && result.rows.length > 0) || (result && result.length > 0);
    res.json({ liked });
  } catch (error) {
    console.error('Check like status error:', error);
    res.status(500).json({ error: '查询点赞状态失败' });
  }
});

// 教师提交点评
app.post('/api/review', async (req, res) => {
  try {
    const { imageId, userName, score, comment } = req.body;
    
    if (!imageId || !userName || score === undefined) {
      return res.status(400).json({ error: '请填写完整的点评信息' });
    }
    
    if (score < 0 || score > 100) {
      return res.status(400).json({ error: '分数必须在0-100之间' });
    }
    
    const isProduction = process.env.VERCEL || process.env.NODE_ENV === 'production';
    
    if (isProduction) {
      // 检查是否已有点评
      const existing = await db.query('SELECT id FROM reviews WHERE image_id = $1', [imageId]);
      
      if (existing.rows && existing.rows.length > 0) {
        // 更新现有点评
        await db.query(
          'UPDATE reviews SET teacher_name = $1, score = $2, comment = $3, review_time = CURRENT_TIMESTAMP WHERE image_id = $4',
          [userName, score, comment, imageId]
        );
      } else {
        // 创建新点评
        await db.query(
          'INSERT INTO reviews (image_id, teacher_name, score, comment) VALUES ($1, $2, $3, $4)',
          [imageId, userName, score, comment]
        );
      }
    } else {
      // SQLite版本
      const existing = await db.query('SELECT id FROM reviews WHERE image_id = ?', [imageId]);
      
      if (existing && existing.length > 0) {
        await db.query(
          'UPDATE reviews SET teacher_name = ?, score = ?, comment = ?, review_time = CURRENT_TIMESTAMP WHERE image_id = ?',
          [userName, score, comment, imageId]
        );
      } else {
        await db.query(
          'INSERT INTO reviews (image_id, teacher_name, score, comment) VALUES (?, ?, ?, ?)',
          [imageId, userName, score, comment]
        );
      }
    }
    
    res.json({ message: '点评提交成功' });
  } catch (error) {
    console.error('Review error:', error);
    res.status(500).json({ error: '点评提交失败' });
  }
});

// 删除图片
app.delete('/api/images/:id', async (req, res) => {
  try {
    const imageId = req.params.id;
    
    const isProduction = process.env.VERCEL || process.env.NODE_ENV === 'production';
    
    // 获取图片信息
    let imageResult;
    if (isProduction) {
      imageResult = await db.query('SELECT * FROM student_images WHERE id = $1', [imageId]);
    } else {
      imageResult = await db.query('SELECT * FROM student_images WHERE id = ?', [imageId]);
    }
    
    const image = (imageResult.rows && imageResult.rows[0]) || (imageResult && imageResult[0]);
    
    if (!image) {
      return res.status(404).json({ error: '图片不存在' });
    }
    
    // 删除文件
    if (image.filename) {
      await storage.delete(image.filename);
    }
    
    // 删除数据库记录
    if (isProduction) {
      await db.query('DELETE FROM student_images WHERE id = $1', [imageId]);
    } else {
      await db.query('DELETE FROM student_images WHERE id = ?', [imageId]);
    }
    
    res.json({ message: '图片删除成功' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: '删除失败' });
  }
});

// 主页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log('学生图片上传和点评系统已启动');
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n正在关闭服务器...');
  if (typeof db.close === 'function') {
    db.close();
  }
  process.exit(0);
});