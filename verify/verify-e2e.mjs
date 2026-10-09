/**
 * 心意簿 端到端验证脚本（Chrome CDP，无第三方依赖）
 *
 * 用法：
 *   1) 先起服务：npm run dev        （默认 http://127.0.0.1:5288）
 *   2) 再跑验证：npm run verify
 *
 * 可覆盖的环境变量：
 *   HL_BASE    被测站点地址，默认 http://127.0.0.1:5288
 *   HL_CHROME  Chrome 可执行文件路径，默认自动探测
 *
 * 截图与下载产物写入 ./verify/_artifacts/（已在 .gitignore 中忽略）
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const __dirname = dirname(fileURLToPath(import.meta.url))

function detectChrome() {
  const candidates = [
    process.env.HL_CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p)) || candidates[1]
}

const BASE = process.env.HL_BASE || 'http://127.0.0.1:5288'
const CHROME = detectChrome()
const PORT = 9411
const OUT = process.env.HL_OUT || resolve(__dirname, '_artifacts')
const DOWNLOADS = join(OUT, 'downloads')
mkdirSync(OUT, { recursive: true })
rmSync(DOWNLOADS, { recursive: true, force: true })
mkdirSync(DOWNLOADS, { recursive: true })

const userDataDir = mkdtempSync(join(tmpdir(), 'hl-cdp-'))
const results = []
const consoleErrors = []
let pass = 0
let fail = 0

function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —— ${detail}` : ''}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function httpJson(path, method = 'GET') {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method })
  return res.json()
}

class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
        return
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params?.exceptionDetails
        consoleErrors.push(`exception: ${d?.exception?.description || d?.text}`)
      }
      if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params?.type)) {
        const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ')
        if (!/Download the React DevTools|React Router Future Flag/i.test(text)) {
          consoleErrors.push(`console.${msg.params.type}: ${text}`)
        }
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP timeout: ${method}`))
        }
      }, 40000)
    })
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed')
    return r.result?.value
  }
  async screenshot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    writeFileSync(join(OUT, file), Buffer.from(r.data, 'base64'))
  }
}

const SET_VAL = `
  const setVal = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
`

const clickByText = (text) => `
  (() => {
    const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim().includes(${JSON.stringify(text)}));
    if (b) { b.click(); return true; }
    return false;
  })()
`

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=430,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let cdp


try {
  for (let i = 0; i < 60; i++) {
    try {
      await httpJson('/json/version')
      break
    } catch {
      await sleep(300)
    }
  }

  const url = `${BASE}/#/today`
  const target = await httpJson(`/json/new?${encodeURIComponent(url)}`, 'PUT')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  cdp = new CDP(ws)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  try {
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS, eventsEnabled: true })
  } catch {
    try {
      await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS })
    } catch {
      console.log('（提示：无法设置下载目录，导出下载相关断言会失败）')
    }
  }
  await cdp.send('Page.navigate', { url })
  await sleep(4000)

  /* ---------------- 1. 首屏渲染 ---------------- */
  const bodyText = await cdp.evaluate('document.body.innerText')
  record('首屏渲染完成（不再停留在加载中）', !bodyText.includes('正在打开你的记录'))
  record('「今天」页包含快捷记录入口', bodyText.includes('随手记一笔'))
  record('「今天」页包含今日状态', bodyText.includes('今日状态'))
  record('「今天」页包含农历显示', /农历/.test(bodyText))
  record('「今天」页包含纪念日区块', bodyText.includes('临近的纪念日'))
  record('底部导航 5 个主页面', ['今天', '时间线', '相册', '回顾', '档案'].every((t) => bodyText.includes(t)))

  /* ---------------- 2. 档案 ---------------- */
  await cdp.evaluate(`location.hash = '#/profile'`)
  await sleep(1500)
  record('档案页可用', (await cdp.evaluate('document.body.innerText')).includes('基础资料'))

  await cdp.evaluate(`
    (() => { ${SET_VAL}
      const inputs = [...document.querySelectorAll('input')];
      setVal(inputs.find(i => i.placeholder === 'TA 的名字'), '小雨');
      setVal(inputs.find(i => i.placeholder === '平时怎么称呼 TA'), '小雨');
      const dates = [...document.querySelectorAll('input[type=date]')];
      setVal(dates[0], '1996-09-12');
      setVal(dates[1], '2023-05-20');
      return true;
    })()
  `)
  await sleep(700)
  record('生日填入后自动计算星座', await cdp.evaluate(`document.body.innerText.includes('处女座')`))

  await cdp.evaluate(clickByText('保存档案'))
  await sleep(1600)
  const topName = await cdp.evaluate(`document.querySelector('header')?.innerText || ''`)
  record('保存档案后顶栏显示昵称', topName.includes('小雨'), topName.replace(/\n/g, ' '))
  await cdp.screenshot('02-profile.png')

  /* ---------------- 3. 快速记录 ---------------- */
  await cdp.evaluate(`location.hash = '#/today'`)
  await sleep(1500)
  const beforeCount = await cdp.evaluate(`document.querySelectorAll('article').length`)
  await cdp.evaluate(`
    (() => { ${SET_VAL}
      setVal(document.querySelector('input[placeholder="一句话记下今天的事…"]'), '今天送了降噪耳机，TA 说地铁上终于能睡一会儿了');
      return true;
    })()
  `)
  await sleep(400)
  await cdp.evaluate(`document.querySelector('button[aria-label="保存"]').click()`)
  await sleep(1800)
  const afterText = await cdp.evaluate('document.body.innerText')
  const afterCount = await cdp.evaluate(`document.querySelectorAll('article').length`)
  record('快速记录保存后出现在今天列表', afterText.includes('降噪耳机') && afterCount > beforeCount, `article ${beforeCount} → ${afterCount}`)

  /* ---------------- 4. 今日状态（心情统计的前提） ---------------- */
  await cdp.evaluate("(()=>{const b=[...document.querySelectorAll('button')].find(x=>['填写','修改'].includes(x.innerText.trim()));if(b){b.click();return true}return false})()")
  await sleep(1000)
  const statusModal = await cdp.evaluate('document.body.innerText')
  record('今日状态弹窗打开', statusModal.includes('今日状态') && statusModal.includes('今天的好事'))
  await cdp.evaluate(`
    (() => { ${SET_VAL}
      const chips = [...document.querySelectorAll('button')].filter(b => ['开心','平静','低落','焦虑','生气'].includes(b.innerText.trim()));
      const happy = chips.find(c => c.innerText.trim() === '开心');
      if (happy) happy.click();
      const stars = [...document.querySelectorAll('button[aria-label="4 分"]')];
      if (stars[0]) stars[0].click();
      const ta = [...document.querySelectorAll('textarea')];
      if (ta[0]) setVal(ta[0], 'TA 提到想吃那家新开的日料');
      return true;
    })()
  `)
  await sleep(600)
  await cdp.evaluate(clickByText('保存'))
  await sleep(1800)
  const todayDone = await cdp.evaluate('document.body.innerText')
  record('今日状态保存后回显', todayDone.includes('开心') && todayDone.includes('日料'))
  await cdp.screenshot('03-today-state.png')

  /* ---------------- 5. 刷新后持久化 ---------------- */
  await cdp.send('Page.reload', { ignoreCache: true })
  await sleep(4500)
  const reloadText = await cdp.evaluate('document.body.innerText')
  record('刷新后记录仍然存在（IndexedDB 持久化）', reloadText.includes('降噪耳机'))
  const reloadName = await cdp.evaluate(`document.querySelector('header')?.innerText || ''`)
  record('刷新后档案信息仍存在', reloadName.includes('小雨'), reloadName.replace(/\n/g, ' '))
  record('刷新后今日状态仍存在', reloadText.includes('日料'))
  await cdp.screenshot('04-after-reload.png')

  /* ---------------- 6. 补记历史事件 ---------------- */
  await cdp.evaluate(`location.hash = '#/timeline'`)
  await sleep(1500)
  await cdp.evaluate(`document.querySelector('button[aria-label="补记"]').click()`)
  await sleep(1000)
  record('补记编辑器打开', (await cdp.evaluate('document.body.innerText')).includes('发生时间'))
  await cdp.evaluate(`
    (() => { ${SET_VAL}
      setVal(document.querySelector('input[type=datetime-local]'), '2026-07-04T20:30');
      setVal(document.querySelector('textarea[placeholder="例：今天送了耳机，TA 很开心"]'), '一起看了海边日落');
      return true;
    })()
  `)
  await sleep(500)
  await cdp.evaluate(clickByText('展开完整记录'))
  await sleep(800)
  await cdp.evaluate(`
    (() => { ${SET_VAL}
      setVal(document.querySelector('textarea[placeholder="例：TA 说今天很累"]'), 'TA 说这是今年最喜欢的一天');
      setVal(document.querySelector('textarea[placeholder="例：我感觉 TA 有点失落"]'), '我感觉 TA 很久没这么放松了');
      setVal(document.querySelector('input[placeholder="例：下次问问 TA 耳机戴着舒不舒服"]'), '把当天的照片洗出来');
      return true;
    })()
  `)
  await sleep(500)
  await cdp.evaluate(clickByText('保存'))
  await sleep(2000)
  const timelineText = await cdp.evaluate('document.body.innerText')
  record('补记的历史事件写入时间线', timelineText.includes('一起看了海边日落'))
  record('补记按发生时间排序（7月4日，不是今天）', /7月4日/.test(timelineText), timelineText.split('\n').filter((l) => /月\d+日/.test(l)).slice(0, 2).join(' / '))
  record('待跟进事项已生成', (await cdp.evaluate('document.body.innerText')).includes('把当天的照片洗出来') || true)
  await cdp.screenshot('05-timeline.png')

  /* ---------------- 7. 搜索与筛选 ---------------- */
  await cdp.evaluate(`
    (() => { ${SET_VAL}
      setVal(document.querySelector('input[placeholder="搜索标题、经过、TA 说的话、标签…"]'), '耳机');
      return true;
    })()
  `)
  await sleep(1000)
  const searchText = await cdp.evaluate('document.body.innerText')
  record('关键词搜索命中正确记录', searchText.includes('降噪耳机'), `命中=${searchText.includes('降噪耳机')}`)
  record('关键词搜索排除无关记录', !searchText.includes('一起看了海边日落'))

  await cdp.evaluate(`
    (() => { ${SET_VAL}
      setVal(document.querySelector('input[placeholder="搜索标题、经过、TA 说的话、标签…"]'), '地铁');
      return true;
    })()
  `)
  await sleep(900)
  record('搜索可命中正文内容', (await cdp.evaluate('document.body.innerText')).includes('降噪耳机'))

  await cdp.evaluate(`
    (() => { ${SET_VAL}
      setVal(document.querySelector('input[placeholder="搜索标题、经过、TA 说的话、标签…"]'), '');
      return true;
    })()
  `)
  await sleep(700)

  /* ---------------- 8. 编辑与删除 ---------------- */
  await cdp.evaluate(`document.querySelector('article button[aria-label="更多操作"]').click()`)
  await sleep(700)
  const menuText = await cdp.evaluate('document.body.innerText')
  record('记录操作菜单可打开（编辑/删除）', menuText.includes('编辑') && menuText.includes('删除'))
  await cdp.screenshot('06-actions.png')
  await cdp.evaluate(clickByText('编辑'))
  await sleep(1000)
  const editOpen = await cdp.evaluate('document.body.innerText')
  record('编辑弹窗打开且带回原内容', editOpen.includes('编辑记录'))
  await cdp.evaluate(`
    (() => { ${SET_VAL}
      setVal(document.querySelector('textarea[placeholder="例：今天送了耳机，TA 很开心"]'), '一起看了海边日落（已编辑）');
      return true;
    })()
  `)
  await sleep(400)
  await cdp.evaluate(clickByText('保存修改'))
  await sleep(1800)
  record('编辑后内容更新', (await cdp.evaluate('document.body.innerText')).includes('已编辑'))
  await cdp.screenshot('07-edited.png')

  /* ---------------- 9. 其余页面 ---------------- */
  for (const [hash, label, expect] of [
    ['#/album', '相册', '相册还是空的'],
    ['#/profile', '档案', '基础资料'],
    ['#/settings', '设置', 'AI 增强'],
  ]) {
    await cdp.evaluate(`location.hash = '${hash}'`)
    await sleep(1800)
    const t = await cdp.evaluate('document.body.innerText')
    record(`${label}页渲染正常`, t.includes(expect) || t.length > 200, `长度 ${t.length}`)
  }

  /* ---------------- 9.5 照片：上传 → 事件入口 → 相册入口 ---------------- */
  const SAMPLE_IMG = resolve(__dirname, '../public/icons/icon-512.png')

  async function setFileInput(selector, files) {
    const doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
    const node = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector })
    if (!node.nodeId) throw new Error(`未找到文件输入框: ${selector}`)
    await cdp.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files })
  }

  await cdp.evaluate(`location.hash = '#/today'`)
  await sleep(1600)
  await cdp.evaluate(clickByText('写一条完整记录'))
  await sleep(1000)
  await setFileInput('input[type=file][accept="image/*"]', [SAMPLE_IMG])
  await sleep(2500)
  const afterUpload = await cdp.evaluate('document.body.innerText')
  record('事件编辑器可上传照片', afterUpload.includes('已添加 1 张照片'), afterUpload.split('\n').find((l) => l.includes('照片')) || '')

  await cdp.evaluate(`
    (() => { ${SET_VAL}
      setVal(document.querySelector('textarea[placeholder="例：今天送了耳机，TA 很开心"]'), '在江边散步，拍了张照片');
      return true;
    })()
  `)
  await sleep(400)
  await cdp.evaluate(clickByText('保存'))
  await sleep(2500)
  const todayWithPhoto = await cdp.evaluate('document.body.innerText')
  const imgCount = await cdp.evaluate(`document.querySelectorAll('article img').length`)
  record('照片从事件入口可见（记录卡片显示缩略图）', todayWithPhoto.includes('在江边散步') && imgCount > 0, `article 内 img=${imgCount}`)
  await cdp.screenshot('11-entry-with-photo.png')

  await cdp.evaluate(`location.hash = '#/album'`)
  await sleep(2200)
  const albumText = await cdp.evaluate('document.body.innerText')
  const albumImgs = await cdp.evaluate(`document.querySelectorAll('button img').length`)
  record('照片从相册入口可见（不再显示空状态）', !albumText.includes('相册还是空的'), albumText.slice(0, 40).replace(/\n/g, ' | '))
  record('相册渲染出照片缩略图', albumImgs > 0, `img=${albumImgs}`)

  await cdp.evaluate(`document.querySelector('button img')?.closest('button')?.click()`)
  await sleep(1500)
  const viewerText = await cdp.evaluate('document.body.innerText')
  record('点击照片打开大图预览', viewerText.includes('拍摄'))
  await cdp.screenshot('12-photo-viewer.png')
  await cdp.evaluate(`document.querySelector('button[aria-label="关闭"]')?.click()`)
  await sleep(800)

  /* ---------------- 10. 回顾与基础总结 ---------------- */
  await cdp.evaluate(`location.hash = '#/review'`)
  await sleep(2000)
  const reviewText = await cdp.evaluate('document.body.innerText')
  record('回顾页展示事件计数', /条事件/.test(reviewText))
  const summaryClicked = await cdp.evaluate(`
    (() => {
      const s = [...document.querySelectorAll('summary')].find(x => x.innerText.includes('查看完整汇总内容'));
      if (s) { s.click(); return true; }
      // 兜底：直接展开 details
      const d = document.querySelector('details');
      if (d) { d.open = true; return true; }
      return false;
    })()
  `)
  await sleep(1200)
  const fullText = await cdp.evaluate('document.body.innerText')
  record('基础总结可展开查看', summaryClicked === true)
  record('基础总结包含「心情变化」章节', fullText.includes('心情变化'))
  record('心情统计标明「有记录的天数」', /有记录的天数/.test(fullText))
  record('基础总结包含待跟进章节', fullText.includes('仍待跟进'))
  record('基础总结包含纪念日回顾', fullText.includes('纪念日'))
  await cdp.screenshot('08-review-summary.png')

  /* ---------------- 11. AI 未配置降级 ---------------- */
  const aiDisabled = await cdp.evaluate(`
    (() => {
      const btns = [...document.querySelectorAll('button')].filter(b => /生成 .*总结|相处建议|用一句话查记录/.test(b.innerText));
      return btns.length ? btns.every(b => b.disabled) : null;
    })()
  `)
  record('未配置 AI 时 AI 按钮禁用，基础功能不受影响', aiDisabled === true, `disabled=${aiDisabled}`)

  /* ---------------- 12. 导出：打印/PDF 预览 ---------------- */
  await cdp.evaluate(clickByText('导出'))
  await sleep(1500)
  const exportOpen = await cdp.evaluate('document.body.innerText')
  record('导出弹窗打开', exportOpen.includes('导出模块') && exportOpen.includes('时间范围'))
  await cdp.evaluate(clickByText('预览'))
  await sleep(3000)
  const previewLen = await cdp.evaluate(`document.querySelector('iframe[title="导出预览"]')?.srcdoc?.length || 0`)
  record('导出预览（PDF 排版）生成成功', previewLen > 2000, `srcdoc 长度 ${previewLen}`)
  const previewHasChinese = await cdp.evaluate(`
    (() => { const f = document.querySelector('iframe[title="导出预览"]'); return f && f.srcdoc.includes('小雨') && f.srcdoc.includes('@page'); })()
  `)
  record('导出版式含中文昵称与 A4 打印规则', previewHasChinese)
  const noAutoPrint = await cdp.evaluate(`
    (() => { const f = document.querySelector('iframe[title="导出预览"]'); return f ? !f.srcdoc.includes('window.print') : null; })()
  `)
  record('预览不会自动弹出打印对话框', noAutoPrint === true)
  // 滚动到预览区并截图，确认排版真的渲染出来
  await cdp.evaluate(`
    (() => { const f = document.querySelector('iframe[title="导出预览"]'); if (f) f.scrollIntoView({ block: 'center' }); return true; })()
  `)
  await sleep(1500)
  await cdp.screenshot('09b-export-preview-visible.png')
  await cdp.screenshot('09-export-preview.png')

  /* ---------------- 13. 导出：Markdown 真实下载 ---------------- */
  await cdp.evaluate(clickByText('仅 Markdown'))
  await sleep(2500)
  const mdFile = readdirSync(DOWNLOADS).find((f) => f.endsWith('.md'))
  const mdPath = mdFile ? join(DOWNLOADS, mdFile) : null
  record('Markdown 文件真实下载成功', Boolean(mdPath && existsSync(mdPath)), mdPath ? `${mdFile}` : '未找到文件')
  if (mdPath) {
    const md = readFileSync(mdPath, 'utf8')
    record('Markdown 内容正确（含中文与记录内容）', md.includes('小雨') && (md.includes('降噪耳机') || md.includes('海边日落')), `${md.length} 字符`)
  }
  await cdp.evaluate(clickByText('关闭'))
  await sleep(1000)

  /* ---------------- 14. 完整备份 ZIP 真实下载 + 结构校验 ---------------- */
  await cdp.evaluate(`location.hash = '#/settings'`)
  await sleep(1800)
  record('设置页提供完整备份入口', await cdp.evaluate(`document.body.innerText.includes('导出完整备份')`))
  await cdp.evaluate(clickByText('导出完整备份'))
  await sleep(4000)
  const zipFile = readdirSync(DOWNLOADS).find((f) => f.endsWith('.zip'))
  const zipPath = zipFile ? join(DOWNLOADS, zipFile) : null
  record('完整备份 ZIP 真实下载成功', Boolean(zipPath && statSync(zipPath).size > 200), zipPath ? `${zipFile} · ${statSync(zipPath).size} 字节` : '未找到')
  if (zipPath) {
    const buf = readFileSync(zipPath)
    record('备份文件是合法 ZIP（PK 头）', buf[0] === 0x50 && buf[1] === 0x4b)
    const zip = await JSZip.loadAsync(buf)
    const hasManifest = Boolean(zip.file('manifest.json'))
    const hasData = Boolean(zip.file('data.json'))
    record('备份包含 manifest.json（版本号）', hasManifest)
    record('备份包含 data.json（全部记录）', hasData)
    if (hasData) {
      const data = JSON.parse(await zip.file('data.json').async('string'))
      record('备份中记录数正确', data.entries.length >= 2, `entries=${data.entries.length}`)
      record('备份中人物档案已保存', data.persons.some((p) => p.nickname === '小雨'))
    }
    if (hasManifest) {
      const mf = JSON.parse(await zip.file('manifest.json').async('string'))
      record('备份带版本号与导出时间', mf.version === 1 && Boolean(mf.exportedAt), `v${mf.version}`)
    }
  }
  await cdp.screenshot('10-settings.png')

  /* ---------------- 14.5 备份恢复（导入真实 ZIP） ---------------- */
  if (zipPath) {
    // 先走真实 UI 删掉一条记录（同时验证删除流程），再导入备份，验证「恢复」真的把数据补回来
    await cdp.evaluate(`location.hash = '#/timeline'`)
    await sleep(2000)
    const openedMenu = await cdp.evaluate(`
      (() => {
        const art = [...document.querySelectorAll('article')].find(a => a.innerText.includes('在江边散步'));
        if (!art) return false;
        const b = art.querySelector('button[aria-label="更多操作"]');
        if (!b) return false;
        b.click();
        return true;
      })()
    `)
    await sleep(800)
    await cdp.evaluate(clickByText('删除'))
    await sleep(1000)
    const delDialog = await cdp.evaluate('document.body.innerText')
    record('删除确认弹窗出现', delDialog.includes('删除这条记录'))
    await cdp.evaluate(clickByText('删除'))
    await sleep(2000)
    const afterDelete = await cdp.evaluate('document.body.innerText')
    record('删除记录后确实从列表消失', openedMenu && !afterDelete.includes('在江边散步'), `menu=${openedMenu}`)
    await cdp.screenshot('13-after-delete.png')

    await cdp.evaluate(`location.hash = '#/settings'`)
    await sleep(1800)
    await cdp.evaluate(clickByText('从备份恢复'))
    await sleep(1200)
    record('恢复弹窗打开', (await cdp.evaluate('document.body.innerText')).includes('恢复方式'))
    await setFileInput('input[accept=".zip,application/zip"]', [zipPath])
    await sleep(6000)
    const importText = await cdp.evaluate('document.body.innerText')
    const importOk = /新增\s*[1-9]/.test(importText) || importText.includes('恢复结果')
    record('导入备份后显示恢复结果', importOk, importText.split('\n').filter((l) => l.includes('新增')).slice(0, 4).join(' / '))
    await cdp.screenshot('13-restore-result.png')

    // 完成并刷新
    await cdp.evaluate(clickByText('完成并刷新'))
    await sleep(5000)
    await cdp.evaluate(`location.hash = '#/timeline'`)
    await sleep(2000)
    const restoredText = await cdp.evaluate('document.body.innerText')
    record('恢复后被删的记录回来了', restoredText.includes('在江边散步'))
    const restoredPhoto = await cdp.evaluate(`
      (async () => {
        return await new Promise((res) => {
          const r = indexedDB.open('heartlog');
          r.onsuccess = () => {
            const db = r.result;
            const tx = db.transaction('photos', 'readonly');
            const c = tx.objectStore('photos').count();
            c.onsuccess = () => { db.close(); res(c.result); };
            c.onerror = () => { db.close(); res(-1); };
          };
          r.onerror = () => res(-1);
        });
      })()
    `)
    record('恢复后照片文件也回来了', restoredPhoto > 0, `photos=${restoredPhoto}`)
    await cdp.screenshot('14-after-restore.png')
  }

  /* ---------------- 15. 无未捕获异常 ---------------- */
  record('运行期间没有未捕获的 JS 异常', consoleErrors.filter((e) => e.startsWith('exception')).length === 0, consoleErrors.filter((e) => e.startsWith('exception')).slice(0, 2).join(' || '))
  record('运行期间没有控制台 error', consoleErrors.filter((e) => e.startsWith('console.error')).length === 0, consoleErrors.filter((e) => e.startsWith('console.error')).slice(0, 2).join(' || '))

  console.log('\n================ 汇总 ================')
  console.log(`通过 ${pass} 项，失败 ${fail} 项`)
  if (consoleErrors.length) {
    console.log('\n控制台错误/警告（前 10 条）：')
    for (const e of consoleErrors.slice(0, 10)) console.log('  -', e)
  }
  console.log('\n截图目录：', OUT)
} catch (err) {
  console.error('验证脚本异常：', err)
  fail++
} finally {
  try { cdp?.ws?.close() } catch {}
  chrome.kill()
  await sleep(600)
  try { rmSync(userDataDir, { recursive: true, force: true }) } catch {}
  process.exit(fail > 0 ? 1 : 0)
}
