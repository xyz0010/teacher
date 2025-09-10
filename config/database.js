const isProduction = process.env.VERCEL || process.env.NODE_ENV === 'production';

let db;

if (isProduction) {
  // 生产环境：使用PostgreSQL (Railway/Vercel Postgres)
  const { Pool } = require('pg');
  
  // Railway使用DATABASE_URL，Vercel使用POSTGRES_URL
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  
  db = new Pool({
    connectionString: connectionString,
    ssl: connectionString && connectionString.includes('localhost') ? false : {
      rejectUnauthorized: false
    }
  });
  
  // PostgreSQL查询方法
  db.query = async (text, params) => {
    const client = await db.connect();
    try {
      const result = await client.query(text, params);
      return result;
    } finally {
      client.release();
    }
  };
  
  // 初始化数据表
  db.initialize = async () => {
    try {
      // 创建学生图片表
      await db.query(`
        CREATE TABLE IF NOT EXISTS student_images (
          id SERIAL PRIMARY KEY,
          student_name VARCHAR(100) NOT NULL,
          student_id VARCHAR(50) NOT NULL,
          filename VARCHAR(255),
          original_name VARCHAR(255),
          file_url TEXT,
          file_size INTEGER,
          upload_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // 创建点评表
      await db.query(`
        CREATE TABLE IF NOT EXISTS reviews (
          id SERIAL PRIMARY KEY,
          image_id INTEGER REFERENCES student_images(id),
          teacher_name VARCHAR(100) NOT NULL,
          score INTEGER CHECK(score >= 0 AND score <= 100),
          comment TEXT,
          review_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // 创建点赞表
      await db.query(`
        CREATE TABLE IF NOT EXISTS likes (
          id SERIAL PRIMARY KEY,
          image_id INTEGER REFERENCES student_images(id),
          student_name VARCHAR(100) NOT NULL,
          student_id VARCHAR(50) NOT NULL,
          like_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(image_id, student_id)
        )
      `);
      
      console.log('PostgreSQL数据库初始化完成');
    } catch (error) {
      console.error('数据库初始化失败:', error);
    }
  };
  
} else {
  // 开发环境：使用SQLite
  const sqlite3 = require('sqlite3').verbose();
  
  db = new sqlite3.Database('student_images.db');
  
  // SQLite查询方法适配
  db.query = (text, params = []) => {
    return new Promise((resolve, reject) => {
      // 转换PostgreSQL语法到SQLite
      let sqliteQuery = text
        .replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT')
        .replace(/TIMESTAMP DEFAULT CURRENT_TIMESTAMP/g, 'DATETIME DEFAULT CURRENT_TIMESTAMP')
        .replace(/VARCHAR\(\d+\)/g, 'TEXT')
        .replace(/REFERENCES\s+\w+\(\w+\)/g, '')
        .replace(/\$\d+/g, '?'); // 替换参数占位符
      
      if (text.toUpperCase().startsWith('SELECT') || text.toUpperCase().startsWith('INSERT') || text.toUpperCase().startsWith('UPDATE') || text.toUpperCase().startsWith('DELETE')) {
        if (text.toUpperCase().startsWith('SELECT')) {
          db.all(sqliteQuery, params, (err, rows) => {
            if (err) reject(err);
            else resolve({ rows });
          });
        } else {
          db.run(sqliteQuery, params, function(err) {
            if (err) reject(err);
            else resolve({ rowCount: this.changes, insertId: this.lastID });
          });
        }
      } else {
        // CREATE TABLE等DDL语句
        db.run(sqliteQuery, params, (err) => {
          if (err) reject(err);
          else resolve({ rowCount: 0 });
        });
      }
    });
  };
  
  // 初始化数据表
  db.initialize = async () => {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS student_images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_name TEXT NOT NULL,
          student_id TEXT NOT NULL,
          filename TEXT,
          original_name TEXT,
          file_url TEXT,
          file_size INTEGER,
          upload_time DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      await db.query(`
        CREATE TABLE IF NOT EXISTS reviews (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          image_id INTEGER NOT NULL,
          teacher_name TEXT NOT NULL,
          score INTEGER CHECK(score >= 0 AND score <= 100),
          comment TEXT,
          review_time DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      await db.query(`
        CREATE TABLE IF NOT EXISTS likes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          image_id INTEGER NOT NULL,
          student_name TEXT NOT NULL,
          student_id TEXT NOT NULL,
          like_time DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(image_id, student_id)
        )
      `);
      
      console.log('SQLite数据库初始化完成');
    } catch (error) {
      console.error('数据库初始化失败:', error);
    }
  };
}

module.exports = db;