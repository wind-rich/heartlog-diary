import { useEffect, useMemo, useState } from 'react'
import JSZip from 'jszip'
import { Download, Eye, FileText, Loader2, Printer } from 'lucide-react'
import { DEFAULT_EXPORT_MODULES, type AllData, type ExportOptions, buildMarkdown, buildPrintHtml, downloadBlob, rangePresets } from '../lib/exporter'
import { blobToDataURL } from '../lib/photo'
import { toDateStr } from '../lib/date'
import { Field, Modal, Switch, useToast } from './ui'

const MODULE_LABELS: { key: keyof ExportOptions['modules']; label: string }[] = [
  { key: 'profile', label: '基础档案' },
  { key: 'preferences', label: '兴趣与偏好' },
  { key: 'entries', label: '生活时间线' },
  { key: 'statuses', label: '每日状态' },
  { key: 'wishes', label: '愿望清单' },
  { key: 'gifts', label: '礼物记录' },
  { key: 'health', label: '健康记录' },
  { key: 'insights', label: '个人画像' },
  { key: 'summaries', label: '回顾报告' },
]

type PresetKey = 'week' | 'lastWeek' | 'month' | 'lastMonth' | 'year' | 'custom'

export default function ExportDialog({
  open,
  onClose,
  data,
}: {
  open: boolean
  onClose: () => void
  data: AllData
}) {
  const toast = useToast()
  const presets = useMemo(() => rangePresets(), [])
  const [preset, setPreset] = useState<PresetKey>('month')
  const [customStart, setCustomStart] = useState(toDateStr(presets.thisMonth.start))
  const [customEnd, setCustomEnd] = useState(toDateStr(presets.thisMonth.end))
  const [modules, setModules] = useState(DEFAULT_EXPORT_MODULES)
  const [includePhotos, setIncludePhotos] = useState(true)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!open) setPreview(null)
  }, [open])

  const range = useMemo(() => {
    if (preset === 'custom') {
      const s = new Date(customStart)
      const e = new Date(customEnd)
      e.setHours(23, 59, 59, 999)
      return { start: s, end: e }
    }
    const map: Record<Exclude<PresetKey, 'custom'>, keyof ReturnType<typeof rangePresets>> = {
      week: 'thisWeek',
      lastWeek: 'lastWeek',
      month: 'thisMonth',
      lastMonth: 'lastMonth',
      year: 'thisYear',
    }
    const p = presets[map[preset]]
    return { start: p.start, end: p.end }
  }, [preset, customStart, customEnd, presets])

  const rangeLabel = `${toDateStr(range.start)} ~ ${toDateStr(range.end)}`

  const slice = useMemo(() => {
    const s = range.start.getTime()
    const e = range.end.getTime()
    const inR = (iso?: string) => {
      if (!iso) return false
      const t = new Date(iso).getTime()
      return t >= s && t <= e
    }
    return {
      person: data.person,
      entries: data.entries.filter((x) => inR(x.occurredAt)),
      statuses: data.statuses.filter((x) => inR(x.date)),
      preferences: data.preferences,
      wishes: data.wishes.filter((x) => inR(x.raisedAt ?? x.createdAt)),
      gifts: data.gifts.filter((x) => inR(x.givenAt)),
      health: data.health.filter((x) => inR(x.occurredAt)),
      photos: data.photos.filter((x) => inR(x.takenAt ?? x.createdAt)),
      insights: data.insights,
      summaries: data.summaries.filter((x) => inR(x.createdAt)),
    } as AllData
  }, [data, range])

  const counts = {
    entries: slice.entries.length,
    photos: includePhotos ? slice.photos.length : 0,
    statuses: slice.statuses.length,
  }

  const buildOptions = (): ExportOptions => ({
    rangeStart: range.start,
    rangeEnd: range.end,
    modules,
    includePhotos,
    imagePrefix: 'images/',
  })

  /** 构建打印/预览 HTML（图片内联为 dataURL，确保打印时不变形不丢图） */
  const buildHtml = async (autoPrint = false) => {
    const opts = buildOptions()
    const images =
      includePhotos && modules.entries
        ? await Promise.all(
            slice.photos.slice(0, 120).map(async (p) => ({
              id: p.id,
              dataUrl: await blobToDataURL(p.thumb),
              caption: p.caption,
            })),
          )
        : []
    return buildPrintHtml(slice, opts, images, autoPrint)
  }

  const doPreview = async () => {
    setBusy(true)
    try {
      const html = await buildHtml()
      setPreview(html)
    } catch (e) {
      toast(`预览生成失败：${(e as Error).message}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  const doPrint = async () => {
    setBusy(true)
    try {
      const html = await buildHtml(true)
      const w = window.open('', '_blank')
      if (!w) {
        toast('浏览器拦截了新窗口，请允许弹出窗口后重试', 'err')
        return
      }
      w.document.open()
      w.document.write(html)
      w.document.close()
      toast('已打开打印页，选择「另存为 PDF」即可')
    } finally {
      setBusy(false)
    }
  }

  const doMarkdownZip = async () => {
    setBusy(true)
    try {
      const opts = buildOptions()
      const zip = new JSZip()
      const imageMap = new Map<string, string>()
      if (includePhotos) {
        const folder = zip.folder('images')!
        for (const p of slice.photos) {
          const ext = p.mime.includes('png') ? 'png' : 'jpg'
          const name = `${p.id}.${ext}`
          folder.file(name, p.blob)
          imageMap.set(p.id, name)
        }
      }
      const md = buildMarkdown(slice, opts, imageMap)
      zip.file(`心意簿-${toDateStr(range.start)}-${toDateStr(range.end)}.md`, md)
      zip.file(
        'README.txt',
        [
          '心意簿 · Markdown 导出',
          `范围：${rangeLabel}`,
          `包含照片：${includePhotos ? '是（见 images 目录）' : '否'}`,
          '',
          'Markdown 文件用相对路径 images/ 引用图片，解压后直接打开即可。',
        ].join('\r\n'),
      )
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
      downloadBlob(blob, `心意簿-Markdown-${toDateStr(range.start)}-${toDateStr(range.end)}.zip`)
      toast('Markdown 已导出（含图片目录）')
    } catch (e) {
      toast(`导出失败：${(e as Error).message}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  const doMarkdownOnly = async () => {
    const md = buildMarkdown(slice, buildOptions())
    downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `心意簿-${toDateStr(range.start)}-${toDateStr(range.end)}.md`)
    toast('Markdown 文本已导出')
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="导出与留存"
      full
      footer={
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={onClose}>
            关闭
          </button>
          <button className="btn-ghost flex-1" onClick={doPreview} disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />} 预览
          </button>
          <button className="btn-primary flex-1" onClick={doPrint} disabled={busy}>
            <Printer size={15} /> 导出 PDF
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="时间范围">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {(
              [
                ['week', '本周'],
                ['lastWeek', '上周'],
                ['month', '本月'],
                ['lastMonth', '上月'],
                ['year', '今年'],
                ['custom', '自定义'],
              ] as [PresetKey, string][]
            ).map(([k, label]) => (
              <button key={k} className={preset === k ? 'chip-on' : 'chip-off'} onClick={() => setPreset(k)}>
                {label}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="flex gap-2">
              <input type="date" className="input flex-1" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
              <input type="date" className="input flex-1" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
            </div>
          )}
          <p className="mt-1.5 text-[12px] text-ink-300">
            {rangeLabel} · 将包含 {counts.entries} 条事件、{counts.statuses} 条每日状态
            {includePhotos ? `、${counts.photos} 张照片` : ''}
          </p>
        </Field>

        <Field label="导出模块">
          <div className="flex flex-wrap gap-1.5">
            {MODULE_LABELS.map((m) => (
              <button
                key={m.key}
                className={modules[m.key] ? 'chip-on' : 'chip-off'}
                onClick={() => setModules((prev) => ({ ...prev, [m.key]: !prev[m.key] }))}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-1.5">
            <button
              className="chip-off !text-[12.5px]"
              onClick={() => setModules(Object.fromEntries(MODULE_LABELS.map((m) => [m.key, true])) as ExportOptions['modules'])}
            >
              全选
            </button>
            <button
              className="chip-off !text-[12.5px]"
              onClick={() => setModules(Object.fromEntries(MODULE_LABELS.map((m) => [m.key, false])) as ExportOptions['modules'])}
            >
              全不选
            </button>
            <button className="chip-off !text-[12.5px]" onClick={() => setIncludePhotos(false)}>
              只导出文字
            </button>
          </div>
        </Field>

        <Switch
          checked={includePhotos}
          onChange={setIncludePhotos}
          label="包含照片"
          desc="打印/PDF 会内联缩略图，Markdown 会打包 images 目录。照片越多导出越慢。"
        />

        <div className="rounded-xl bg-cream-100 border border-cream-200 p-3 text-[12.5px] text-ink-500 leading-relaxed space-y-1.5">
          <p className="font-medium text-ink-700">三种留存的区别</p>
          <p>· <b>PDF</b>（浏览器打印）：适合阅读、打印、留念，中文与图片会按 A4 排版。</p>
          <p>· <b>Markdown</b>：适合编辑、归档、迁移，图片用相对路径引用，可打包成 ZIP。</p>
          <p>· <b>完整备份 ZIP</b>（在「设置」里）：带版本号的 JSON + 照片原图，可用于恢复数据。</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost flex-1 !text-[13.5px]" onClick={doMarkdownZip} disabled={busy}>
            <Download size={15} /> Markdown + 图片 ZIP
          </button>
          <button className="btn-ghost flex-1 !text-[13.5px]" onClick={doMarkdownOnly}>
            <FileText size={15} /> 仅 Markdown
          </button>
        </div>

        {preview && (
          <div>
            <div className="label">预览（下方即为 PDF 排版效果）</div>
            <iframe title="导出预览" className="print-frame rounded-xl border border-cream-200 bg-white" style={{ height: 460 }} srcDoc={preview} />
            <button className="btn-text mt-2" onClick={() => setPreview(null)}>
              收起预览
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
