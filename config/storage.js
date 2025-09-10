const isProduction = process.env.VERCEL || process.env.NODE_ENV === 'production';
const useSupabase = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY;

let storage;

if (isProduction && useSupabase) {
  // 生产环境：使用Supabase存储
  const { supabaseDB } = require('./supabase');
  
  storage = {
    // 上传文件
    upload: async (file, filename) => {
      try {
        const bucket = 'student-images';
        const path = `uploads/${Date.now()}-${filename}`;
        
        const result = await supabaseDB.uploadFile(bucket, path, file);
        
        return {
          success: result.success,
          url: result.url,
          filename: result.filename || filename,
          size: file.size || 0,
          error: result.error
        };
      } catch (error) {
        console.error('Supabase upload error:', error);
        return {
          success: false,
          error: error.message
        };
      }
    },
    
    // 删除文件
    delete: async (filename) => {
      try {
        const bucket = 'student-images';
        const path = `uploads/${filename}`;
        
        const result = await supabaseDB.deleteFile(bucket, path);
        return result;
      } catch (error) {
        console.error('Supabase delete error:', error);
        return { success: false, error: error.message };
      }
    },
    
    // 获取文件URL
    getUrl: (filename) => {
      // Supabase会返回完整的URL
      return filename;
    }
  };
  
} else if (isProduction) {
  // 生产环境：使用Vercel Blob存储
  const { put, del } = require('@vercel/blob');
  
  storage = {
    // 上传文件
    upload: async (file, filename) => {
      try {
        const blob = await put(filename, file, {
          access: 'public',
        });
        
        return {
          success: true,
          url: blob.url,
          filename: filename,
          size: file.size || 0
        };
      } catch (error) {
        console.error('Blob upload error:', error);
        return {
          success: false,
          error: error.message
        };
      }
    },
    
    // 删除文件
    delete: async (url) => {
      try {
        await del(url);
        return { success: true };
      } catch (error) {
        console.error('Blob delete error:', error);
        return { success: false, error: error.message };
      }
    },
    
    // 获取文件URL
    getUrl: (filename) => {
      // Vercel Blob会返回完整的URL
      return filename;
    }
  };
  
} else {
  // 开发环境：使用本地文件存储
  const multer = require('multer');
  const path = require('path');
  const fs = require('fs-extra');
  const { v4: uuidv4 } = require('uuid');
  
  // 确保uploads目录存在
  fs.ensureDirSync('uploads');
  
  const localStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
      const uniqueName = uuidv4() + path.extname(file.originalname);
      cb(null, uniqueName);
    }
  });
  
  const upload = multer({
    storage: localStorage,
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
        cb(new Error('只支持图片文件 (JPEG, JPG, PNG, GIF, WebP)'));
      }
    }
  });
  
  storage = {
    // Multer中间件
    middleware: upload.single('image'),
    
    // 上传文件（本地环境通过multer处理）
    upload: async (req) => {
      return new Promise((resolve, reject) => {
        storage.middleware(req, {}, (err) => {
          if (err) {
            resolve({
              success: false,
              error: err.message
            });
          } else if (!req.file) {
            resolve({
              success: false,
              error: '请选择要上传的图片'
            });
          } else {
            resolve({
              success: true,
              url: `/uploads/${req.file.filename}`,
              filename: req.file.filename,
              originalName: req.file.originalname,
              size: req.file.size,
              path: req.file.path
            });
          }
        });
      });
    },
    
    // 删除文件
    delete: async (filename) => {
      try {
        const filePath = path.join('uploads', filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        return { success: true };
      } catch (error) {
        console.error('Local file delete error:', error);
        return { success: false, error: error.message };
      }
    },
    
    // 获取文件URL
    getUrl: (filename) => {
      return `/uploads/${filename}`;
    }
  };
}

module.exports = storage;