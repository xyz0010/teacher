const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// 确保上传目录存在
fs.ensureDirSync('uploads');
fs.ensureDirSync('public');

// 配置multer用于文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueName = uuidv4() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB限制
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('只允许上传图片文件'));
    }
  }
});

// 初始化数据库
const db = new sqlite3.Database('student_images.db');

db.serialize(() => {
  // 创建学生图片表
  db.run(`CREATE TABLE IF NOT EXISTS student_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_name TEXT NOT NULL,
    student_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    upload_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    file_path TEXT NOT NULL,
    file_size INTEGER
  )`);
  
  // 创建点评表
  db.run(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_id INTEGER NOT NULL,
    teacher_name TEXT NOT NULL,
    score INTEGER NOT NULL CHECK(score >= 0 AND score <= 100),
    comment TEXT,
    review_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (image_id) REFERENCES student_images (id)
  )`);
  
  // 创建点赞表
  db.run(`CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_id INTEGER NOT NULL,
    student_name TEXT NOT NULL,
    student_id TEXT NOT NULL,
    like_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (image_id) REFERENCES student_images (id),
    UNIQUE(image_id, student_id)
  )`);
});

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
app.post('/api/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请选择要上传的图片' });
    }
    
    const { studentName, studentId } = req.body;
    
    if (!studentName || !studentId) {
      return res.status(400).json({ error: '请填写学生姓名和学号' });
    }
    
    const stmt = db.prepare(`INSERT INTO student_images 
      (student_name, student_id, filename, original_name, file_path, file_size) 
      VALUES (?, ?, ?, ?, ?, ?)`);
    
    stmt.run([
      studentName,
      studentId,
      req.file.filename,
      req.file.originalname,
      req.file.path,
      req.file.size
    ], function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: '数据库保存失败' });
      }
      
      res.json({
        message: '图片上传成功',
        imageId: this.lastID,
        filename: req.file.filename
      });
    });
    
    stmt.finalize();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '上传失败' });
  }
});

// 获取所有待点评的图片
app.get('/api/images', (req, res) => {
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
  
  db.all(query, [], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: '获取图片列表失败' });
    }
    
    res.json(rows);
  });
});

// 点赞作品
app.post('/api/like', (req, res) => {
  const { imageId, studentName, studentId } = req.body;
  
  if (!imageId || !studentName || !studentId) {
    return res.status(400).json({ error: '请提供完整的点赞信息' });
  }
  
  const stmt = db.prepare(`INSERT INTO likes (image_id, student_name, student_id) VALUES (?, ?, ?)`);
  
  stmt.run([imageId, studentName, studentId], function(err) {
    if (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: '您已经点赞过这个作品了' });
      }
      console.error(err);
      return res.status(500).json({ error: '点赞失败' });
    }
    
    res.json({ message: '点赞成功' });
  });
  
  stmt.finalize();
});

// 取消点赞
app.delete('/api/like', (req, res) => {
  const { imageId, studentId } = req.body;
  
  if (!imageId || !studentId) {
    return res.status(400).json({ error: '请提供完整的信息' });
  }
  
  db.run('DELETE FROM likes WHERE image_id = ? AND student_id = ?', [imageId, studentId], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: '取消点赞失败' });
    }
    
    if (this.changes === 0) {
      return res.status(404).json({ error: '未找到点赞记录' });
    }
    
    res.json({ message: '取消点赞成功' });
  });
});

// 检查用户是否已点赞
app.get('/api/like-status/:imageId/:studentId', (req, res) => {
  const { imageId, studentId } = req.params;
  
  db.get('SELECT id FROM likes WHERE image_id = ? AND student_id = ?', [imageId, studentId], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: '查询点赞状态失败' });
    }
    
    res.json({ liked: !!row });
  });
});

// 教师提交点评
app.post('/api/review', (req, res) => {
  const { imageId, teacherName, score, comment } = req.body;
  
  if (!imageId || !teacherName || score === undefined) {
    return res.status(400).json({ error: '请填写完整的点评信息' });
  }
  
  if (score < 0 || score > 100) {
    return res.status(400).json({ error: '分数必须在0-100之间' });
  }
  
  // 检查是否已经点评过
  db.get('SELECT id FROM reviews WHERE image_id = ?', [imageId], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: '数据库查询失败' });
    }
    
    if (row) {
      // 更新现有点评
      const stmt = db.prepare(`UPDATE reviews 
        SET teacher_name = ?, score = ?, comment = ?, review_time = CURRENT_TIMESTAMP 
        WHERE image_id = ?`);
      
      stmt.run([teacherName, score, comment, imageId], function(err) {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: '更新点评失败' });
        }
        
        res.json({ message: '点评更新成功' });
      });
      
      stmt.finalize();
    } else {
      // 创建新点评
      const stmt = db.prepare(`INSERT INTO reviews 
        (image_id, teacher_name, score, comment) 
        VALUES (?, ?, ?, ?)`);
      
      stmt.run([imageId, teacherName, score, comment], function(err) {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: '保存点评失败' });
        }
        
        res.json({ message: '点评提交成功' });
      });
      
      stmt.finalize();
    }
  });
});

// 删除图片
app.delete('/api/images/:id', (req, res) => {
  const imageId = req.params.id;
  
  // 先获取文件路径
  db.get('SELECT file_path FROM student_images WHERE id = ?', [imageId], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: '查询失败' });
    }
    
    if (!row) {
      return res.status(404).json({ error: '图片不存在' });
    }
    
    // 删除文件
    fs.remove(row.file_path, (err) => {
      if (err) {
        console.error('删除文件失败:', err);
      }
    });
    
    // 删除数据库记录
    db.run('DELETE FROM reviews WHERE image_id = ?', [imageId]);
    db.run('DELETE FROM student_images WHERE id = ?', [imageId], function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: '删除失败' });
      }
      
      res.json({ message: '删除成功' });
    });
  });
});

// 提供静态文件服务
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
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('数据库连接已关闭');
    process.exit(0);
  });
});