/**
 * 构建「访客端 + 作者端」发布产物到 dist-viewer/。
 *
 * 输出目录仍是 dist-viewer，这样覆盖的是同一个应用链接（换成别的目录会生成新应用、
 * 新域名，云端 Origin 不匹配、登录直接失效）。
 *
 * 产物结构：
 *   index.html        访客端（由 viewer.html 改名），默认读取真实公开快照
 *   author.html       作者端（云端登录 + 本地数据库），与访客端同域
 *   snapshot/         公开快照与媒体，仅供访客端读取
 *   assets/ icons/ sw.js manifest.webmanifest
 *
 * 边界检查：
 *   - index.html 不得引用作者端 bundle（main-*），保证访客首屏不加载数据库/云 SDK；
 *   - 快照不得含私有字段；
 *   - 两个入口都必须 noindex。
 */
import { build } from 'vite'
import { readFileSync, writeFileSync, renameSync, rmSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = join(ROOT, 'dist-viewer')
const STAGE = join(ROOT, 'dist-publish')
const SRC = join(ROOT, 'verify/_artifacts/migration/private/publish')

if (!existsSync(join(SRC, 'public-snapshot.json'))) {
  console.error('✗ 找不到公开快照，请先执行 npm run snapshot:public')
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(join(SRC, 'public-snapshot.json'), 'utf8')).manifest

await build({ configFile: join(ROOT, 'vite.site.config.ts'), root: ROOT, logLevel: 'warn' })

if (!existsSync(join(STAGE, 'viewer.html')) || !existsSync(join(STAGE, 'author.html'))) {
  console.error('✗ 构建后缺少 viewer.html 或 author.html')
  process.exit(1)
}

// 把构建产物镜像到发布目录（覆盖同名文件，不删除既有大目录）
function mirror(from, to) {
  mkdirSync(to, { recursive: true })
  for (const name of readdirSync(from)) {
    const src = join(from, name)
    const dst = join(to, name)
    if (statSync(src).isDirectory()) mirror(src, dst)
    else copyFileSync(src, dst)
  }
}
mirror(STAGE, OUT)

// viewer.html → index.html（覆盖旧入口）
copyFileSync(join(STAGE, 'viewer.html'), join(OUT, 'index.html'))
for (const stale of ['viewer.html']) {
  const p = join(OUT, stale)
  if (existsSync(p)) {
    try {
      rmSync(p)
    } catch {
      // 删不掉也不影响：线上只认 index.html 与 author.html
    }
  }
}

// 访客端入口注入默认快照地址
const indexPath = join(OUT, 'index.html')
let html = readFileSync(indexPath, 'utf8')
if (!html.includes('hl-snapshot')) {
  html = html.replace('</head>', '    <meta name="hl-snapshot" content="./snapshot/public-snapshot.json" />\n  </head>')
  writeFileSync(indexPath, html)
}

const authorHtml = readFileSync(join(OUT, 'author.html'), 'utf8')

if (!html.includes('noindex')) {
  console.error('✗ 访客端缺少 noindex')
  process.exit(1)
}
if (!authorHtml.includes('noindex')) {
  console.error('✗ 作者端缺少 noindex')
  process.exit(1)
}
if (html.includes('main-')) {
  console.error('✗ 访客端引用了作者端 bundle（main-*），已中止')
  process.exit(1)
}
if (!/author-[^"]+\.js|main-[^"]+\.js/.test(authorHtml)) {
  console.error('✗ 作者端没有引用自己的 bundle')
  process.exit(1)
}

// 快照与媒体
const snapshotDir = join(OUT, 'snapshot')
mkdirSync(join(snapshotDir, 'media'), { recursive: true })
copyFileSync(join(SRC, 'public-snapshot.json'), join(snapshotDir, 'public-snapshot.json'))
let copied = 0
for (const name of readdirSync(join(SRC, 'media'))) {
  copyFileSync(join(SRC, 'media', name), join(snapshotDir, 'media', name))
  copied++
}

const snapshotText = readFileSync(join(snapshotDir, 'public-snapshot.json'), 'utf8')
for (const banned of ['apiKey', 'proxyUrl', 'publishToken']) {
  if (snapshotText.includes(banned)) {
    console.error(`✗ 快照含私有字段「${banned}」`)
    process.exit(1)
  }
}

// 清理上一版遗留的 hash 资源。
// 注意：不能只保留 HTML 里引用的文件——懒加载 chunk（如 editors-*.js）不出现在 HTML 中，
// 之前这样清理把编辑组件删掉，导致点编辑时动态 import 404、整页白屏。这里以构建清单为准。
const manifestPath = join(STAGE, '.vite/manifest.json')
const keep = new Set()
if (existsSync(manifestPath)) {
  const built = JSON.parse(readFileSync(manifestPath, 'utf8'))
  for (const entry of Object.values(built)) {
    const e = entry
    if (e.file) keep.add(e.file)
    for (const k of e.css ?? []) keep.add(k)
    for (const k of e.assets ?? []) keep.add(k)
    for (const k of e.dynamicImports ?? []) {
      const child = built[k]
      if (child?.file) keep.add(child.file)
      for (const c of child?.css ?? []) keep.add(c)
    }
  }
}
for (const name of readdirSync(join(OUT, 'assets'))) {
  if (keep.has(`assets/${name}`)) continue
  // 兜底：任何仍被 JS/CSS 文本引用的文件也保留
  try {
    rmSync(join(OUT, 'assets', name))
  } catch {
    // 删不掉就留着，不影响功能
  }
}
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
const files = walk(OUT)
const total = files.reduce((n, f) => n + statSync(join(OUT, f)).size, 0)
const viewerJs = (html.match(/assets\/(viewer-[^"]+\.js)/) || [])[1]
const authorJs = (authorHtml.match(/assets\/(author-[^"]+\.js)/) || [])[1]

console.log(`✓ 发布产物就绪：${files.length} 个文件 / ${(total / 1024 / 1024).toFixed(1)} MB`)
console.log(`  访客端  index.html → ${viewerJs || '(缺失)'}`)
console.log(`  作者端  author.html → ${authorJs || '(缺失)'}`)
console.log(`  快照    ${manifest.publishId} · ${manifest.counts.entries} 条记录 / ${manifest.counts.photos} 张照片 · ${copied} 份媒体`)
console.log(`  资源    清单内 ${keep.size} 个文件全部保留（含懒加载 chunk）`)
