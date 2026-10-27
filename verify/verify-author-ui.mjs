/**
 * 作者端新界面验证：同一套页面 + 编辑能力。
 * 用法：node verify/verify-author-ui.mjs（需 npm run dev）
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BASE = process.env.HL_BASE || 'http://127.0.0.1:5288'
const SNAPSHOT = '/verify/_artifacts/migration/private/publish/public-snapshot.json'
const OUT = join(ROOT, 'verify/_artifacts/author')
const PORT = 9419
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(OUT, { recursive: true })

const problems = []
const notes = []

function chromePath() {
  const c = [
    process.env.HL_CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean)
  return c.find((p) => existsSync(p)) || c[0]
}

class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.logs = []
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && this.pending.has(m.id)) {
        const { resolve: r, reject } = this.pending.get(m.id)
        this.pending.delete(m.id)
        m.error ? reject(new Error(JSON.stringify(m.error))) : r(m.result)
      }
      if (m.method === 'Runtime.exceptionThrown') this.logs.push(m.params?.exceptionDetails?.exception?.description || 'exception')
      if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') this.logs.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '))
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          rej(new Error(`timeout ${method}`))
        }
      }, 30000)
    })
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed')
    return r.result?.value
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, file), Buffer.from(r.data, 'base64'))
  }
}

const profile = mkdtempSync(join(tmpdir(), 'hl-ui-'))
const chrome = spawn(chromePath(), ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' })

let ws
try {
  let ok = false
  for (let i = 0; i < 60; i++) {
    try {
      await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      ok = true
      break
    } catch {
      await sleep(300)
    }
  }
  if (!ok) throw new Error('Chrome 未启动')
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
  ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  const cdp = new CDP(ws)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })

  /* 1. 空设备仍进启动闸门 */
  await cdp.send('Page.navigate', { url: `${BASE}/` })
  await sleep(2200)
  const gate = await cdp.evaluate('document.body.innerText.includes("这台设备上还没有记录")')
  if (!gate) problems.push('空设备未显示启动闸门')

  /* 2. 通过地址导入 */
  await cdp.evaluate(`(() => { [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '改用地址')?.click(); return true })()`)
  await sleep(300)
  await cdp.evaluate(`(() => {
    const input = document.querySelector('input[placeholder^="https://"]')
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(`${BASE}${SNAPSHOT}`)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(200)
  await cdp.evaluate(`(() => { [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '读取')?.click(); return true })()`)

  let ready = false
  for (let i = 0; i < 80; i++) {
    await sleep(500)
    ready = await cdp.evaluate(`document.body.innerText.includes('编辑模式')`)
    if (ready) break
  }
  if (!ready) throw new Error('导入后未进入作者端界面')

  const home = await cdp.evaluate(`(() => {
    const t = document.body.innerText
    return {
      editableBadge: t.includes('编辑模式'),
      personEdit: t.includes('编辑人物资料'),
      nodes: [...document.querySelectorAll('[data-testid="universe"] button[aria-label]')].filter(b => /共 |暂无内容/.test(b.getAttribute('aria-label'))).length,
      nav: ['首页','故事','相册','档案','设置'].filter(k => t.includes(k)),
      imageCount: [...document.images].filter(i => i.complete && i.naturalWidth > 0).length,
    };
  })()`)
  if (!home.editableBadge) problems.push('缺少「编辑模式」标记')
  if (!home.personEdit) problems.push('首页缺少「编辑人物资料」入口')
  if (home.nodes !== 5) problems.push(`宇宙节点 ${home.nodes} 个`)
  if (!home.nav.includes('设置')) problems.push('底部导航缺少「设置」')
  notes.push(`首页：编辑模式=${home.editableBadge}，节点 ${home.nodes}，图片 ${home.imageCount}，导航 ${home.nav.join('/')}`)
  await cdp.shot('04-author-home.png')

  /* 3. 故事页新增一条记录 */
  await cdp.send('Page.navigate', { url: `${BASE}/#/stories` })
  await sleep(2000)
  const before = await cdp.evaluate(`(() => {
    const t = document.body.innerText
    return { count: (t.match(/共 (\\d+) 条记录/) || [])[1], hasAdd: t.includes('记一笔') };
  })()`)
  if (!before.hasAdd) problems.push('故事页缺少「记一笔」按钮')

  await cdp.evaluate(`(() => { [...document.querySelectorAll('button')].find(b => b.innerText.includes('记一笔'))?.click(); return true })()`)
  await sleep(600)
  const modalOpen = await cdp.evaluate(`document.body.innerText.includes('记一笔') && !!document.querySelector('input')`)
  if (!modalOpen) problems.push('点击「记一笔」没有打开编辑弹窗')
  await cdp.shot('05-author-entry-editor.png')

  await cdp.evaluate(`(() => {
    const input = [...document.querySelectorAll('input')].find(i => i.placeholder === '一句话概括')
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '自动化验证：新增一条')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(200)
  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '保存')
    btn?.click(); return !!btn
  })()`)
  await sleep(2500)

  const after = await cdp.evaluate(`(() => {
    const t = document.body.innerText
    return { count: (t.match(/共 (\\d+) 条记录/) || [])[1], hasNew: t.includes('自动化验证：新增一条') };
  })()`)
  if (!after.hasNew) problems.push('新增记录后列表里没有出现该记录')
  if (before.count && after.count && Number(after.count) !== Number(before.count) + 1) {
    problems.push(`新增后记录数 ${before.count} → ${after.count}，未增加 1`)
  }
  notes.push(`故事页：${before.count} → ${after.count} 条，新记录可见=${after.hasNew}`)
  await cdp.shot('06-author-stories.png')

  /* 4. 详情页编辑/删除入口 */
  await cdp.evaluate(`(() => { document.querySelector('a[href*="/stories/"]')?.click(); return true })()`)
  await sleep(1800)
  const detail = await cdp.evaluate(`(() => {
    const t = document.body.innerText
    return { edit: t.includes('编辑这条'), del: t.includes('删除') };
  })()`)
  if (!detail.edit || !detail.del) problems.push('记录详情缺少编辑/删除入口')

  /* 4.5 相册：作者端每张照片都有删除入口，删一张会真的少一张 */
  await cdp.send('Page.navigate', { url: `${BASE}/#/album` })
  await sleep(2500)
  const albumBefore = await cdp.evaluate(`(() => {
    const t = document.body.innerText;
    return {
      count: Number((t.match(/共 (\\d+) 张照片/) || [])[1] || 0),
      deleteBtns: document.querySelectorAll('button[aria-label="删除这张照片"]').length,
      hasUpload: t.includes('上传照片'),
    };
  })()`)
  if (albumBefore.count === 0) problems.push('相册没有照片，无法验证删除')
  if (albumBefore.deleteBtns === 0) problems.push('相册里没有照片删除按钮')
  if (!albumBefore.hasUpload) problems.push('相册缺少上传入口')
  await cdp.shot('09-album-delete-buttons.png')

  await cdp.evaluate(`(() => { document.querySelector('button[aria-label="删除这张照片"]').click(); return true })()`)
  await sleep(600)
  const dialogText = await cdp.evaluate(`(() => {
    const body = document.body.innerText || '';
    return body.includes('删除这张照片？') ? '确认框已出现' : body.slice(0, 80);
  })()`)
  if (dialogText !== '确认框已出现') problems.push(`点删除没有弹出确认框（当前：${dialogText}）`)
  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '确定');
    btn?.click();
    return true;
  })()`)
  await sleep(1800)
  const albumAfter = await cdp.evaluate(`(() => {
    const t = document.body.innerText;
    return { count: Number((t.match(/共 (\\d+) 张照片/) || [])[1] || 0) };
  })()`)
  if (albumAfter.count !== albumBefore.count - 1) {
    problems.push(`删除照片后数量未减少：${albumBefore.count} → ${albumAfter.count}`)
  }
  notes.push(`相册删除：${albumBefore.count} → ${albumAfter.count} 张，删除按钮 ${albumBefore.deleteBtns} 个`)

  /* 4.6 大图里也有删除入口 */
  await cdp.evaluate(`(() => { const t = document.querySelector('button[aria-label^="查看照片"]'); t?.click(); return true })()`)
  await sleep(800)
  const lightbox = await cdp.evaluate(`(() => {
    const d = document.querySelector('[role="dialog"][aria-label="照片大图"]');
    return { open: !!d, hasDelete: d ? d.innerText.includes('删除这张') : false };
  })()`)
  if (!lightbox.open) problems.push('相册大图未打开')
  if (!lightbox.hasDelete) problems.push('大图查看器里没有删除入口')
  await cdp.shot('10-lightbox-delete.png')
  await cdp.evaluate(`(() => { document.querySelector('[role="dialog"] button[aria-label="关闭"]')?.click(); return true })()`)
  await sleep(400)

  /* 4.7 档案页：作者端必须有新增 / 编辑 / 删除，并且真的写进本机库 */
  await cdp.send('Page.navigate', { url: `${BASE}/#/archive` })
  await sleep(2600)

  const archiveTabs = await cdp.evaluate(`(() => {
    const t = document.body.innerText
    return {
      tabs: ['偏好习惯','心愿礼物','状态健康','每日状态','他的画像','纪念日','历史回顾'].filter(k => t.includes(k)),
      hasAdd: t.includes('新增'),
      editBtns: [...document.querySelectorAll('button')].filter(b => b.innerText.trim() === '编辑').length,
      delBtns: [...document.querySelectorAll('button')].filter(b => b.innerText.trim() === '删除').length,
    };
  })()`)
  if (archiveTabs.tabs.length !== 7) problems.push(`档案页标签只找到 ${archiveTabs.tabs.length} 个`)
  if (!archiveTabs.hasAdd) problems.push('档案页缺少「新增」按钮')
  if (archiveTabs.editBtns === 0) problems.push('档案页偏好列表没有「编辑」按钮')
  if (archiveTabs.delBtns === 0) problems.push('档案页偏好列表没有「删除」按钮')
  notes.push(`档案页：标签 ${archiveTabs.tabs.join('/')}，编辑 ${archiveTabs.editBtns} 个，删除 ${archiveTabs.delBtns} 个`)
  await cdp.shot('12-archive-author.png')

  const clickText = (text) => `(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === ${JSON.stringify(text)});
    b?.click(); return !!b;
  })()`
  const setInput = (selectorJs) => `(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const el = ${selectorJs};
    if (!el) return false;
    setter.call(el, window.__hlVerifyValue);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`

  /* 4.7.1 新增一条偏好 */
  await cdp.evaluate(clickText('新增'))
  await sleep(700)
  if (!(await cdp.evaluate(`document.body.innerText.includes('新增偏好')`))) {
    problems.push('点「新增」没有打开偏好弹窗')
  }
  await cdp.evaluate(`window.__hlVerifyValue = '自动化验证偏好'`)
  await cdp.evaluate(setInput(`[...document.querySelectorAll('input')].find(i => i.placeholder === '比如 冰美式')`))
  await sleep(250)
  await cdp.evaluate(clickText('保存'))
  await sleep(2200)
  if (!(await cdp.evaluate(`document.body.innerText.includes('自动化验证偏好')`))) {
    problems.push('新增偏好后列表里没有出现')
  }

  /* 4.7.2 编辑这条偏好 */
  await cdp.evaluate(`(() => {
    const li = [...document.querySelectorAll('li')].find(el => el.innerText.includes('自动化验证偏好'));
    const b = li && [...li.querySelectorAll('button')].find(x => x.innerText.trim() === '编辑');
    b?.click(); return !!b;
  })()`)
  await sleep(700)
  const editPrefModal = await cdp.evaluate(`document.body.innerText.includes('编辑偏好')`)
  if (!editPrefModal) problems.push('点「编辑」没有打开偏好弹窗')
  await cdp.evaluate(`window.__hlVerifyValue = '自动化验证偏好改'`)
  await cdp.evaluate(setInput(`[...document.querySelectorAll('input')].find(i => i.placeholder === '比如 冰美式')`))
  await sleep(250)
  await cdp.evaluate(clickText('保存'))
  await sleep(2200)
  const prefEdited = await cdp.evaluate(`document.body.innerText.includes('自动化验证偏好改')`)
  if (!prefEdited) problems.push('编辑偏好后名称没有更新')

  /* 4.7.3 删除这条偏好 */
  await cdp.evaluate(`(() => {
    const li = [...document.querySelectorAll('li')].find(el => el.innerText.includes('自动化验证偏好改'));
    const b = li && [...li.querySelectorAll('button')].find(x => x.innerText.trim() === '删除');
    b?.click(); return !!b;
  })()`)
  await sleep(600)
  if (!(await cdp.evaluate(`document.body.innerText.includes('删除这条偏好？')`))) {
    problems.push('点删除没有弹出偏好确认框')
  }
  await cdp.evaluate(clickText('确定'))
  await sleep(2000)
  const prefGone = await cdp.evaluate(`!document.body.innerText.includes('自动化验证偏好改')`)
  if (!prefGone) problems.push('删除偏好后条目仍在列表里')
  notes.push(`偏好：新增→编辑→删除 全部生效=${prefEdited && prefGone}`)

  /* 4.7.4 心愿礼物 tab 有两个新增入口 */
  await cdp.evaluate(clickText('心愿礼物'))
  await sleep(1200)
  const wishAdds = await cdp.evaluate(`(() => {
    const t = document.body.innerText;
    return { wish: t.includes('新增心愿'), gift: t.includes('新增礼物'), edit: [...document.querySelectorAll('button')].filter(b => b.innerText.trim() === '编辑').length };
  })()`)
  if (!wishAdds.wish) problems.push('心愿 tab 缺少「新增心愿」')
  if (!wishAdds.gift) problems.push('心愿 tab 缺少「新增礼物」')

  /* 4.7.4.5 心愿与礼物各新增一条再删掉 */
  await cdp.evaluate(clickText('新增心愿'))
  await sleep(700)
  if (!(await cdp.evaluate(`!!document.querySelector('textarea')`))) {
    problems.push('点「新增心愿」没有打开弹窗')
  }
  await cdp.evaluate(`window.__hlVerifyValue = '自动化验证心愿'`)
  await cdp.evaluate(`(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    const el = document.querySelector('textarea');
    if (!el) return false;
    setter.call(el, window.__hlVerifyValue);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  await sleep(300)
  await cdp.evaluate(clickText('保存'))
  await sleep(2200)
  const wishAdded = await cdp.evaluate(`document.body.innerText.includes('自动化验证心愿')`)
  if (!wishAdded) problems.push('新增心愿后列表里没有出现')
  await cdp.evaluate(`(() => {
    const row = [...document.querySelectorAll('li')].find(el => el.innerText.includes('自动化验证心愿'));
    const b = row && [...row.querySelectorAll('button')].find(x => x.innerText.trim() === '删除');
    b?.click(); return !!b;
  })()`)
  await sleep(600)
  await cdp.evaluate(clickText('确定'))
  await sleep(2000)
  const wishGone = await cdp.evaluate(`!document.body.innerText.includes('自动化验证心愿')`)
  if (!wishGone) problems.push('删除心愿后条目仍在列表里')
  notes.push(`心愿：新增=${wishAdded}，删除=${wishGone}`)

  await cdp.evaluate(clickText('新增礼物'))
  await sleep(700)
  if (!(await cdp.evaluate(`[...document.querySelectorAll('input')].some(i => i.type === 'date')`))) {
    problems.push('点「新增礼物」没有打开弹窗')
  }
  await cdp.evaluate(`window.__hlVerifyValue = '自动化验证礼物'`)
  await cdp.evaluate(`(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const el = [...document.querySelectorAll('input')].find(i => !i.type || i.type === 'text');
    if (!el) return false;
    setter.call(el, window.__hlVerifyValue);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  await sleep(300)
  await cdp.evaluate(clickText('保存'))
  await sleep(2200)
  const giftAdded = await cdp.evaluate(`document.body.innerText.includes('自动化验证礼物')`)
  if (!giftAdded) problems.push('新增礼物后列表里没有出现')
  await cdp.evaluate(`(() => {
    const row = [...document.querySelectorAll('li')].find(el => el.innerText.includes('自动化验证礼物'));
    const b = row && [...row.querySelectorAll('button')].find(x => x.innerText.trim() === '删除');
    b?.click(); return !!b;
  })()`)
  await sleep(600)
  await cdp.evaluate(clickText('确定'))
  await sleep(2000)
  const giftGone = await cdp.evaluate(`!document.body.innerText.includes('自动化验证礼物')`)
  if (!giftGone) problems.push('删除礼物后条目仍在列表里')
  notes.push(`礼物：新增=${giftAdded}，删除=${giftGone}`)

  /* 4.7.5 纪念日：新增后应出现在列表，删除后消失 */
  await cdp.evaluate(clickText('纪念日'))
  await sleep(1200)
  await cdp.evaluate(clickText('新增'))
  await sleep(700)
  if (!(await cdp.evaluate(`document.body.innerText.includes('新增纪念日')`))) {
    problems.push('点「新增」没有打开纪念日弹窗')
  }
  await cdp.evaluate(`window.__hlVerifyValue = '自动化验证纪念日'`)
  await cdp.evaluate(setInput(`[...document.querySelectorAll('input')].find(i => !i.type || i.type === 'text')`))
  await cdp.evaluate(`window.__hlVerifyValue = '2020-05-20'`)
  await cdp.evaluate(setInput(`document.querySelector('input[type="date"]')`))
  await sleep(300)
  await cdp.evaluate(clickText('保存'))
  await sleep(2200)
  const annAdded = await cdp.evaluate(`document.body.innerText.includes('自动化验证纪念日')`)
  if (!annAdded) problems.push('新增纪念日后列表里没有出现')
  await cdp.evaluate(`(() => {
    const li = [...document.querySelectorAll('li')].find(el => el.innerText.includes('自动化验证纪念日'));
    const b = li && [...li.querySelectorAll('button')].find(x => x.innerText.trim() === '删除');
    b?.click(); return !!b;
  })()`)
  await sleep(600)
  await cdp.evaluate(clickText('确定'))
  await sleep(2000)
  const annGone = await cdp.evaluate(`!document.body.innerText.includes('自动化验证纪念日')`)
  if (!annGone) problems.push('删除纪念日后条目仍在列表里')
  notes.push(`纪念日：新增=${annAdded}，删除=${annGone}`)
  await cdp.shot('13-archive-anniversary.png')

  /* 4.7.6 健康 / 画像 / 回顾：各新增一条再删掉，覆盖三个不同的 repo */
  const setTextarea = (selectorJs) => `(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    const el = ${selectorJs};
    if (!el) return false;
    setter.call(el, window.__hlVerifyValue);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`
  const deleteRowWith = (text) => `(() => {
    const row = [...document.querySelectorAll('li, article')].find(el => el.innerText.includes(${JSON.stringify(text)}));
    if (!row) return false;
    const b = [...row.querySelectorAll('button')].find(x => x.innerText.trim() === '删除');
    b?.click(); return !!b;
  })()`

  // 健康
  await cdp.evaluate(clickText('状态健康'))
  await sleep(1200)
  await cdp.evaluate(clickText('新增'))
  await sleep(700)
  const healthModal = await cdp.evaluate(`document.body.innerText.includes('新增健康记录')`)
  if (!healthModal) problems.push('点「新增」没有打开健康记录弹窗')
  await cdp.evaluate(`window.__hlVerifyValue = '自动化验证症状'`)
  await cdp.evaluate(setInput(`[...document.querySelectorAll('input')].find(i => i.placeholder === '比如 偏头痛')`))
  await sleep(300)
  await cdp.evaluate(clickText('保存'))
  await sleep(2200)
  const healthAdded = await cdp.evaluate(`document.body.innerText.includes('自动化验证症状')`)
  if (!healthAdded) problems.push('新增健康记录后列表里没有出现')
  await cdp.evaluate(deleteRowWith('自动化验证症状'))
  await sleep(600)
  await cdp.evaluate(clickText('确定'))
  await sleep(2000)
  const healthGone = await cdp.evaluate(`!document.body.innerText.includes('自动化验证症状')`)
  if (!healthGone) problems.push('删除健康记录后条目仍在列表里')
  notes.push(`健康：新增=${healthAdded}，删除=${healthGone}`)

  // 画像
  await cdp.evaluate(clickText('他的画像'))
  await sleep(1200)
  await cdp.evaluate(clickText('新增'))
  await sleep(700)
  const insightModal = await cdp.evaluate(`document.body.innerText.includes('新增画像条目')`)
  if (!insightModal) problems.push('点「新增」没有打开画像弹窗')
  await cdp.evaluate(`window.__hlVerifyValue = '自动化验证画像条目'`)
  await cdp.evaluate(setTextarea(`document.querySelector('textarea')`))
  await sleep(300)
  await cdp.evaluate(clickText('保存'))
  await sleep(2200)
  const insightAdded = await cdp.evaluate(`document.body.innerText.includes('自动化验证画像条目')`)
  if (!insightAdded) problems.push('新增画像后列表里没有出现')
  await cdp.evaluate(deleteRowWith('自动化验证画像条目'))
  await sleep(600)
  await cdp.evaluate(clickText('确定'))
  await sleep(2000)
  const insightGone = await cdp.evaluate(`!document.body.innerText.includes('自动化验证画像条目')`)
  if (!insightGone) problems.push('删除画像后条目仍在列表里')
  notes.push(`画像：新增=${insightAdded}，删除=${insightGone}`)

  // 回顾（走新增的 summaryRepo）
  await cdp.evaluate(clickText('历史回顾'))
  await sleep(1200)
  await cdp.evaluate(clickText('新增'))
  await sleep(700)
  const summaryModal = await cdp.evaluate(`document.body.innerText.includes('新增回顾')`)
  if (!summaryModal) problems.push('点「新增」没有打开回顾弹窗')
  await cdp.evaluate(`window.__hlVerifyValue = '自动化验证回顾'`)
  await cdp.evaluate(setInput(`[...document.querySelectorAll('input')].find(i => !i.type || i.type === 'text')`))
  await sleep(300)
  await cdp.evaluate(clickText('保存'))
  await sleep(2200)
  const summaryAdded = await cdp.evaluate(`document.body.innerText.includes('自动化验证回顾')`)
  if (!summaryAdded) problems.push('新增回顾后列表里没有出现')
  await cdp.evaluate(deleteRowWith('自动化验证回顾'))
  await sleep(600)
  await cdp.evaluate(clickText('确定'))
  await sleep(2000)
  const summaryGone = await cdp.evaluate(`!document.body.innerText.includes('自动化验证回顾')`)
  if (!summaryGone) problems.push('删除回顾后条目仍在列表里')
  notes.push(`回顾：新增=${summaryAdded}，删除=${summaryGone}`)

  // 每日状态（第 8 类，2026-10-26 新增）
  await cdp.evaluate(clickText('每日状态'))
  await sleep(1300)
  await cdp.evaluate(clickText('新增'))
  await sleep(800)
  const statusModal = await cdp.evaluate(`document.body.innerText.includes('新增每日状态')`)
  if (!statusModal) problems.push('点「新增」没有打开每日状态弹窗')
  // 日期默认已填；写「好事」字段
  await cdp.evaluate(`window.__hlVerifyValue = '自动化验证每日状态'`)
  await cdp.evaluate(setTextarea(`[...document.querySelectorAll('textarea')][0]`))
  await sleep(300)
  await cdp.evaluate(clickText('保存'))
  await sleep(2300)
  const statusAdded = await cdp.evaluate(`document.body.innerText.includes('自动化验证每日状态')`)
  if (!statusAdded) problems.push('新增每日状态后列表里没有出现')

  // 编辑
  await cdp.evaluate(`(() => {
    const row = [...document.querySelectorAll('li')].find(el => el.innerText.includes('自动化验证每日状态'));
    const b = row && [...row.querySelectorAll('button')].find(x => x.innerText.trim() === '编辑');
    b?.click(); return !!b;
  })()`)
  await sleep(800)
  const statusEditModal = await cdp.evaluate(`document.body.innerText.includes('编辑每日状态')`)
  if (!statusEditModal) problems.push('点「编辑」没有打开每日状态弹窗')
  await cdp.evaluate(`window.__hlVerifyValue = '自动化验证每日状态改'`)
  await cdp.evaluate(setTextarea(`[...document.querySelectorAll('textarea')][0]`))
  await sleep(300)
  await cdp.evaluate(clickText('保存'))
  await sleep(2300)
  const statusEdited = await cdp.evaluate(`document.body.innerText.includes('自动化验证每日状态改')`)
  if (!statusEdited) problems.push('编辑每日状态后内容没有更新')

  // 删除
  await cdp.evaluate(deleteRowWith('自动化验证每日状态改'))
  await sleep(600)
  await cdp.evaluate(clickText('确定'))
  await sleep(2000)
  const statusGone = await cdp.evaluate(`!document.body.innerText.includes('自动化验证每日状态改')`)
  if (!statusGone) problems.push('删除每日状态后条目仍在列表里')
  notes.push(`每日状态：新增=${statusAdded}，编辑=${statusEdited}，删除=${statusGone}`)

  /* 4.8 访客端档案页不得出现任何编辑入口 */
  await cdp.send('Page.navigate', { url: `${BASE}/viewer.html#/archive` })
  await sleep(2600)
  const visitorArchive = await cdp.evaluate(`(() => {
    const labels = [...document.querySelectorAll('button')].map(b => b.innerText.trim());
    return {
      add: labels.some(l => l.startsWith('新增')),
      edit: labels.includes('编辑'),
      del: labels.includes('删除'),
      count: labels.length,
    };
  })()`)
  if (visitorArchive.add || visitorArchive.edit || visitorArchive.del) {
    problems.push(`访客端档案页出现了编辑入口（新增=${visitorArchive.add} 编辑=${visitorArchive.edit} 删除=${visitorArchive.del}）`)
  }
  notes.push(`访客端档案：新增=${visitorArchive.add}，编辑=${visitorArchive.edit}，删除=${visitorArchive.del}`)
  await cdp.shot('14-archive-visitor.png')

  /* 5. 设置页仍可用（备份 / 多端同步） */
  await cdp.send('Page.navigate', { url: `${BASE}/#/settings` })
  await sleep(2200)
  const settings = await cdp.evaluate(`(() => {
    const t = document.body.innerText
    return { backup: t.includes('完整备份与恢复'), sync: t.includes('多端同步'), cloud: t.includes('云服务') };
  })()`)
  if (!settings.backup) problems.push('设置页缺少备份入口')
  if (!settings.sync) problems.push('设置页缺少多端同步入口')
  if (!settings.cloud) problems.push('设置页缺少云服务入口')
  notes.push(`设置页：备份=${settings.backup}，同步=${settings.sync}，云服务=${settings.cloud}`)
  await cdp.shot('07-author-settings.png')

  /* 6. 多端同步面板：范围说明应含照片与删除，且不再写「暂不同步」 */
  const syncPanel = await cdp.evaluate(`(() => {
    // 取「最小的」匹配元素：直接 find 会命中包住整页的外层容器，滚动就没效果
    const cards = [...document.querySelectorAll('section, div')]
      .filter((el) => el.innerText && el.innerText.includes('多端同步') && el.innerText.includes('同步范围与规则'))
      .sort((a, b) => a.innerText.length - b.innerText.length);
    const card = cards[0];
    if (!card) return { found: false };
    // 页面可能整体滚动，也可能在某个容器里滚动：两种都处理
    card.scrollIntoView({ block: 'center' });
    let node = card.parentElement;
    while (node) {
      if (node.scrollHeight > node.clientHeight + 4) node.scrollTop += card.getBoundingClientRect().top - 120;
      node = node.parentElement;
    }
    window.scrollTo(0, Math.max(0, window.scrollY + card.getBoundingClientRect().top - 120));
    const t = card.innerText;
    return {
      found: true,
      photos: /照片/.test(t),
      deletes: /删除/.test(t),
      stale: /暂不同步/.test(t),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`)
  if (!syncPanel.found) problems.push('找不到「多端同步」面板')
  if (syncPanel.found && !syncPanel.photos) problems.push('同步面板未说明照片同步')
  if (syncPanel.found && !syncPanel.deletes) problems.push('同步面板未说明删除同步')
  if (syncPanel.found && syncPanel.stale) problems.push('同步面板仍写着「暂不同步」，与实现不符')
  if (syncPanel.found && syncPanel.overflow > 1) problems.push(`同步面板横向溢出 ${syncPanel.overflow}px`)
  notes.push(`同步面板：照片=${syncPanel.photos}，删除=${syncPanel.deletes}，过时文案=${syncPanel.stale}`)

  /* 6.2 同步面板：合并语义与新出口必须存在（2026-10-26 覆盖事故的修复） */
  const syncActions = await cdp.evaluate(`(() => {
    const labels = [...document.querySelectorAll('button')].map(b => b.innerText.trim());
    const t = document.body.innerText;
    return {
      resync: labels.some(l => l.includes('从头重新拉取')),
      force: labels.some(l => l.includes('强制用本机覆盖云端')),
      mergeNote: t.includes('合并') && t.includes('不会用本机旧内容覆盖云端'),
    };
  })()`)
  if (!syncActions.resync) problems.push('同步面板缺少「从头重新拉取」入口')
  if (!syncActions.force) problems.push('同步面板缺少「强制用本机覆盖云端」入口')
  if (!syncActions.mergeNote) problems.push('同步面板未说明「双向同步是合并、不覆盖云端」')
  notes.push(`同步动作：重新拉取=${syncActions.resync}，强制覆盖=${syncActions.force}，合并说明=${syncActions.mergeNote}`)

  /* 6.5 发布到展示端面板：文案与按钮存在，且不暴露内部表名 */
  const pubPanel = await cdp.evaluate(`(() => {
    const cards = [...document.querySelectorAll('section, div')]
      .filter((el) => el.innerText && el.innerText.includes('发布到展示端') && el.innerText.includes('只读快照'))
      .sort((a, b) => a.innerText.length - b.innerText.length);
    const card = cards[0];
    if (!card) return { found: false };
    card.scrollIntoView({ block: 'center' });
    let node = card.parentElement;
    while (node) {
      if (node.scrollHeight > node.clientHeight + 4) node.scrollTop += card.getBoundingClientRect().top - 120;
      node = node.parentElement;
    }
    window.scrollTo(0, Math.max(0, window.scrollY + card.getBoundingClientRect().top - 120));
    const t = card.innerText;
    return {
      found: true,
      button: t.includes('发布到展示端'),
      liveLine: t.includes('线上版本'),
      leaksTable: /heartlog_public_/.test(t),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`)
  if (!pubPanel.found) problems.push('设置页找不到「发布到展示端」面板')
  if (pubPanel.found && !pubPanel.button) problems.push('发布面板缺少发布按钮')
  if (pubPanel.found && !pubPanel.liveLine) problems.push('发布面板没有显示线上版本')
  if (pubPanel.found && pubPanel.leaksTable) problems.push('发布面板暴露了内部表名')
  if (pubPanel.found && pubPanel.overflow > 1) problems.push(`发布面板横向溢出 ${pubPanel.overflow}px`)
  notes.push(`发布面板：按钮=${pubPanel.button}，线上版本行=${pubPanel.liveLine}，泄露表名=${pubPanel.leaksTable}`)
  await sleep(400)
  await cdp.shot('11-author-publish-panel.png')

  /* 6.3 同步后必须重读本机库：
     验证两件事——
     a) 库里的新行确实能渲染出来（数据层没问题）；
     b) SyncPanel 的同步动作真的会调用 AuthorReload（不调用就会「拉到了但界面没变」）。
     注意：hash 导航不会重新加载页面，必须硬刷新才读库。 */
  const personIdForProbe = await cdp.evaluate(`(async () => {
    const open = indexedDB.open('heartlog');
    const dbh = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error) });
    const tx = dbh.transaction('persons', 'readonly');
    const req = tx.objectStore('persons').getAll();
    const rows = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) });
    const p = rows.find((x) => x.isActive) || rows[0];
    return p ? p.id : '';
  })()`)
  if (!personIdForProbe) problems.push('找不到本机人物，无法做重读探针')

  await cdp.evaluate(`(async () => {
    const open = indexedDB.open('heartlog');
    const dbh = await new Promise((res) => { open.onsuccess = () => res(open.result) });
    const tx = dbh.transaction('preferences', 'readwrite');
    const now = new Date().toISOString();
    tx.objectStore('preferences').put({
      id: 'pr_reload_probe', personId: ${JSON.stringify(personIdForProbe)}, category: '探针',
      name: '重读探针偏好', direction: 'like', tags: [], evidenceEntryIds: [],
      createdAt: now, updatedAt: now,
    });
    return true;
  })()`)

  await cdp.send('Page.reload', { ignoreCache: true })
  await sleep(3000)
  await cdp.send('Page.navigate', { url: `${BASE}/#/archive?tab=preferences` })
  await sleep(2600)
  const probeVisible = await cdp.evaluate(`document.body.innerText.includes('重读探针偏好')`)
  if (!probeVisible) problems.push('本机库新增的偏好硬刷新后仍不显示（数据读取层有问题）')
  notes.push(`重读探针：库内新增 + 硬刷新后页面可见=${probeVisible}`)

  await cdp.evaluate(`(async () => {
    const open = indexedDB.open('heartlog');
    const dbh = await new Promise((res) => { open.onsuccess = () => res(open.result) });
    const tx = dbh.transaction('preferences', 'readwrite');
    tx.objectStore('preferences').delete('pr_reload_probe');
    return true;
  })()`)

  /* b) 源码断言：三个同步动作都必须调用 reload，否则界面不会更新 */
  const syncCallsReload = (() => {
    const src = readFileSync(join(ROOT, 'src/components/SyncPanel.tsx'), 'utf8')
    const usesHook = /useAuthorReload\(\)/.test(src)
    const calls = (src.match(/await reload\?\.\(\)/g) || []).length
    return { usesHook, calls }
  })()
  if (!syncCallsReload.usesHook) problems.push('SyncPanel 未接入 AuthorReload，同步后界面不会更新')
  if (syncCallsReload.calls < 3) problems.push(`SyncPanel 只有 ${syncCallsReload.calls} 处调用 reload，应为同步/上传/重新拉取三处`)
  notes.push(`同步后重读：接入 hook=${syncCallsReload.usesHook}，调用点=${syncCallsReload.calls} 处`)
  await sleep(400)
  await cdp.shot('08-author-sync-panel.png')


  /* ---------- T5 回忆录：新建 → 加章节 → 写字 → 保存 → 刷新仍在 ---------- */
  await cdp.send('Page.navigate', { url: `${BASE}/#/memoir` })
  await sleep(2600)
  const memoirPage = await cdp.evaluate(`({
    hasNav: document.body.innerText.includes('回忆录'),
    hasCreate: [...document.querySelectorAll('button')].some(b => b.innerText.includes('新建回忆录')),
  })`)
  if (!memoirPage.hasNav) problems.push('作者端没有回忆录入口')
  if (!memoirPage.hasCreate) problems.push('回忆录页缺少「新建回忆录」按钮')

  const created = await cdp.evaluate(`(async () => {
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('新建回忆录'));
    btn?.click();
    await new Promise(r => setTimeout(r, 800));
    const db = await new Promise((res) => { const r = indexedDB.open('heartlog'); r.onsuccess = () => res(r.result) });
    const all = await new Promise((res) => { const q = db.transaction('memoirs').objectStore('memoirs').getAll(); q.onsuccess = () => res(q.result) });
    db.close();
    return { count: all.length, id: all[0]?.id ?? null };
  })()`)
  if (created.count !== 1) problems.push(`新建回忆录后库里有 ${created.count} 本，预期 1 本`)

  const filled = await cdp.evaluate(`(async () => {
    const setVal = (el, v) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const title = document.querySelector('input[placeholder="回忆录标题"]');
    if (!title) return { error: '没有标题输入框' };
    setVal(title, '自测回忆录标题');
    const add = [...document.querySelectorAll('button')].find(b => b.innerText.includes('添加章节'));
    if (!add) return { error: '没有添加章节按钮' };
    add.click();
    await new Promise(r => setTimeout(r, 600));
    const ta = document.querySelector('textarea');
    if (!ta) return { error: '加章节后没有正文输入框' };
    setVal(ta, '这一章是界面里写进去的。');
    const save = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '保存');
    if (!save) return { error: '没有保存按钮' };
    save.click();
    await new Promise(r => setTimeout(r, 900));
    return { ok: true };
  })()`)
  if (filled?.error) problems.push(`回忆录编辑失败：${filled.error}`)

  const saved = await cdp.evaluate(`(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('heartlog'); r.onsuccess = () => res(r.result) });
    const all = await new Promise((res) => { const q = db.transaction('memoirs').objectStore('memoirs').getAll(); q.onsuccess = () => res(q.result) });
    db.close();
    const m = all[0];
    return m ? { title: m.title, sections: m.sections?.length ?? 0, body: m.sections?.[0]?.body ?? '' } : null;
  })()`)
  if (!saved) problems.push('回忆录没有写进本机库')
  else {
    if (saved.title !== '自测回忆录标题') problems.push(`标题未保存：${saved.title}`)
    if (saved.sections !== 1) problems.push(`章节数 ${saved.sections}，预期 1`)
    if (!saved.body.includes('界面里写进去的')) problems.push(`正文未保存：${saved.body.slice(0, 20)}`)
  }

  await cdp.send('Page.reload', { ignoreCache: true })
  await sleep(2600)
  const persisted = await cdp.evaluate(`document.body.innerText.includes('自测回忆录标题')`)
  if (!persisted) problems.push('刷新后回忆录标题不显示（读写或渲染有问题）')
  notes.push(`回忆录：新建=1 本，章节=1，正文已保存，刷新后仍在=${persisted}`)
  await cdp.shot('09-memoir.png')

  // 清掉自测数据，避免影响后续人工查看
  await cdp.evaluate(`(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('heartlog'); r.onsuccess = () => res(r.result) });
    await new Promise((res) => { const q = db.transaction('memoirs', 'readwrite').objectStore('memoirs').clear(); q.onsuccess = () => res(); });
    db.close();
    return true;
  })()`)

  /* ---------- T6 第三版：互动内容作者闭环 ---------- */
  await cdp.send('Page.navigate', { url: `${BASE}/#/settings` })
  await sleep(2200)
  const settingsGame = await cdp.evaluate(`(() => ({
    manage: [...document.querySelectorAll('button')].some(b => b.innerText.includes('管理五道题与抽卡内容')),
    switches: ['把时光排好', '关于他的五道题', '今天一起做什么'].every((t) => document.body.innerText.includes(t)),
  }))()`)
  if (!settingsGame.manage || !settingsGame.switches) problems.push(`设置页互动内容入口不完整：${JSON.stringify(settingsGame)}`)

  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('管理五道题与抽卡内容'));
    btn?.click();
    return !!btn;
  })()`)
  await sleep(1600)
  if (!(await cdp.evaluate(`location.hash === '#/game-content' && document.body.innerText.includes('互动内容')`))) problems.push('互动内容管理页没有打开')

  const createdQuiz = await cdp.evaluate(`(async () => {
    const setVal = (el, v) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const section = [...document.querySelectorAll('section')].find(s => s.innerText.includes('关于他的五道题'));
    const add = section ? [...section.querySelectorAll('button')].find(b => b.innerText.includes('新增')) : null;
    add?.click();
    await new Promise(r => setTimeout(r, 500));
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return { error: '题目编辑弹窗未打开' };
    setVal(dialog.querySelector('textarea'), '自测：他更喜欢晴天还是雨天？');
    const textInputs = [...dialog.querySelectorAll('input:not([type="radio"])')];
    setVal(textInputs[0], '晴天');
    setVal(textInputs[1], '雨天');
    dialog.querySelector('input[type="radio"]').click();
    await new Promise(r => setTimeout(r, 200));
    const save = [...dialog.querySelectorAll('button')].find(b => b.innerText.trim() === '保存');
    save?.click();
    await new Promise(r => setTimeout(r, 900));
    const db = await new Promise((res) => { const q = indexedDB.open('heartlog'); q.onsuccess = () => res(q.result) });
    const rows = await new Promise((res) => { const q = db.transaction('gameContent').objectStore('gameContent').getAll(); q.onsuccess = () => res(q.result) });
    db.close();
    const quiz = rows.find((row) => row.prompt === '自测：他更喜欢晴天还是雨天？');
    return { ok: Boolean(quiz), count: rows.length, id: quiz?.id ?? '' };
  })()`)
  if (!createdQuiz.ok) problems.push(`五道题创建失败：${JSON.stringify(createdQuiz)}`)

  await cdp.send('Page.reload', { ignoreCache: true })
  await sleep(2200)
  const quizPersisted = await cdp.evaluate(`document.body.innerText.includes('自测：他更喜欢晴天还是雨天？')`)
  if (!quizPersisted) problems.push('五道题刷新后没有保留')

  const editedQuiz = await cdp.evaluate(`(async () => {
    const setVal = (el, v) => {
      const proto = HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const card = [...document.querySelectorAll('article')].find(a => a.innerText.includes('自测：他更喜欢晴天还是雨天？'));
    const edit = card ? [...card.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '编辑') : null;
    edit?.click();
    await new Promise(r => setTimeout(r, 500));
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return { error: '编辑弹窗未打开' };
    setVal(dialog.querySelector('textarea'), '自测：他最喜欢晴天还是雨天？');
    [...dialog.querySelectorAll('button')].find(b => b.innerText.trim() === '保存')?.click();
    await new Promise(r => setTimeout(r, 900));
    return { ok: document.body.innerText.includes('自测：他最喜欢晴天还是雨天？') };
  })()`)
  if (!editedQuiz.ok) problems.push(`五道题编辑失败：${JSON.stringify(editedQuiz)}`)

  const createdCard = await cdp.evaluate(`(async () => {
    const setVal = (el, v) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const section = [...document.querySelectorAll('section')].find(s => s.innerText.includes('今天一起做什么'));
    const add = section ? [...section.querySelectorAll('button')].find(b => b.innerText.includes('新增')) : null;
    add?.click();
    await new Promise(r => setTimeout(r, 500));
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return { error: '抽卡编辑弹窗未打开' };
    const select = dialog.querySelector('select');
    setVal(select, 'surprise');
    setVal(dialog.querySelector('textarea'), '自测：交换一句今天的谢谢');
    setVal(dialog.querySelector('input'), 'setting:any，budget:free，duration:short');
    [...dialog.querySelectorAll('button')].find(b => b.innerText.trim() === '保存')?.click();
    await new Promise(r => setTimeout(r, 900));
    const db = await new Promise((res) => { const q = indexedDB.open('heartlog'); q.onsuccess = () => res(q.result) });
    const rows = await new Promise((res) => { const q = db.transaction('gameContent').objectStore('gameContent').getAll(); q.onsuccess = () => res(q.result) });
    db.close();
    const card = rows.find((row) => row.text === '自测：交换一句今天的谢谢');
    return { ok: Boolean(card), kind: card?.kind ?? '', category: card?.category ?? '' };
  })()`)
  if (!createdCard.ok || createdCard.kind !== 'dateCard' || createdCard.category !== 'surprise') problems.push(`活动卡创建失败：${JSON.stringify(createdCard)}`)

  const disabledQuiz = await cdp.evaluate(`(async () => {
    const card = [...document.querySelectorAll('article')].find(a => a.innerText.includes('自测：他最喜欢晴天还是雨天？'));
    const toggle = card ? [...card.querySelectorAll('button')].find(b => ['停用', '启用'].includes(b.innerText.trim())) : null;
    toggle?.click();
    await new Promise(r => setTimeout(r, 600));
    const db = await new Promise((res) => { const q = indexedDB.open('heartlog'); q.onsuccess = () => res(q.result) });
    const rows = await new Promise((res) => { const q = db.transaction('gameContent').objectStore('gameContent').getAll(); q.onsuccess = () => res(q.result) });
    db.close();
    const quiz = rows.find((row) => row.prompt === '自测：他最喜欢晴天还是雨天？');
    return { enabled: quiz?.enabled, ok: quiz?.enabled === false };
  })()`)
  if (!disabledQuiz.ok) problems.push(`五道题停用失败：${JSON.stringify(disabledQuiz)}`)

  // 打开第三版三个开关，再确认作者端大厅出现对应卡片
  await cdp.send('Page.navigate', { url: `${BASE}/#/settings` })
  await sleep(2200)
  for (const label of ['把时光排好', '关于他的五道题', '今天一起做什么']) {
    await cdp.evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes(${JSON.stringify(label)}));
      const on = btn?.getAttribute('aria-checked') === 'true' || btn?.querySelector('.bg-rose-deep');
      if (btn && !on) btn.click();
      return !!btn;
    })()`)
    await sleep(1000)
  }
  await cdp.send('Page.navigate', { url: `${BASE}/#/game` })
  await sleep(2200)
  const authorHall = await cdp.evaluate(`(() => ({
    timeline: document.body.innerText.includes('把时光排好'),
    quiz: document.body.innerText.includes('关于他的五道题'),
    dateDraw: document.body.innerText.includes('今天一起做什么'),
  }))()`)
  if (!authorHall.timeline || !authorHall.quiz || !authorHall.dateDraw) problems.push(`作者端大厅缺第三版玩法：${JSON.stringify(authorHall)}`)
  notes.push(`互动内容：创建/刷新/编辑/停用通过，大厅第三版入口=${JSON.stringify(authorHall)}`)
  await cdp.shot('10-game-content.png')

  if (cdp.logs.length) problems.push(`控制台错误：${cdp.logs.slice(0, 2).join(' | ')}`)
} finally {
  try {
    ws?.close()
  } catch {}
  chrome.kill()
}

for (const n of notes) console.log(`· ${n}`)
console.log('\n—— 结果 ——')
if (problems.length) {
  console.error('✗ 作者端界面校验失败：')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('✓ 作者端已使用访客端界面，并可新增/编辑记录。')
console.log(`截图：${OUT}`)
