import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 发布站构建：同一目录同时产出两个入口。
 * - viewer.html → 线上改名为 index.html，访客只读，不加载数据库与云 SDK
 * - author.html → 作者端，登录后使用；与访客端同域，云端 Origin 才能通过校验
 *
 * base 用 './'：两个入口都能放在任意子路径，资源引用保持相对。
 */
export default defineConfig({
  base: './',
  resolve: {
    preserveSymlinks: true,
  },
  plugins: [react()],
  build: {
    target: 'es2020',
    outDir: 'dist-publish',
    emptyOutDir: true,
    manifest: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        viewer: 'viewer.html',
        author: 'author.html',
      },
    },
  },
})
