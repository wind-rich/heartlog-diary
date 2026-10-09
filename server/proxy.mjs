/**
 * 心意簿 · AI 服务端代理
 * ---------------------------------------------------------------
 * 作用：把浏览器发来的请求转发给模型服务，API Key 只保存在服务端环境变量里，
 *      浏览器端不需要（也不应该）持有密钥。同时绕开浏览器跨域（CORS）限制。
 *
 * 运行：
 *   set HL_UPSTREAM=https://api.deepseek.com/v1
 *   set HL_API_KEY=sk-xxxxxx
 *   set HL_MODEL=deepseek-chat
 *   node server/proxy.mjs
 *
 * Windows PowerShell 写法：
 *   $env:HL_UPSTREAM="https://api.deepseek.com/v1"; $env:HL_API_KEY="sk-xxx"; node server/proxy.mjs
 *
 * 然后在「设置 → AI 增强」里选择「经自建代理」，代理地址填：
 *   http://127.0.0.1:8787/v1
 *
 * 注意：本脚本只监听本机地址，不要直接暴露到公网。
 */
import http from 'node:http'

const PORT = Number(process.env.HL_PORT || 8787)
const HOST = process.env.HL_HOST || '127.0.0.1'
const UPSTREAM = (process.env.HL_UPSTREAM || 'https://api.deepseek.com/v1').replace(/\/$/, '')
const API_KEY = process.env.HL_API_KEY || ''
const DEFAULT_MODEL = process.env.HL_MODEL || ''

if (!API_KEY) {
  console.warn('[warn] 未设置 HL_API_KEY，将以「不附带密钥」的方式转发（只适用于本地免鉴权服务）。')
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders)
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true, upstream: UPSTREAM, hasKey: Boolean(API_KEY) })
    return
  }

  if (req.method !== 'POST' || !/\/chat\/completions$/.test(req.url || '')) {
    sendJson(res, 404, { error: { message: '只支持 POST /v1/chat/completions' } })
    return
  }

  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', async () => {
    let payload
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch {
      sendJson(res, 400, { error: { message: '请求体不是合法 JSON' } })
      return
    }

    // 浏览器端可以带上 apiKey 作为兜底；服务端环境变量优先
    const key = API_KEY || payload.apiKey || ''
    delete payload.apiKey
    if (!payload.model && DEFAULT_MODEL) payload.model = DEFAULT_MODEL
    if (!payload.model) {
      sendJson(res, 400, { error: { message: '缺少 model 字段' } })
      return
    }

    try {
      const upstreamRes = await fetch(`${UPSTREAM}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(payload),
      })
      const text = await upstreamRes.text()
      res.writeHead(upstreamRes.status, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' })
      res.end(text)
      console.log(`[proxy] ${upstreamRes.status} model=${payload.model} messages=${payload.messages?.length ?? 0}`)
    } catch (err) {
      console.error('[proxy] 转发失败：', err.message)
      sendJson(res, 502, { error: { message: `转发到上游失败：${err.message}` } })
    }
  })
})

server.listen(PORT, HOST, () => {
  console.log(`心意簿 AI 代理已启动：http://${HOST}:${PORT}/v1`)
  console.log(`上游：${UPSTREAM}${DEFAULT_MODEL ? ` · 默认模型 ${DEFAULT_MODEL}` : ''}`)
  console.log('健康检查：http://' + HOST + ':' + PORT + '/health')
})
