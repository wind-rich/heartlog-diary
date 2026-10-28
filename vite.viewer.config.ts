import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 只构建「展示端」的发布产物（dist-viewer/）。
 *
 * 为什么单独一份配置：主构建会同时产出 index.html（作者端，挂 IndexedDB 与云 SDK）
 * 和 viewer.html（展示端，只用只读快照）。发布到公网时只能上传展示端，
 * 因此这里单独以 viewer.html 作为唯一入口，产物里不含作者端代码。
 *
 * base 用 './'：产物可以被放在任意子路径下，重命名为 index.html 后相对引用仍然有效。
 */
export default defineConfig({
  base: './',
  resolve: {
    preserveSymlinks: true,
  },
  plugins: [react()],
  build: {
    target: 'es2020',
    // 发布前校验可以指定独立候选目录，避免覆盖现有 dist-viewer。
    outDir: process.env.HL_VIEWER_OUT || 'dist-viewer',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: { viewer: 'viewer.html' },
    },
  },
})
