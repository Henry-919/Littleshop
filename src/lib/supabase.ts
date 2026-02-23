import { createClient } from '@supabase/supabase-js';

// 1. 使用安全的变量获取方式
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 2. 打印状态（仅在开发模式或手动调试时可见）
if (!supabaseUrl || !supabaseAnonKey) {
  console.error("❌ Supabase 凭证丢失。请检查 Vercel 环境变量并重新部署。");
}

// 3. 创建客户端
// 即使变量丢失，也要导出一个对象，防止其他组件 import 时直接崩溃
export const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null as any;