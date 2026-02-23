import { createClient } from '@supabase/supabase-js';

// 1. 获取变量
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 2. 检查并创建客户端
if (!supabaseUrl || !supabaseAnonKey) {
  console.error("❌ 严重错误：找不到环境变量！Vercel 注入失败。");
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co', 
  supabaseAnonKey || ''
);

// 3. 【关键】强制暴露给浏览器控制台
if (typeof window !== 'undefined') {
  (window as any).supabase = supabase;
}