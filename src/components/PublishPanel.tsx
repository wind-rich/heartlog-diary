import { useEffect, useState } from 'react'
import { AlertTriangle, Check, CloudUpload, History, Loader2, Power, PowerOff, RotateCcw } from 'lucide-react'
import { SectionCard, useConfirm, useToast } from './ui'
import { getCloudSession } from '../lib/cloud'
import {
  currentPublished,
  currentPublishState,
  listPublishedVersions,
  previewPublish,
  publishToCloud,
  resumePublish,
  retractPublish,
  rollbackToVersion,
  PublishError,
  type PublishLiveState,
  type PublishPreview,
  type PublishProgress,
  type PublishResult,
  type PublishedVersion,
} from '../lib/publish'
import { fmtDate, fmtTime, parseAny } from '../lib/date'

const PHASE_TEXT: Record<PublishProgress['phase'], string> = {
  prepare: '整理内容',
  photos: '上传照片',
  snapshot: '写入快照',
}

function stampOf(iso: string): string {
  if (!iso) return '时间未知'
  const d = parseAny(iso)
  return `${fmtDate(d)} ${fmtTime(d)}`
}

function countsLine(counts: Record<string, number>): string {
  const parts = [
    `${counts.entries ?? 0} 记录`,
    `${counts.photos ?? 0} 照片`,
    `${counts.preferences ?? 0} 偏好`,
  ]
  if (counts.wishes) parts.push(`${counts.wishes} 心愿`)
  if (counts.health) parts.push(`${counts.health} 健康`)
  return parts.join(' · ')
}

/**
 * 发布到展示端（D-012 + T4 一致性）。
 *
 * 与「多端同步」是两件事：
 * - 多端同步：作者自己的设备之间对齐数据（私有）。
 * - 发布：把当前内容写进公网页读取的只读快照（公开）。
 *
 * T4 补的四件事都在这里可见：
 * 1. **预览与差异**：发布前先算「这次会改什么」，不再盲发；
 * 2. **版本历史**：每次发布留一份完整 payload，可以回到任意一版；
 * 3. **原子切换**：线上快照是单行，写一次就整体换版，访客不会看到混排；
 * 4. **真正撤回**：把快照下线**并且**让访客端读到 `retracted`，不再回退旧内容。
 */
