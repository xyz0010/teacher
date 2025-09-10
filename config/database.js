const isProduction = process.env.VERCEL || process.env.NODE_ENV === 'production';
const useSupabase = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY;

let db;

if (isProduction && useSupabase) {
  // 生产环境：使用Supabase
  const { supabaseDB } = require('./supabase');
  
  db = {
    query: async (text, params = []) => {
      // 解析SQL查询并转换为Supabase操作
      const sqlLower = text.toLowerCase().trim();
      
      if (sqlLower.startsWith('select')) {
        return await handleSelectQuery(text, params);
      } else if (sqlLower.startsWith('insert')) {
        return await handleInsertQuery(text, params);
      } else if (sqlLower.startsWith('update')) {
        return await handleUpdateQuery(text, params);
      } else if (sqlLower.startsWith('delete')) {
        return await handleDeleteQuery(text, params);
      } else if (sqlLower.startsWith('create table')) {
        // 创建表的操作在Supabase中通过Dashboard完成
        console.log('Table creation should be done in Supabase Dashboard:', text);
        return { rows: [] };
      } else {
        console.warn('Unsupported SQL query:', text);
        return { rows: [] };
      }
    },
    
    initialize: async () => {
      console.log('Using Supabase database - tables should be created in Supabase Dashboard');
      console.log('Required tables: student_images, reviews, likes');
    }
  };
  
  // SQL查询处理函数
  async function handleSelectQuery(text, params) {
    const { supabaseDB } = require('./supabase');
    
    // 简单的SELECT查询解析
    if (text.includes('student_images') && text.includes('LEFT JOIN')) {
      // 获取图片列表with点赞数
      return await supabaseDB.query('student_images', {
        select: '*, reviews(*), likes(count)',
        orderBy: { column: 'upload_time', ascending: false }
      });
    } else if (text.includes('student_images')) {
      return await supabaseDB.query('student_images', {
        orderBy: { column: 'upload_time', ascending: false }
      });
    } else if (text.includes('reviews')) {
      const imageId = params[0];
      return await supabaseDB.query('reviews', {
        where: { image_id: imageId }
      });
    } else if (text.includes('likes')) {
      if (params.length === 2) {
        return await supabaseDB.query('likes', {
          where: { image_id: params[0], student_id: params[1] }
        });
      }
      return await supabaseDB.query('likes');
    }
    return { rows: [] };
  }
  
  async function handleInsertQuery(text, params) {
    const { supabaseDB } = require('./supabase');
    
    if (text.includes('student_images')) {
      const data = {
        student_name: params[0],
        student_id: params[1],
        filename: params[2],
        original_name: params[3],
        file_url: params[4],
        file_size: params[5]
      };
      return await supabaseDB.insert('student_images', data);
    } else if (text.includes('reviews')) {
      const data = {
        image_id: params[0],
        teacher_name: params[1],
        score: params[2],
        comment: params[3]
      };
      return await supabaseDB.insert('reviews', data);
    } else if (text.includes('likes')) {
      const data = {
        image_id: params[0],
        student_name: params[1],
        student_id: params[2]
      };
      return await supabaseDB.insert('likes', data);
    }
    return { rows: [] };
  }
  
  async function handleUpdateQuery(text, params) {
    const { supabaseDB } = require('./supabase');
    
    if (text.includes('reviews')) {
      const data = {
        teacher_name: params[0],
        score: params[1],
        comment: params[2]
      };
      const where = { image_id: params[3] };
      return await supabaseDB.update('reviews', data, where);
    }
    return { rows: [] };
  }
  
  async function handleDeleteQuery(text, params) {
    const { supabaseDB } = require('./supabase');
    
    if (text.includes('likes')) {
      const where = { image_id: params[0], student_id: params[1] };
      return await supabaseDB.delete('likes', where);
    } else if (text.includes('student_images')) {
      const where = { id: params[0] };
      return await supabaseDB.delete('student_images', where);
    }
    return { rows: [] };
  }
  
} else if (isProduction) {
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