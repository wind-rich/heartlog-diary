import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle2,
  Cloud,
  Database,
  Download,
  HardDrive,
  Image as ImageIcon,
  Info,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { aiChat, aiReady } from '../lib/ai'
import { db } from '../db/db'
import { exportBackup, importBackupZip, storageEstimate, wipeAllData, type ImportMode, type ImportResult } from '../lib/backup'
import { fmtSize } from '../lib/photo'
import { Field, Modal, SectionCard, Segmented, Switch, Tag, useConfirm, useToast } from '../components/ui'
import { useApp } from '../state/app'

export default function SettingsPage() {
  const nav = useNavigate()
  const { aiConfig, saveAIConfig, prefs, savePrefs } = useApp()
  const toast = useToast()
  const confirm = useConfirm()

  const [baseUrl, setBaseUrl] = useState(aiConfig.baseUrl)
  const [apiKey, setApiKey] = useState(aiConfig.apiKey)
  const [model, setModel] = useState(aiConfig.model)
  const [proxyUrl, setProxyUrl] = useState(aiConfig.proxyUrl ?? '')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const [storage, setStorage] = useState<{ usage: number; quota: number } | undefined>()
  const [importOpen, setImportOpen] = useState(false)
  const [importMode, setImportMode] = useState<ImportMode>('merge')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    storageEstimate().then(setStorage)
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const persistAI = async (patch: Partial<typeof aiConfig>) => {
    await saveAIConfig(patch)
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const testConfig = { ...aiConfig, baseUrl, apiKey, model, proxyUrl, enabled: true }
      const reply = await aiChat(testConfig, [{ role: 'user', content: '请只回复两个字：可用' }], { maxTokens: 20 })
      setTestResult({ ok: true, msg: `连接成功：${reply.slice(0, 40)}` })
    } catch (e) {
      const err = e as { message: string; detail?: string }
      setTestResult({ ok: false, msg: `${err.message}${err.detail ? `\n${err.detail}` : ''}` })
    } finally {
      setTesting(false)
    }
  }

  const doBackup = async () => {
    setBackupBusy(true)
    try {
      await exportBackup()
      toast('完整备份已开始下载')
    } catch (e) {
      toast(`备份失败：${(e as Error).message}`, 'err')
    } finally {
      setBackupBusy(false)
    }
  }

  const doImport = async (file: File) => {
    setImporting(true)
    setImportResult(null)
    try {
      const res = await importBackupZip(file, importMode)
      setImportResult(res)
      if (res.errors.length) toast('导入过程中出现问题，请看下方说明', 'err')
      else toast('恢复完成')
    } catch (e) {
      setImportResult({ imported: {}, skipped: {}, errors: [(e as Error).message], warnings: [] })
    } finally {
      setImporting(false)
      if (importRef.current) importRef.current.value = ''
    }
  }

  const totalCounts = db.tables

  return (
    <div className="space-y-3 pb-6">
      <button className="btn-text" onClick={() => nav(-1)}>
        <ArrowLeft size={15} /> 返回
      </button>

      {/* AI */}
      <SectionCard
        title={
          <>
            <Sparkles size={15} className="text-rose-deep" /> AI 增强
          </>
        }
        action={<Tag color={aiReady(aiConfig) ? '#8CBF9B' : '#B9ADA2'}>{aiReady(aiConfig) ? '已启用' : '未启用'}</Tag>}
      >
        <Switch
          checked={aiConfig.enabled}
          onChange={(v) => persistAI({ enabled: v })}
          label="启用 AI 功能"
          desc="关闭时，记录、检索、统计、导出等全部功能照常使用，只是不显示 AI 按钮。"
        />

        <div className="mt-3 space-y-3">
          <Field label="接入方式">
            <Segmented
              options={[
                { value: 'direct', label: '直连模型接口' },
                { value: 'proxy', label: '经自建代理（推荐）' },
              ]}
              value={aiConfig.viaProxy ? 'proxy' : 'direct'}
              onChange={(v) => persistAI({ viaProxy: v === 'proxy' })}
            />
            <p className="mt-1.5 text-[12px] text-ink-300 leading-relaxed">
              {aiConfig.viaProxy
                ? '请求会发到你自己的代理服务，密钥保存在服务端，浏览器里不存 Key。项目里附带 server/proxy.mjs 可直接运行。'
                : '密钥会保存在本机浏览器的 IndexedDB 里，只在你自己的设备上。缺点是部分模型服务的跨域（CORS）可能被浏览器拦截。'}
            </p>
          </Field>

          {aiConfig.viaProxy ? (
            <Field label="代理地址" hint="例：http://127.0.0.1:8787/v1（脚本默认监听 8787）。">
              <input className="input" value={proxyUrl} onChange={(e) => setProxyUrl(e.target.value)} onBlur={() => persistAI({ proxyUrl })} />
            </Field>
          ) : (
            <>
              <Field label="接口地址" hint="兼容 OpenAI 格式，例：https://api.deepseek.com/v1">
                <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} onBlur={() => persistAI({ baseUrl })} />
              </Field>
              <Field label="API Key" hint="只保存在这台设备的浏览器里。">
                <input
                  className="input"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onBlur={() => persistAI({ apiKey })}
                  placeholder="sk-..."
                />
              </Field>
            </>
          )}

          <Field label="模型名">
            <input
              className="input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              onBlur={() => persistAI({ model })}
              placeholder="deepseek-chat / gpt-4o-mini / qwen-plus …"
            />
          </Field>

          <button className="btn-ghost w-full" onClick={testConnection} disabled={testing}>
            {testing ? <Loader2 size={15} className="animate-spin" /> : <Cloud size={15} />}
            测试连接
          </button>

          {testResult && (
            <div
              className={`rounded-xl p-3 text-[13px] whitespace-pre-line ${
                testResult.ok ? 'bg-[#E9F5EC] border border-[#C4E0CC] text-[#3F6B4C]' : 'bg-[#FDECEA] border border-[#F5C9C3] text-[#9B3B2E]'
              }`}
            >
              {testResult.msg}
            </div>
          )}
        </div>
      </SectionCard>

      {/* 照片 */}
      <SectionCard
        title={
          <>
            <ImageIcon size={15} className="text-rose-deep" /> 照片
          </>
        }
      >
        <Switch
          checked={prefs.keepOriginalPhoto}
          onChange={(v) => savePrefs({ keepOriginalPhoto: v })}
          label="保留原图"
          desc="关闭时会把大图压到 1920px 再存，能省很多空间；开启则完整保留原始文件。"
        />
        <Field label="压缩后最长边（像素）" hint="仅在上面的开关关闭时生效。">
          <Segmented
            options={[
              { value: '1280', label: '1280' },
              { value: '1920', label: '1920' },
              { value: '2560', label: '2560' },
            ]}
            value={String(prefs.photoMaxEdge)}
            onChange={(v) => savePrefs({ photoMaxEdge: Number(v) })}
          />
        </Field>
      </SectionCard>

      {/* 提醒 */}
      <SectionCard
        title={
          <>
            <Info size={15} className="text-rose-deep" /> 提醒
          </>
        }
      >
        <Switch
          checked={prefs.remindersEnabled}
          onChange={(v) => savePrefs({ remindersEnabled: v })}
          label="在「今天」页显示临近的生日与纪念日"
          desc="纯本地计算，不发送通知、不需要联网。"
        />
        <Field label="提前提醒天数">
          <Segmented
            options={[
              { value: '3', label: '3 天' },
              { value: '7', label: '7 天' },
              { value: '30', label: '30 天' },
              { value: '60', label: '60 天' },
            ]}
            value={String(prefs.remindDaysAhead)}
            onChange={(v) => savePrefs({ remindDaysAhead: Number(v) })}
          />
        </Field>
      </SectionCard>

      {/* 备份与恢复 */}
      <SectionCard
        title={
          <>
            <Database size={15} className="text-rose-deep" /> 完整备份与恢复
          </>
        }
      >
        <div className="rounded-xl bg-cream-100 border border-cream-200 p-3 text-[12.5px] text-ink-500 leading-relaxed mb-3">
          备份是带版本号的 ZIP：<b className="text-ink-700">data.json</b>（全部文字记录）+{' '}
          <b className="text-ink-700">photos/</b>（照片原图与缩略图）。清空浏览器数据会丢失记录，所以建议定期备份。
        </div>

        <div className="flex flex-col gap-2">
          <button className="btn-primary" onClick={doBackup} disabled={backupBusy}>
            {backupBusy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            导出完整备份（ZIP）
          </button>
          <button className="btn-ghost" onClick={() => setImportOpen(true)}>
            <Upload size={16} /> 从备份恢复
          </button>
          <button
            className="btn-ghost !text-[#C6452F]"
            onClick={async () => {
              const ok = await confirm({
                title: '清空全部数据？',
                desc: '所有档案、记录、照片都会被删除，且无法撤销。\n强烈建议先导出完整备份。',
                danger: true,
                confirmText: '我确定要清空',
              })
              if (!ok) return
              const again = await confirm({
                title: '再确认一次',
                desc: '真的要删除全部数据吗？这一步之后没有后悔药。',
                danger: true,
                confirmText: '确认清空',
              })
              if (!again) return
              await wipeAllData()
              toast('已清空，正在重新初始化…')
              setTimeout(() => window.location.reload(), 600)
            }}
          >
            <Trash2 size={16} /> 清空全部数据
          </button>
        </div>

        {storage && (
          <div className="mt-3">
            <div className="flex items-center gap-2 text-[12.5px] text-ink-500">
              <HardDrive size={13} />
              已使用 {fmtSize(storage.usage)}
              {storage.quota ? ` / 可用 ${fmtSize(storage.quota)}` : ''}
            </div>
            {storage.quota > 0 && (
              <div className="mt-1.5 h-1.5 rounded-full bg-cream-200 overflow-hidden">
                <div
                  className="h-full bg-rose-soft"
                  style={{ width: `${Math.min(100, (storage.usage / storage.quota) * 100).toFixed(1)}%` }}
                />
              </div>
            )}
            <p className="mt-1.5 text-[11.5px] text-ink-300">
              数据保存在浏览器的 IndexedDB 中。清理浏览器数据、使用无痕模式或更换浏览器都会导致记录不可见。
            </p>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          {totalCounts.map((t) => (
            <CountCell key={t.name} name={t.name} />
          ))}
        </div>
      </SectionCard>

      {/* 安装到桌面 */}
      <InstallCard />

      {/* 关于 */}
      <SectionCard
        title={
          <>
            <Info size={15} className="text-rose-deep" /> 关于
          </>
        }
      >
        <div className="text-[13px] text-ink-500 leading-relaxed space-y-2">
          <p className="flex items-center gap-2">
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}
            当前状态：{online ? '在线（AI 功能可用）' : '离线（记录与导出照常可用）'}
          </p>
          <p>心意簿 v1.0 · 本地优先 PWA。所有记录默认只存在你自己的设备上，应用本身不上传任何数据。</p>
          <p>农历、节气、传统节日与法定节假日全部在本地计算，断网时生日和纪念日提醒依然正常。</p>
          <p>
            AI 是可选增强：未配置时，记录、检索、统计、画像手动维护、Markdown/PDF 导出和完整备份恢复都能正常使用。
          </p>
          <p className="text-ink-300">
            隐私边界：调用 AI 前会让你选择是否包含健康记录与私人备注；照片分析是独立开关，默认关闭。
          </p>
        </div>
      </SectionCard>

      {/* 导入弹窗 */}
      <Modal
        open={importOpen}
        onClose={() => {
          setImportOpen(false)
          setImportResult(null)
        }}
        title="从备份恢复"
        footer={
          importResult ? (
            <button
              className="btn-primary w-full"
              onClick={() => {
                setImportOpen(false)
                setImportResult(null)
                window.location.reload()
              }}
            >
              完成并刷新
            </button>
          ) : undefined
        }
      >
        <div className="space-y-3">
          <Field label="恢复方式">
            <Segmented
              options={[
                { value: 'merge', label: '合并（推荐）' },
                { value: 'replace', label: '覆盖（先清空）' },
              ]}
              value={importMode}
              onChange={(v) => setImportMode(v as ImportMode)}
            />
            <p className="mt-1.5 text-[12.5px] text-ink-300 leading-relaxed">
              {importMode === 'merge'
                ? '已有的记录不会被覆盖：id 相同的跳过，事件还会额外按「同一时间 + 同一标题」判重，只补进新的内容。'
                : '会先清空本机现有数据，再完整恢复备份里的内容。适合换设备后一次性迁移。'}
            </p>
          </Field>

          <input
            ref={importRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) doImport(f)
            }}
          />
          <button className="btn-primary w-full" onClick={() => importRef.current?.click()} disabled={importing}>
            {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {importing ? '正在恢复…' : '选择备份文件（.zip）'}
          </button>

          {importResult && (
            <div className="space-y-2">
              {importResult.errors.length > 0 && (
                <div className="rounded-xl bg-[#FDECEA] border border-[#F5C9C3] p-3 text-[13px] text-[#9B3B2E]">
                  {importResult.errors.map((e, i) => (
                    <p key={i}>{e}</p>
                  ))}
                </div>
              )}
              {Object.keys(importResult.imported).length > 0 && (
                <div className="rounded-xl bg-[#E9F5EC] border border-[#C4E0CC] p-3 text-[13px] text-[#3F6B4C]">
                  <p className="flex items-center gap-1.5 font-medium mb-1">
                    <CheckCircle2 size={14} /> 恢复结果
                  </p>
                  {Object.entries(importResult.imported).map(([k, v]) => (
                    <p key={k}>
                      {k}：新增 {v} 条
                      {importResult.skipped[k] ? `，跳过重复 ${importResult.skipped[k]} 条` : ''}
                    </p>
                  ))}
                </div>
              )}
              {importResult.warnings.length > 0 && (
                <div className="rounded-xl bg-[#FFF3E6] border border-[#F0D9B5] p-3 text-[12.5px] text-[#A9762C]">
                  {importResult.warnings.slice(0, 8).map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

function CountCell({ name }: { name: string }) {
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    const table = (db as unknown as Record<string, { count: () => Promise<number> }>)[name]
    table?.count().then(setCount)
  }, [name])
  const labels: Record<string, string> = {
    persons: '人物',
    preferences: '偏好',
    entries: '事件',
    dailyStatus: '每日状态',
    health: '健康',
    gifts: '礼物',
    wishes: '愿望',
    photos: '照片',
    insights: '画像',
    summaries: '报告',
    meta: '设置项',
  }
  return (
    <div className="rounded-xl bg-cream-100 px-3 py-2 flex items-center justify-between">
      <span className="text-[12.5px] text-ink-500">{labels[name] ?? name}</span>
      <span className="text-[13.5px] text-ink-900 font-medium">{count ?? '—'}</span>
    </div>
  )
}

function InstallCard() {
  const [prompt, setPrompt] = useState<{ prompt: () => Promise<void> } | null>(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setPrompt(e as unknown as { prompt: () => Promise<void> })
    }
    window.addEventListener('beforeinstallprompt', handler)
    if (window.matchMedia('(display-mode: standalone)').matches) setInstalled(true)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  return (
    <SectionCard
      title={
        <>
          <RotateCcw size={15} className="text-rose-deep" /> 安装到手机桌面
        </>
      }
    >
      {installed ? (
        <p className="text-[13px] text-[#3F6B4C]">已经作为独立应用在运行了。</p>
      ) : prompt ? (
        <>
          <p className="text-[13px] text-ink-500 mb-3">安装后可以像普通 App 一样从桌面打开，也能离线使用。</p>
          <button
            className="btn-primary w-full"
            onClick={async () => {
              await prompt.prompt()
              setPrompt(null)
            }}
          >
            立即安装
          </button>
        </>
      ) : (
        <div className="text-[13px] text-ink-500 leading-relaxed space-y-1.5">
          <p className="font-medium text-ink-700">iPhone / iPad：</p>
          <p>Safari 打开 → 底部分享按钮 → 「添加到主屏幕」</p>
          <p className="font-medium text-ink-700 mt-2">Android：</p>
          <p>Chrome 打开 → 右上角菜单 → 「安装应用」或「添加到主屏幕」</p>
          <p className="text-[12px] text-ink-300 mt-2">
            提示：安装后请勿清理浏览器数据，否则本地记录会一起被删除。重要内容记得定期导出备份。
          </p>
        </div>
      )}
    </SectionCard>
  )
}
