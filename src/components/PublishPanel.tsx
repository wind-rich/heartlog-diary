import { useEffect, useState } from 'react'
import { AlertTriangle, Check, CloudUpload, Loader2 } from 'lucide-react'
import { SectionCard, useToast } from './ui'
import { getCloudSession } from '../lib/cloud'
import { currentPublished, publishToCloud, PublishError, type PublishProgress, type PublishResult } from '../lib/publish'
import { fmtDate, fmtTime, parseAny } from '../lib/date'

const PHASE_TEXT: Record<PublishProgress['phase'], string> = {
  prepare: '整理内容',
  photos: '上传照片',
  snapshot: '写入快照',
}

/**
 * 发布到展示端（D-012）。
 *
 * 与「多端同步」是两件事：
 * - 多端同步：作者自己的设备之间对齐数据（私有）。
 * - 发布：把当前内容写进公网页读取的只读快照（公开）。
 */
export function PublishPanel() {
  const toast = useToast()
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [live, setLive] = useState<{ publishId: string; publishedAt: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<PublishProgress | null>(null)
  const [result, setResult] = useState<PublishResult | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const session = await getCloudSession()
      if (!alive) return
      setSignedIn(session !== null)
      if (session) {
        const cur = await currentPublished()
        if (alive) setLive(cur)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  async function doPublish() {
    setBusy(true)
    setErr('')
    setResult(null)
    setProgress(null)
    try {
      const res = await publishToCloud({ onProgress: setProgress })
      setResult(res)
      setLive({ publishId: res.publishId, publishedAt: res.publishedAt })
      toast(`已发布：${res.entries} 条记录、${res.photos} 张照片`)
    } catch (e) {
      setErr(e instanceof PublishError ? e.message : (e as Error).message)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-1.5">
          <CloudUpload size={15} className="text-rose-deep" /> 发布到展示端
        </span>
      }
    >
      <div className="space-y-2.5 text-[13px] text-ink-700">
        <p className="text-[12.5px] leading-relaxed text-ink-500">
          发布后，公网页（访客看到的那个链接）刷新就能看到当前内容，不需要重新构建。
          发布的是<strong className="font-medium text-ink-700">只读快照</strong>，访客看不到草稿、设置或密钥。
        </p>

        <p className="text-[12px] text-ink-500">
          线上版本：
          {live
            ? `${live.publishId} · ${fmtDate(parseAny(live.publishedAt))} ${fmtTime(parseAny(live.publishedAt))}`
            : signedIn === false
              ? '需要先登录云端'
              : '还没有发布过'}
        </p>

        <button
          type="button"
          className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px]"
          onClick={() => void doPublish()}
          disabled={busy || signedIn !== true}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />}
          发布到展示端
        </button>

        {busy && progress && (
          <div className="space-y-1">
            <p className="text-[12px] text-ink-600">
              {PHASE_TEXT[progress.phase]}
              {progress.total > 0 ? ` ${progress.done}/${progress.total}` : '…'}
              {progress.phase === 'photos' && progress.total > 8 ? '（照片多时需要几分钟）' : ''}
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-cream-200">
              <div
                className="h-full rounded-full bg-rose-deep transition-all"
                style={{ width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 8}%` }}
              />
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-1 rounded-lg border border-cream-200 bg-cream-50 px-3 py-2 text-[12.5px]">
            <div className="flex items-center gap-1 text-[#4F6B45]">
              <Check size={13} /> 已发布 {result.entries} 条记录、{result.photos} 张照片
            </div>
            <p className="text-[11.5px] text-ink-500">
              照片上传 {result.photosUploaded} 格、跳过未变 {result.photosSkipped} 格，
              共 {Math.round(result.bytesUploaded / 1024 / 1024)} MB
            </p>
            {result.errors.length > 0 && (
              <p className="text-[11.5px] text-[#8E4850]">
                {result.errors.length} 张照片没传成功（{result.errors[0]}），其余已发布。再点一次发布会补传。
              </p>
            )}
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
            <li>重新发布只上传改过的照片（按内容指纹判断），没变的不重传</li>
            <li>删掉的照片不会再出现在公网页，但云端旧图暂不回收</li>
            <li>发布内容是「当前本机数据」，发布前建议先「双向同步」拿到其他设备的改动</li>
          </ul>
        </div>
      </div>
    </SectionCard>
  )
}
