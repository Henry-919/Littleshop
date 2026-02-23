import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 加一个判断，方便你在 Vercel 控制台看日志
if (!supabaseUrl || !supabaseAnonKey) {
  console.error("环境变量丢失！检查 Vercel 设置。");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
