const { createClient } = require('@supabase/supabase-js');

// Supabase配置
const supabaseUrl = process.env.SUPABASE_URL || 'your-supabase-url';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'your-supabase-anon-key';

// 创建Supabase客户端
const supabase = createClient(supabaseUrl, supabaseKey);

// 数据库操作封装
const supabaseDB = {
  // 查询数据
  query: async (table, options = {}) => {
    try {
      let query = supabase.from(table).select(options.select || '*');
      
      // 添加条件
      if (options.where) {
        Object.entries(options.where).forEach(([key, value]) => {
          query = query.eq(key, value);
        });
      }
      
      // 添加排序
      if (options.orderBy) {
        query = query.order(options.orderBy.column, { ascending: options.orderBy.ascending !== false });
      }
      
      // 添加限制
      if (options.limit) {
        query = query.limit(options.limit);
      }
      
      const { data, error } = await query;
      
      if (error) {
        throw error;
      }
      
      return { rows: data };
    } catch (error) {
      console.error('Supabase query error:', error);
      throw error;
    }
  },
  
  // 插入数据
  insert: async (table, data) => {
    try {
      const { data: result, error } = await supabase
        .from(table)
        .insert(data)
        .select()
        .single();
      
      if (error) {
        throw error;
      }
      
      return { rows: [result] };
    } catch (error) {
      console.error('Supabase insert error:', error);
      throw error;
    }
  },
  
  // 更新数据
  update: async (table, data, where) => {
    try {
      let query = supabase.from(table).update(data);
      
      // 添加条件
      if (where) {
        Object.entries(where).forEach(([key, value]) => {
          query = query.eq(key, value);
        });
      }
      
      const { data: result, error } = await query.select();
      
      if (error) {
        throw error;
      }
      
      return { rows: result, rowCount: result.length };
    } catch (error) {
      console.error('Supabase update error:', error);
      throw error;
    }
  },
  
  // 删除数据
  delete: async (table, where) => {
    try {
      let query = supabase.from(table);
      
      // 添加条件
      if (where) {
        Object.entries(where).forEach(([key, value]) => {
          query = query.eq(key, value);
        });
      }
      
      const { data: result, error } = await query.delete().select();
      
      if (error) {
        throw error;
      }
      
      return { rows: result, rowCount: result.length };
    } catch (error) {
      console.error('Supabase delete error:', error);
      throw error;
    }
  },
  
  // 复杂查询（支持JOIN等）
  rawQuery: async (query, params = []) => {
    try {
      // 对于复杂查询，使用RPC或直接SQL
      const { data, error } = await supabase.rpc('execute_sql', {
        query: query,
        params: params
      });
      
      if (error) {
        throw error;
      }
      
      return { rows: data };
    } catch (error) {
      console.error('Supabase raw query error:', error);
      // 如果RPC不可用，回退到基本查询
      throw error;
    }
  },
  
  // 文件上传
  uploadFile: async (bucket, path, file) => {
    try {
      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false
        });
      
      if (error) {
        throw error;
      }
      
      // 获取公共URL
      const { data: urlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(path);
      
      return {
        success: true,
        path: data.path,
        url: urlData.publicUrl,
        filename: path
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
  deleteFile: async (bucket, path) => {
    try {
      const { data, error } = await supabase.storage
        .from(bucket)
        .remove([path]);
      
      if (error) {
        throw error;
      }
      
      return { success: true };
    } catch (error) {
      console.error('Supabase delete file error:', error);
      return { success: false, error: error.message };
    }
  }
};

module.exports = { supabase, supabaseDB };