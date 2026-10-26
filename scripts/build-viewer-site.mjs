/**
 * 构建「只含展示端」的静态发布产物 dist-viewer/。
 *
 * 步骤：
 * 1. 用 vite.viewer.config.ts 单独构建 viewer 入口；
 * 2. 把 viewer.html 改名为 index.html（根路径直接可访问，链接更短）；
 * 3. 删掉展示端用不到的 sw.js / manifest.webmanifest；
 * 4. 校验产物里没有作者端代码、没有数据库与云 SDK 字样。
 *
 * 任何一步校验失败都直接退出非 0，避免把作者端误发到公网。
 */
import { build } from 'vite'
import { readFileSync, writeFileSync, renameSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = join(ROOT, 'dist-viewer')

function walk(dir, base = '') {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const rel = base ? `${base}/${name}` : name
    if (statSync(full).isDirectory()) out.push(...walk(full, rel))
    else out.push(rel)
  }
  return out
}

await build({ configFile: join(ROOT, 'vite.viewer.config.ts'), root: ROOT, logLevel: 'warn' })

const entry = join(OUT, 'viewer.html')
if (!existsSync(entry)) {
  console.error('✗ 构建后未找到 dist-viewer/viewer.html')
  process.exit(1)
}

renameSync(entry, join(OUT, 'index.html'))

for (const name of ['sw.js', 'manifest.webmanifest']) {
  const p = join(OUT, name)
  if (existsSync(p)) rmSync(p)
}

const html = readFileSync(join(OUT, 'index.html'), 'utf8')
if (!html.includes('assets/viewer-')) {
  console.error('✗ index.html 未引用展示端 bundle')
  process.exit(1)
}
if (html.includes('main-')) {
  console.error('✗ index.html 引用了作者端 bundle（main-*），已中止发布')
  process.exit(1)
}
if (!html.includes('noindex')) {
  console.error('✗ 缺少 noindex，拒绝发布可被搜索引擎收录的页面')
  process.exit(1)
}

const files = walk(OUT)
const jsFiles = files.filter((f) => f.endsWith('.js'))
for (const f of jsFiles) {
  const src = readFileSync(join(OUT, f), 'utf8')
  for (const banned of ['workbuddy-cloud-sdk', 'HeartLogDB', 'indexedDB.open']) {
    if (src.includes(banned)) {
      console.error(`✗ ${f} 含作者端痕迹「${banned}」，已中止发布`)
      process.exit(1)
    }
  }
}

// 展示端不应引用 index.html 相关入口；确认没有任何 main-* 资源
const strayMain = files.filter((f) => /(^|\/)main-/.test(f))
if (strayMain.length) {
  console.error(`✗ 产物中出现作者端资源：${strayMain.join(', ')}`)
  process.exit(1)
}

// 去掉本地占位图与真实媒体无关的调试产物之外，只允许静态资源
const totalBytes = files.reduce((n, f) => n + statSync(join(OUT, f)).size, 0)
console.log(`✓ dist-viewer 就绪：${files.length} 个文件 / ${(totalBytes / 1024).toFixed(1)} KB`)
for (const f of files.sort()) console.log(`  - ${f}`)
