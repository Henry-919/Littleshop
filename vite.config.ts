import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url'; // 增加这行，确保路径解析兼容性
import { defineConfig, loadEnv } from 'vite';

// 解决 ESM 模式下 __dirname 缺失的问题
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  // 加载环境变量
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), tailwindcss()],
    define: {
      // 这里的注入是为了让前端也能通过 process.env 访问 Key
      // 但请注意：生产环境下建议通过后端 API 转发，避免 Key 暴露在 JS 包中
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'), // 建议指向 src 目录
      },
    },
    server: {
      // 保持你原有的 HMR 逻辑
      hmr: process.env.DISABLE_HMR !== 'true',
      // 如果你在本地开发，可以增加 proxy 方便调试后端
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        }
      }
    },
    // 强制包含 tailwindcss 处理
    optimizeDeps: {
      include: ['tailwindcss'],
    }
  };
});