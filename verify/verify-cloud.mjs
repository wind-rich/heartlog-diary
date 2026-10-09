/**
 * 云服务连通性验证（在已发布的 HTTPS 域名下跑，因为服务端按 Origin 精确匹配）
 *
 * 用官方 SDK 的 CDN 形态注入页面上下文，直接调用 cloud.llm / cloud.database / cloud.storage，
 * 验证「域名 + publishableKey 这条凭证链」是通的。
 *
 * 注意：这里**不**验证需要登录才能走通的部分（邮箱验证码登录、云端备份读写）——
 * 那一步需要真实邮箱收码，由用户在界面上完成。
 *
 * 用法：node verify/verify-cloud.mjs
 * 环境变量：HL_BASE（默认取 cloudConfig 里的 endpoint）、HL_CHROME
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/* 从源码里读取 publicConfig，避免把配置抄两份 */
const cfgSrc = readFileSync(resolve(__dirname, '../src/lib/cloudConfig.ts'), 'utf-8')
function pick(key) {
  const m = cfgSrc.match(new RegExp(`${key}:\\s*'([^']+)'`))
  if (!m) throw new Error(`cloudConfig.ts 里找不到 ${key}`)
  return m[1]
}
const PUBLIC_CONFIG = {
  endpoint: pick('endpoint'),
  oauthRelayBaseUrl: pick('oauthRelayBaseUrl'),
  publishableKey: pick('publishableKey'),
}

const BASE = process.env.HL_BASE || PUBLIC_CONFIG.endpoint
const PORT = 9431
/* 用本地已安装的 SDK 全局构建注入，避免依赖 CDN 可达性 */
const SDK_GLOBAL_PATH = resolve(__dirname, '../node_modules/@tencent-ai/workbuddy-cloud-sdk/lib/index.global.js')
const SDK_SOURCE = readFileSync(SDK_GLOBAL_PATH, 'utf-8')

function detectChrome() {
  const candidates = [
    process.env.HL_CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p)) || candidates[1]
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —— ${detail}` : ''}`)
}

/* ------------------------------------------------------------------ */
/* 静态不变量审计                                                      */
/* 这几条都是实际踩过的坑，靠人眼守不住，所以固化成检查项。              */
/* ------------------------------------------------------------------ */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