export function PublishPanel() {
  const toast = useToast()
  const confirm = useConfirm()
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [live, setLive] = useState<{ publishId: string; publishedAt: string } | null>(null)
  const [state, setState] = useState<PublishLiveState | 'none'>('none')
  const [stateNote, setStateNote] = useState('')
  const [preview, setPreview] = useState<PublishPreview | null>(null)
  const [previewErr, setPreviewErr] = useState('')
  const [versions, setVersions] = useState<PublishedVersion[]>([])
  const [showVersions, setShowVersions] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<PublishProgress | null>(null)
  const [result, setResult] = useState<PublishResult | null>(null)
  const [err, setErr] = useState('')

  const refresh = async () => {
    const cur = await currentPublished()
    setLive(cur)
    const st = await currentPublishState()
    setState(st.state)
    setStateNote(st.note)
    try {
      setPreview(await previewPublish())
      setPreviewErr('')
    } catch (e) {
      setPreview(null)
      setPreviewErr((e as Error).message)
    }
    setVersions(await listPublishedVersions())
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      const session = await getCloudSession()
      if (!alive) return
      setSignedIn(session !== null)
      if (session) await refresh()
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
      await refresh()
      toast(`已发布：${res.entries} 条记录、${res.photos} 张照片`)
    } catch (e) {
      setErr(e instanceof PublishError ? e.message : (e as Error).message)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  async function doRollback(v: PublishedVersion) {
    const ok = await confirm({
      title: `回到 ${v.publishId}？`,
      desc:
        `会把线上内容整体换回这一版（${countsLine(v.counts)}）。\n` +
        '当前这一版不会丢：它还在版本历史里，随时可以再换回来。',
      confirmText: '回到这一版',
    })
    if (!ok) return
    setBusy(true)
    setErr('')
    setResult(null)
    try {
      const res = await rollbackToVersion(v.publishId)
      await refresh()
      toast(`已回到 ${res.publishId}：${res.entries} 条记录、${res.photos} 张照片`)
    } catch (e) {
      setErr(e instanceof PublishError ? e.message : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function doRetract() {
    const ok = await confirm({
      title: '把展示页暂时下线？',
      desc:
        '访客打开链接会看到「暂时没有开放」，不会再看到任何内容（包括旧版本）。\n' +
        '数据不会删，随时可以重新上线。',
      danger: true,
      confirmText: '下线',
    })
    if (!ok) return
    setBusy(true)
    setErr('')
    try {
      await retractPublish('作者把展示页暂时下线了，稍后再来看看吧。')
      await refresh()
      toast('展示页已下线')
    } catch (e) {
      setErr(e instanceof PublishError ? e.message : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function doResume() {
    setBusy(true)
    setErr('')
    try {
      await resumePublish()
      await refresh()
      toast('展示页已重新上线')
    } catch (e) {
      setErr(e instanceof PublishError ? e.message : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const retracted = state === 'retracted'

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

        <div className="rounded-lg border border-cream-200 bg-cream-50 px-3 py-2 text-[12px] leading-relaxed">
          <p>
            线上版本：
            {live ? `${live.publishId} · ${stampOf(live.publishedAt)}` : signedIn === false ? '需要先登录云端' : '还没有发布过'}
          </p>
          <p className={retracted ? 'mt-0.5 text-[#8E4850]' : 'mt-0.5 text-ink-500'}>
            访问状态：{retracted ? '已下线（访客看不到任何内容）' : state === 'live' ? '对外可见' : '未设置（沿用默认）'}
          </p>
        </div>

        {/* 预览：发布前先看清「这次会改什么」 */}
        {signedIn && (
          <div className="rounded-lg border border-cream-200 bg-white px-3 py-2 text-[12px] leading-relaxed">
            <p className="text-[11.5px] font-medium text-ink-600">这次发布的变化</p>
            {preview ? (
              preview.hasChanges ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-600">
                  {preview.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-ink-500">与本机完全一致，没有内容变化（发布会刷新媒体指纹与时间）。</p>
              )
            ) : (
              <p className="mt-1 text-ink-400">{previewErr || '无法计算差异'}</p>
            )}
            {preview && preview.live && preview.hasChanges && (
              <p className="mt-1 text-[11px] text-ink-400">
                变化是相对线上 {preview.live.publishId}（{stampOf(preview.live.publishedAt)}）计算的。
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px]"
            onClick={() => void doPublish()}
            disabled={busy || signedIn !== true}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />}
            {retracted ? '发布并重新上线' : '发布到展示端'}
          </button>

          <button
            type="button"
            className="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px]"
            onClick={() => setShowVersions((v) => !v)}
            disabled={!versions.length}
          >
            <History size={13} /> 版本历史（{versions.length}）
          </button>

          {retracted ? (
            <button
              type="button"
              className="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px]"
              onClick={() => void doResume()}
              disabled={busy}
            >
              <Power size={13} /> 重新上线
            </button>
          ) : (
            <button
              type="button"
              className="btn-text inline-flex items-center gap-1.5 px-2 py-1.5 text-[12px] text-[#8E4850]"
              onClick={() => void doRetract()}
              disabled={busy || signedIn !== true}
            >
              <PowerOff size={13} /> 暂时下线
            </button>
          )}
        </div>

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

        {showVersions && versions.length > 0 && (
          <div className="rounded-lg border border-cream-200 bg-cream-50 px-3 py-2 text-[12px]">
            <p className="text-[11.5px] text-ink-500">
              每次发布都会留一份完整版本。回到旧版本后，当前版本仍在列表里，可以再换回来。
            </p>
            <ul className="mt-1.5 space-y-1.5">
              {versions.map((v) => (
                <li key={v.publishId} className="rounded-md bg-white/80 px-2 py-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[11.5px] text-ink-700">
                        {v.publishId}
                        {v.isLive && (
                          <span className="ml-1 rounded bg-[#E7F0E2] px-1 text-[10px] text-[#4F6B45]">线上</span>
                        )}
                      </p>
                      <p className="text-[10.5px] text-ink-400">
                        {stampOf(v.publishedAt)} · {countsLine(v.counts)}
                      </p>
                    </div>
                    {!v.isLive && (
                      <button
                        type="button"
                        className="shrink-0 btn-text px-0 py-0 text-[11px]"
                        onClick={() => void doRollback(v)}
                        disabled={busy}
                      >
                        <RotateCcw size={11} className="mr-0.5 inline" />
                        回到这一版
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {stateNote && retracted && (
          <p className="text-[11.5px] text-ink-500">下线时给访客看的说明：{stateNote}</p>
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
              <p className="text-[11.5px] text-[#8E4850]">{result.errors.join('；')}</p>
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
            <li>删掉的照片不会再出现在公网页；云端旧图暂不回收，所以回到旧版本时图还在</li>
            <li>发布内容是「当前本机数据」，发布前建议先「双向同步」拿到其他设备的改动</li>
            <li>「暂时下线」会让访客看到提示页而不是旧内容；重新上线不会重新上传照片</li>
          </ul>
        </div>
      </div>
    </SectionCard>
  )
}
