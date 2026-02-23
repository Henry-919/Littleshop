import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// 这一段能帮你直接在控制台看到真相
if (!supabaseUrl || !supabaseAnonKey) {
  console.error("❌ 环境变量丢失！请检查 Vercel 后台配置。")
} else {
  console.log("✅ 环境变量已加载，URL 长度:", supabaseUrl.length)
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)