function auditSource() {
  const srcDir = resolve(__dirname, '../src')
  const files = walk(srcDir)
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => ({ path: relative(srcDir, f).replace(/\\/g, '/'), text: readFileSync(f, 'utf-8') }))

  // 1) 组件不得直接调 aiReady(aiConfig)：那样会漏掉登录态，
  //    把已配置好的「云服务」AI 误判成未启用（真实踩过的回归）。
  const bare = []
  for (const f of files) {
    f.text.split('\n').forEach((line, i) => {
      if (!/aiReady\(aiConfig\)/.test(line)) return
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
      bare.push(`${f.path}:${i + 1}`)
    })
  }
  record('没有组件裸调 aiReady(aiConfig)（必须走 useAIReady 带上登录态）', bare.length === 0, bare.join(', '))

  // 2) 每个客户端初始化都必须带 endpoint + publishableKey（网页端还要 oauthRelayBaseUrl）
  const missing = []
  let initCount = 0
  for (const f of files) {
    const re = /createWorkBuddyCloud\s*(?:<[^>]*>)?\s*\(/g
    let m
    while ((m = re.exec(f.text))) {
      initCount++
      const seg = f.text.slice(m.index, m.index + 600)
      for (const key of ['endpoint', 'publishableKey', 'oauthRelayBaseUrl']) {
        if (!seg.includes(`${key}:`)) missing.push(`${f.path} 缺 ${key}`)
      }
    }
  }
  record(
    `客户端初始化调用点全部传齐 publicConfig（共 ${initCount} 处）`,
    initCount > 0 && missing.length === 0,
    missing.join(', '),
  )

  // 3) 发布域名只能出现在 cloudConfig.ts，别处不得写死
  const endpointStray = files
    .filter((f) => !f.path.endsWith('lib/cloudConfig.ts'))
    .filter((f) => /https:\/\/[a-z0-9.-]*workbuddy\.(host|link|cn)/i.test(f.text))
    .map((f) => f.path)
  record('endpoint 字面量只出现在 cloudConfig.ts', endpointStray.length === 0, endpointStray.join(', '))

  // 4) 不得手写 fetch 打 /.cloud/**
  const handWritten = files.filter((f) => /fetch\([^)]*\.cloud\//.test(f.text)).map((f) => f.path)
  record('没有手写 fetch 请求 /.cloud/**（必须走 SDK）', handWritten.length === 0, handWritten.join(', '))

  // 5) 不得把 Authorization 头手写给云数据面
  const manualAuth = files
    .filter((f) => /Authorization/.test(f.text) && /\.cloud\//.test(f.text))
    .map((f) => f.path)
  record('没有向云数据面手工传 Authorization', manualAuth.length === 0, manualAuth.join(', '))
}

auditSource()

const userDataDir = mkdtempSync(join(tmpdir(), 'hl-cloud-'))
const chrome = spawn(detectChrome(), [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDataDir}`,
  'about:blank',
])

let ws
let id = 0
const pending = new Map()
const pageErrors = []

function send(method, params = {}) {
  const mid = ++id
  return new Promise((resolve, reject) => {
    pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
    setTimeout(() => {
      if (pending.has(mid)) {
        pending.delete(mid)
        reject(new Error(`CDP timeout: ${method}`))
      }
    }, 40000)
  })
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result?.value
}

/* ------------------------------------------------------------------ */

try {
  let target
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = list.find((t) => t.type === 'page')
      if (target) break
    } catch {
      /* retry */
    }
    await sleep(300)
  }
  if (!target) throw new Error('找不到 Chrome 页面目标')

  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', rej)
  })
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
      return
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params?.exceptionDetails
      pageErrors.push(d?.exception?.description || d?.text)
    }
  })

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: `${BASE}/#/settings` })
  await sleep(7000)

  record('线上页面可访问并完成渲染', await evaluate("document.body.innerText.includes('心意簿')"))
  record('设置页出现「云服务」分区', await evaluate("document.body.innerText.includes('云服务')"))
  record('云服务显示为未登录', await evaluate("document.body.innerText.includes('未登录')"))

  /* 注入官方 SDK 全局构建，在页面同源下初始化 */
  await evaluate(SDK_SOURCE)
  const injected = await evaluate(`
    (async () => {
      try {
        if (!window.WorkBuddyCloud) return 'no-global'
        if (window.__hlCloud) return 'exists'
        window.__hlCloud = window.WorkBuddyCloud.createWorkBuddyCloud({
          endpoint: ${JSON.stringify(PUBLIC_CONFIG.endpoint)},
          oauthRelayBaseUrl: ${JSON.stringify(PUBLIC_CONFIG.oauthRelayBaseUrl)},
          publishableKey: ${JSON.stringify(PUBLIC_CONFIG.publishableKey)},
        })
        return 'ok'
      } catch (e) {
        return 'throw:' + String(e && e.message || e)
      }
    })()
  `)
  record('官方 SDK 在线上域名初始化成功', injected === 'ok', `结果=${injected}`)
  if (injected !== 'ok') throw new Error('SDK 初始化失败，后续检查无法进行')

  record('当前 Origin 与发布域名一致', await evaluate('location.origin') === new URL(BASE).origin, await evaluate('location.origin'))

  /* 1. LLM：模型列表（验证凭证链 + Origin 匹配） */
  const models = await evaluate(`
    (async () => {
      try {
        const list = await window.__hlCloud.llm.models.list()
        return { ok: true, count: list.length, first: list[0] ? (list[0].name || list[0].id) : null,
                 enabled: list.filter(m => m.disabled !== true && m.enabled !== false).length }
      } catch (e) {
        return { ok: false, code: (e && e.error && e.error.code) || null, message: String(e && e.message || e) }
      }
    })()
  `)
  record('云服务 LLM 接口可达（模型列表请求成功）', models?.ok === true, models?.ok ? `模型 ${models.count} 个，可用 ${models.enabled} 个，首个：${models.first}` : `错误=${models?.code || ''} ${models?.message || ''}`)

  /* 2. LLM：真实发起一次流式调用，验证关键路径真的能返回内容 */
  const chat = await evaluate(`
    (async () => {
      const attempts = []
      try {
        const models = await window.__hlCloud.llm.models.list()
        const usable = models.filter(m => m.disabled !== true && m.enabled !== false)
        if (!usable.length) return { ok: false, reason: 'no-model' }
        // 按列表原始顺序尝试前几个，与应用里「自动选择」的实现保持一致
        // （列表首个是路由型模型 auto，会返回空内容，必须能自动跳到下一个）
        const ordered = usable
        for (const model of ordered.slice(0, 4)) {
          let text = ''
          let reasoning = ''
          let chunks = 0
          let finish = null
          try {
            for await (const chunk of window.__hlCloud.llm.chat.completions.create({
              model: model.id,
              messages: [
                { role: 'system', content: '你是连接测试助手，只回复用户要求的内容。' },
                { role: 'user', content: '请只回复两个字：可用' },
              ],
              stream: true,
              max_tokens: 64,
            })) {
              chunks++
              const c = chunk.choices && chunk.choices[0]
              const d = c && c.delta
              if (d && d.content) text += d.content
              if (d && d.reasoning_content) reasoning += d.reasoning_content
              if (c && c.finish_reason) finish = c.finish_reason
            }
            attempts.push({ model: model.id, text: text.trim(), chunks, finish, reasoningLen: reasoning.length })
            if (text.trim()) return { ok: true, model: model.id, text: text.trim(), attempts }
          } catch (e) {
            attempts.push({ model: model.id, error: (e && e.error && e.error.code) || String((e && e.message) || e) })
          }
        }
        return { ok: false, attempts }
      } catch (e) {
        return { ok: false, message: String((e && e.message) || e), attempts }
      }
    })()
  `)
  record(
    '云服务模型真实返回内容（流式调用成功）',
    chat?.ok === true && typeof chat.text === 'string' && chat.text.length > 0,
    chat?.ok
      ? `模型=${chat.model}，回复="${chat.text.slice(0, 20)}"`
      : `明细=${JSON.stringify(chat?.attempts || chat?.message || null).slice(0, 400)}`,
  )

  /* 3. Database：未登录时 RLS 应放行请求但返回 0 行（不是 401） */
  const dbProbe = await evaluate(`
    (async () => {
      try {
        const { data, error } = await window.__hlCloud.database.from('heartlog_backups').select('*')
        return { ok: true, rows: Array.isArray(data) ? data.length : null, error: error ? (error.code || error.message) : null }
      } catch (e) {
        return { ok: false, code: (e && e.error && e.error.code) || null, message: String(e && e.message || e) }
      }
    })()
  `)
  const dbReached = dbProbe?.ok === true && (dbProbe.rows === 0 || dbProbe.error === null)
  record(
    '云数据库请求到达后端且未登录时被正确拒绝（0 行，非鉴权失败）',
    dbReached,
    dbProbe?.ok ? `返回 ${dbProbe.rows} 行${dbProbe.error ? ` / error=${dbProbe.error}` : ''}` : `错误=${dbProbe?.code || ''} ${dbProbe?.message || ''}`,
  )

  /* 3. Storage：未登录时必须拒绝，且给出明确错误而不是静默成功 */
  const storageProbe = await evaluate(`
    (async () => {
      try {
        const res = await window.__hlCloud.storage.list('users/', { limit: 1 })
        return { ok: true, error: res.error ? (res.error.message || 'error') : null }
      } catch (e) {
        return { ok: false, message: String(e && e.message || e) }
      }
    })()
  `)
  const storageRefused = storageProbe?.ok === true ? storageProbe.error !== null : true
  record('未登录访问对象存储被拒绝（不会静默成功）', storageRefused, storageProbe?.error || storageProbe?.message || '')

  /* 4. Auth：未登录会话应为空 */
  const session = await evaluate(`
    (async () => {
      const { data, error } = await window.__hlCloud.auth.getSession()
      return { hasData: data !== null, error: error ? error.kind : null }
    })()
  `)
  record('未登录时会话为空（auth 接口可达）', session?.hasData === false, `error=${session?.error || 'null'}`)

  /* 6. 云端 AI 模式下的界面表现
     真实踩过的回归：组件裸调 aiReady(aiConfig) 会漏掉登录态，
     把已切到「云服务」的 AI 显示成「未配置或未启用」。 */
  const seeded = await evaluate(`
    (async () => {
      return await new Promise((resolve) => {
        const r = indexedDB.open('heartlog')
        r.onsuccess = () => {
          const db = r.result
          try {
            const tx = db.transaction('meta', 'readwrite')
            tx.objectStore('meta').put({
              key: 'aiConfig',
              value: {
                enabled: true, provider: 'cloud',
                baseUrl: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat',
                cloudModel: '', viaProxy: false, proxyUrl: '', temperature: 0.7,
              },
            })
            tx.oncomplete = () => { db.close(); resolve(true) }
            tx.onerror = () => { db.close(); resolve(false) }
          } catch (e) { db.close(); resolve(false) }
        }
        r.onerror = () => resolve(false)
      })
    })()
  `)
  record('（准备）已把 AI 切到「云服务」模式并启用', seeded === true, `seeded=${seeded}`)

  // 带 query 强制整页重载，确保 AppProvider 重新读一次 meta
  await send('Page.navigate', { url: `${BASE}/?verify=${Date.now()}#/review` })
  await sleep(6000)
  const reviewText = String(await evaluate('document.body.innerText'))
  const saysNotConfigured = /AI 功能未配置或未启用/.test(reviewText)
  const saysNeedLogin = /还没有登录云服务账号/.test(reviewText)
  record(
    '云服务模式下不再误报「未配置」，而是提示去登录',
    saysNeedLogin && !saysNotConfigured,
    saysNeedLogin ? '已显示「去登录」提示' : `未配置提示=${saysNotConfigured} / 登录提示=${saysNeedLogin}`,
  )

  /* 7. 页面本身在本轮没有未捕获异常 */
  record('验证期间页面无未捕获 JS 异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

  const passed = results.filter((r) => r.ok).length
  console.log(`\n================ 云服务连通性 ================`)
  console.log(`通过 ${passed} 项，失败 ${results.length - passed} 项`)
  console.log(`\n说明：邮箱验证码登录与云端备份读写需要真实邮箱收码，未包含在本轮自动验证中。`)
} catch (e) {
  console.error('云服务验证异常：', e.message)
} finally {
  try {
    ws?.close()
  } catch {
    /* ignore */
  }
  chrome.kill()
  await sleep(500)
  rmSync(userDataDir, { recursive: true, force: true })
  process.exit(0)
}
