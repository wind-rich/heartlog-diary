/**
 * 导出「文稿包」（T5）。
 *
 * 与「完整备份 ZIP」是两个用途，不要混：
 * - 完整备份：给机器读，用于**恢复**（data.json + 照片原图 + 版本号）；
 * - 文稿包：给人读，用于**留存/转存/编辑**（README + 按年记录 + 档案 + 回忆录 + 相对媒体）。
 *
 * 这里不碰 AI：关掉 AI 仍能导出（T5 验收项），所以面板里没有任何 AI 相关开关。
 */
import { useState } from 'react'
import { AlertTriangle, Check, Download, FileText, Loader2 } from 'lucide-react'
import { SectionCard, Switch, useToast } from './ui'
import { exportMarkdownBundle, type BundleManifest } from '../lib/markdownBundle'

const FILE_STAMP = (iso: string) => iso.slice(0, 16).replace(/[:T]/g, ' ')

export function BundleExportPanel() {
  const toast = useToast()
  const [includePhotos, setIncludePhotos] = useState(true)
  const [includeArchives, setIncludeArchives] = useState(true)
  const [includeMemoirs, setIncludeMemoirs] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BundleManifest | null>(null)
  const [err, setErr] = useState('')

  const doExport = async () => {
    setBusy(true)
    setErr('')
    setResult(null)
    try {
      const m = await exportMarkdownBundle({
        includePhotos,
        includeArchives,
        includeSummaries: includeArchives,
        includeMemoirs,
      })
      setResult(m)
      toast(`文稿包已开始下载：${m.counts.entries} 条记录、${m.counts.photos} 张照片`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-1.5">
          <FileText size={15} className="text-rose-deep" /> 导出文稿包（Markdown）
        </span>
      }
    >
      <div className="space-y-2.5 text-[13px] text-ink-700">
        <p className="text-[12.5px] leading-relaxed text-ink-500">
          导出成<strong className="font-medium text-ink-700">一个可以直接读的目录</strong>：入口说明 + 按年记录 + 档案 + 回忆录 +
          相对图片目录。图片用相对路径引用，解压后用任何 Markdown 阅读器都能顺着链接读。
        </p>

        <div className="space-y-1.5 rounded-xl border border-cream-200 bg-cream-50 px-3 py-2">
          <Switch
            checked={includePhotos}
            onChange={setIncludePhotos}
            label="包含照片"
            desc="原图打进 media/photos/，体积最大；关掉只留文字与照片说明。"
          />
          <Switch
            checked={includeArchives}
            onChange={setIncludeArchives}
            label="包含档案与回顾"
            desc="偏好、心愿、礼物、健康、每日状态、我的观察、回顾报告。"
          />
          <Switch
            checked={includeMemoirs}
            onChange={setIncludeMemoirs}
            label="包含回忆录"
            desc="含章节来源标记与引用链接。"
          />
        </div>

        <button
          type="button"
          className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px]"
          onClick={() => void doExport()}
          disabled={busy}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          导出文稿包（ZIP）
        </button>

        {result && (
          <div className="space-y-1 rounded-lg border border-cream-200 bg-cream-50 px-3 py-2 text-[12.5px]">
            <div className="flex items-center gap-1 text-[#4F6B45]">
              <Check size={13} /> 已导出 {result.files.length} 个文件 · 记录 {result.counts.entries} 条 · 照片{' '}
              {result.counts.photos} 张 · 回忆录 {result.counts.memoirs} 本
            </div>
            <p className="text-[11.5px] text-ink-500">
              数据来源：本机库（已同步副本）。上次同步：
              {result.source.lastSyncedAt ? FILE_STAMP(result.source.lastSyncedAt) : '从未同步'}
              {result.source.newerThanSync > 0 ? ` · 有 ${result.source.newerThanSync} 行尚未上行` : ''}
            </p>
            <p className="text-[11.5px] leading-relaxed text-ink-400">{result.source.note}</p>
          </div>
        )}

        {err && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-soft/50 bg-[#FFF3F1] px-3 py-2 text-[12.5px] text-[#8E4850]">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        <div className="rounded-lg bg-cream-50 px-3 py-2 text-[11.5px] leading-relaxed text-ink-500">
          <ul className="list-disc space-y-0.5 pl-4">
            <li>
              和「完整备份 ZIP」不是一回事：备份给机器恢复用，文稿包给人读。两样都建议留，但用途不同。
            </li>
            <li>文稿包是完整私人内容（含健康与情绪）。发给别人或上传网盘前先想清楚。</li>
            <li>导出不会改动数据库，也不会把 Markdown 反向写回——它只是一次性快照。</li>
          </ul>
        </div>
      </div>
    </SectionCard>
  )
}
