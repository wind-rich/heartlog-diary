import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 说明：工作区目录可能位于 Windows 目录联接（junction）或软链接之下
 * （例如 C:\Users\...\WorkBuddy → D:\WorkBuddyData\...）。
 * 这种情况下 Vite 读取 index.html 会得到物理路径、而 root 仍是逻辑路径，
 * 导致构建时报 “fileName ... must be strings that are neither absolute nor relative paths”。
 * 打开 preserveSymlinks 后，Vite 全程使用逻辑路径，dev 与 build 都能正常工作。
 */
export default defineConfig({
  base: './',
  resolve: {
    preserveSymlinks: true,
  },
  plugins: [react()],
  server: {
    port: 5288,
    host: true,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
})
