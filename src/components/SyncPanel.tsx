import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Cloud,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { SectionCard, useToast, useConfirm } from './ui'
import { getCloudSession } from '../lib/cloud'
import { useAuthorReload } from '../viewer/author/AuthorReload'
import { db } from '../db/db'
import {
  cleanupConflicts,
  conflictEntityLabel,
  conflictSummary,
  conflictTally,
  dismissConflict,
  restoreConflict,
  type ConflictCopy,
} from '../lib/conflicts'
import {
  lastSyncedAt,
  pendingDeletionCount,
  pushLocalToCloud,
  runSync,
  resetSyncCursor,
  SyncError,
  type SyncProgress,
  type SyncResult,
} from '../lib/sync'
import { fmtDate, parseAny, fmtTime } from '../lib/date'
import { probeTaskCloudWrite, type TaskCloudProbeResult } from '../tasks/sync'

const PHASE_TEXT: Record<SyncProgress['phase'], string> = {
  pull: '读取云端记录',
  push: '上传本机记录',
  'photos-up': '上传照片',
  'photos-down': '下载照片',
  deletes: '同步删除',
}

/**
 * 多端同步面板（D-009）。
 *
 * 登录仍在「云服务」面板里完成，这里只显示状态、提供同步动作与结果明细，
 * 避免两处重复登录入口。
 */
export function SyncPanel() {
  const toast = useToast()
  const confirm = useConfirm()
  /**
   * 同步把云端内容写进本机 Dexie 后，页面那份快照还是旧的（AuthorViewer 只在挂载时读库）。
   * 不重读就会出现「云端明明拉到了、界面上却没有」——用户看到的是「同步没生效」。
   */
  const reload = useAuthorReload()
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [account, setAccount] = useState('')
  const [lastAt, setLastAt] = useState('')
  const [pendingDeletes, setPendingDeletes] = useState(0)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [pushedOnly, setPushedOnly] = useState<Awaited<ReturnType<typeof pushLocalToCloud>> | null>(null)
  const [err, setErr] = useState('')
  /** 冲突副本：同步时「较旧那次被覆盖」留下的备份，默认折叠 */
  const [conflicts, setConflicts] = useState<ConflictCopy[]>([])
  const [showConflicts, setShowConflicts] = useState(false)
  const conflictCount = conflicts.length
  const tally = conflictTally(conflicts)
  /** 待办提醒云写入自检（R-032）：真实会话写两行再读回，结论分「能写回/只在本机」 */
  const [probeBusy, setProbeBusy] = useState(false)
  const [probe, setProbe] = useState<TaskCloudProbeResult | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const session = await getCloudSession()
      const at = await lastSyncedAt()
      const pending = await pendingDeletionCount()
      const pendingConflicts = await db.conflicts.orderBy('detectedAt').reverse().toArray()
      if (!alive) return
      setSignedIn(session !== null)
      setAccount(session?.user?.email || session?.user?.name || '')
      setLastAt(at)
      setPendingDeletes(pending)
      setConflicts(pendingConflicts)
    })()
    return () => {
      alive = false
    }
  }, [])

  const onProgress = (p: SyncProgress) => setProgress(p)

  async function doUpload(force = false) {
    setBusy(true)
    setErr('')
    setPushedOnly(null)
    setResult(null)
    setProgress(null)
    try {
      const res = await pushLocalToCloud({ onProgress }, force)
      setPushedOnly(res)
      setLastAt(res.lastSyncedAt)
      setPendingDeletes(await pendingDeletionCount())
      setConflicts(await db.conflicts.orderBy('detectedAt').reverse().toArray())
      await reload?.()
      toast(
        res.heldBack > 0
          ? `已上传 ${res.pushed} 条；${res.heldBack} 条云端更新、本机较旧，已跳过`
          : `已上传 ${res.pushed} 条记录、${res.photosUploaded} 张照片`,
      )
    } catch (e) {
      setErr(e instanceof SyncError ? e.message : (e as Error).message)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  /** 强制用本机覆盖云端：会丢掉其他设备上更新的内容，必须显式确认 */
  async function doForceUpload() {
    const ok = await confirm({
      title: '用本机内容覆盖云端？',
      desc:
        '这会把本机的记录强制写成云端版本，**其他设备上更新的内容会被覆盖且无法找回**。\n' +
        '只有确认「云端才是旧的」时才用。日常同步请用「双向同步」。',
    })
    if (!ok) return
    await doUpload(true)
  }

  async function doSync() {
    setBusy(true)
    setErr('')
    setResult(null)
    setProgress(null)
    try {
      const res = await runSync({ onProgress })
      setResult(res)
      setLastAt(res.lastSyncedAt)
      setPendingDeletes(await pendingDeletionCount())
      setConflicts(await db.conflicts.orderBy('detectedAt').reverse().toArray())
      // 拉到的内容写进了本机库，必须让页面重读，否则界面还是同步前的样子
      await reload?.()
      toast(`同步完成：上传 ${res.pushed} 条，更新本机 ${res.pulled} 条`)
    } catch (e) {
      setErr(e instanceof SyncError ? e.message : (e as Error).message)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  /**
   * 清空同步游标后重新全量拉取。
   * 用途：游标被推到未来（旧版本曾用本机时间兜底）导致一直「从云端更新 0 条」时，
   * 只有把游标清零才能重新看见云端已有的行。只读云端、不删本机数据。
   */
  async function doResync() {
    const ok = await confirm({
      title: '从头重新拉取云端内容？',
      desc: '会清空本机的同步进度标记，然后把云端记录重新比对一遍。\n不会删除本机已有的记录：云端更旧的版本不会覆盖你本机的较新版本。',
    })
    if (!ok) return
    setBusy(true)
    setErr('')
    setResult(null)
    setPushedOnly(null)
    setProgress(null)
    try {
      await resetSyncCursor()
      const res = await runSync({ onProgress })
      setResult(res)
      setLastAt(res.lastSyncedAt)
      setPendingDeletes(await pendingDeletionCount())
      setConflicts(await db.conflicts.orderBy('detectedAt').reverse().toArray())
      await reload?.()
      toast(`已重新比对：更新本机 ${res.pulled} 条`)
    } catch (e) {
      setErr(e instanceof SyncError ? e.message : (e as Error).message)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  async function refreshConflicts() {
    setConflicts(await db.conflicts.orderBy('detectedAt').reverse().toArray())
  }

  /** 取回某一版：写回本机并标为已处理，下一次同步会把它推上去 */
  async function doRestore(c: ConflictCopy) {
    const ok = await confirm({
      title: '取回这一版？',
      desc: `会用「${conflictSummary(c)}」被覆盖前的内容替换本机现有版本。\n取回后请点一次「双向同步」，让其它设备也拿到这一版。`,
    })
    if (!ok) return
    const res = await restoreConflict(c)
    toast(res.message, res.ok ? 'ok' : 'err')
    if (res.ok) {
      await refreshConflicts()
      await reload?.()
    }
  }

  async function doDismiss(c: ConflictCopy) {
    await dismissConflict(c.id)
    await refreshConflicts()
    toast('已标记为处理过，内容仍保留在副本里')
  }

  async function doCleanup() {
    const n = await cleanupConflicts()
    await refreshConflicts()
    toast(n > 0 ? `已清理 ${n} 条已处理的副本` : '没有超过保留期的已处理副本')
  }

  async function doProbe() {
    setProbeBusy(true)
    try {
      setProbe(await probeTaskCloudWrite())
    } finally {
      setProbeBusy(false)
    }
  }

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-1.5">
          <Cloud size={15} className="text-rose-deep" /> 多端同步
        </span>
      }
    >
      <div className="space-y-2.5 text-[13px] text-ink-700">
        {signedIn === null ? (
          <p className="text-ink-500">正在检查登录状态…</p>
        ) : signedIn ? (
          <p>
            已登录{account ? `（${account}）` : ''}，手机与电脑登录同一账号后共用一份记录。
          </p>
        ) : (
          <p className="text-ink-500">
            还没有登录云端。先在下方「云服务」里完成邮箱登录，再回到这里点「双向同步」。
          </p>
        )}

        <p className="text-[12px] text-ink-500">
          上次同步：{lastAt ? `${fmtDate(parseAny(lastAt))} ${fmtTime(parseAny(lastAt))}` : '尚未同步过'}
          {pendingDeletes > 0 ? ` · 待推送删除 ${pendingDeletes} 条` : ''}
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px]"
            onClick={() => void doSync()}
            disabled={busy || signedIn !== true}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            双向同步
          </button>
          <button
            type="button"
            className="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px]"
            onClick={() => void doUpload()}
            disabled={busy || signedIn !== true}
          >
            <Cloud size={14} />
            上传本机到云端
          </button>
          <button
            type="button"
            className="btn-text inline-flex items-center gap-1.5 px-2 py-1.5 text-[12.5px]"
            onClick={() => void doResync()}
            disabled={busy || signedIn !== true}
            title="清空同步进度后重新比对云端，用于另一边改了却一直看不到"
          >
            <RotateCcw size={13} />
            从头重新拉取
          </button>
        </div>

        <p className="text-[11.5px] leading-relaxed text-ink-500">
          「双向同步」是合并：同一条两边都改过时保留较新的那次，不会用本机旧内容覆盖云端。
          只有确认云端才是旧版本时，才用下面的强制覆盖。
        </p>

        {conflictCount > 0 && (
          <div className="rounded-lg border border-[#E8D5C4] bg-[#FDF7F1] px-3 py-2 text-[12px]">
            <div className="flex items-center gap-1.5 text-[#8E4850]">
              <AlertTriangle size={13} />
              有 {conflictCount} 条冲突副本待查看
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-600">
              这些是「两边都改过、较旧的那次被覆盖」时自动留下的备份，可以取回或忽略。
            </p>
            <button
              type="button"
              className="btn-text mt-1.5 px-0 py-0 text-[11.5px]"
              onClick={() => setShowConflicts((v) => !v)}
            >
              {showConflicts ? '收起' : '查看冲突副本'}
            </button>
            {showConflicts && (
              <ul className="mt-2 space-y-1.5">
                {conflicts.slice(0, 20).map((c) => (
                  <li key={c.id} className="rounded-md bg-white/70 px-2 py-1.5 text-[11.5px] text-ink-700">
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 rounded bg-cream-200 px-1 text-[10.5px] text-ink-600">
                        {conflictEntityLabel(c.entity)}
                      </span>
                      <span className="min-w-0 flex-1 break-all">{conflictSummary(c)}</span>
                    </div>
                    <div className="mt-0.5 text-[10.5px] text-ink-400">
                      被覆盖版本：{c.discardedUpdatedAt.slice(0, 16).replace('T', ' ')}
                      {c.resolvedAt ? ' · 已取回' : c.dismissedAt ? ' · 已忽略' : ''}
                    </div>
                    {!c.dismissedAt && (
                      <div className="mt-1 flex gap-2">
                        <button
                          type="button"
                          className="btn-text px-0 py-0 text-[11px]"
                          onClick={() => void doRestore(c)}
                        >
                          取回这一版
                        </button>
                        <button
                          type="button"
                          className="btn-text px-0 py-0 text-[11px] text-ink-400"
                          onClick={() => void doDismiss(c)}
                        >
                          忽略
                        </button>
                      </div>
                    )}
                  </li>
                ))}
                {conflicts.length > 20 && (
                  <li className="text-[10.5px] text-ink-400">另有 {conflicts.length - 20} 条…</li>
                )}
              </ul>
            )}
            {tally.handled > 0 && (
              <button
                type="button"
                className="btn-text mt-1.5 px-0 py-0 text-[11px] text-ink-400"
                onClick={() => void doCleanup()}
              >
                清理已处理的 {tally.handled} 条（保留 90 天内）
              </button>
            )}
          </div>
        )}
        {/* 待办提醒能否跨设备：用真实会话写两行再读回，比「应该可以」可靠 */}
        <div className="rounded-lg border border-cream-200 bg-cream-50 px-3 py-2 text-[11.5px] leading-relaxed text-ink-600">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck size={13} className="text-rose-deep" />
              待办提醒能不能跟着账号走？
            </span>
            <button
              type="button"
              className="btn-text px-0 py-0 text-[11.5px]"
              onClick={() => void doProbe()}
              disabled={probeBusy || signedIn !== true}
            >
              {probeBusy ? '检查中…' : '运行一次自检'}
            </button>
          </div>
          {probe && (
            <p className={`mt-1 ${probe.ok ? 'text-[#4F6B45]' : 'text-[#8E4850]'}`}>
              {probe.message}
              {probe.lines.length > 0 && (
                <span className="ml-1 text-ink-400">
                  （
                  {probe.lines.map((l) => `${l.entity} ${l.readBack ? '可写回' : '未通过'}`).join(' / ')}
                  ）
                </span>
              )}
            </p>
          )}
          {!probe && <p className="mt-1 text-ink-400">会写两行探针再读回并标删，不会碰你的真实任务。</p>}
        </div>

        <div>
          <button
            type="button"
            className="text-[11.5px] text-[#8E4850] underline decoration-dotted underline-offset-2 hover:no-underline disabled:opacity-50"
            onClick={() => void doForceUpload()}
            disabled={busy || signedIn !== true}
          >
            强制用本机覆盖云端（会丢弃其他设备的更新）
          </button>
        </div>

        {busy && progress && (
          <div className="space-y-1">
            <p className="text-[12px] text-ink-600">
              {PHASE_TEXT[progress.phase]}
              {progress.total > 0 ? ` ${progress.done}/${progress.total}` : '…'}
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-cream-200">
              <div
                className="h-full rounded-full bg-rose-deep transition-all"
                style={{ width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 8}%` }}
              />
            </div>
          </div>
        )}

        {pushedOnly && (
          <div className="rounded-lg border border-cream-200 bg-cream-50 px-3 py-2 text-[12.5px]">
            <div className="flex items-center gap-1 text-[#4F6B45]">
              <Check size={13} /> 已上传 {pushedOnly.pushed} 条记录
              {pushedOnly.photosUploaded > 0 ? `、${pushedOnly.photosUploaded} 张照片` : ''}
              {pushedOnly.tombstoned > 0 ? `、${pushedOnly.tombstoned} 条删除` : ''}
            </div>
            <p className="mt-1 text-[11.5px] text-ink-500">其他设备登录后点「双向同步」即可拿到。</p>
            {pushedOnly.photoErrors.length > 0 && (
              <p className="mt-1 text-[11.5px] text-[#8E4850]">
                {pushedOnly.photoErrors.length} 张照片上传失败：{pushedOnly.photoErrors[0]}
              </p>
            )}
          </div>
        )}

        {result && (
          <div className="space-y-1 rounded-lg border border-cream-200 bg-cream-50 px-3 py-2 text-[12.5px]">
            <div className="flex items-center gap-1 text-[#4F6B45]">
              <Check size={13} /> 上传 {result.pushed} 条，从云端更新 {result.pulled} 条
              {result.keptLocal > 0 ? `，保留本机较新版本 ${result.keptLocal} 条` : ''}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-ink-500">
              <span className="inline-flex items-center gap-1">
                <ImageIcon size={11} /> 照片 上{result.photosUploaded} / 下{result.photosDownloaded}
              </span>
              <span className="inline-flex items-center gap-1">
                <Trash2 size={11} /> 删除 上行{result.tombstoned} / 下行{result.deleted}
              </span>
            </div>
            {result.photoErrors.length > 0 && (
              <p className="text-[11.5px] text-[#8E4850]">
                {result.photoErrors.length} 张照片传输失败，其余内容已同步：{result.photoErrors[0]}
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
          <p>同步范围与规则：</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>已同步：记录、偏好、健康、心愿、礼物、画像、总结、每日状态、人物档案</li>
            <li>已同步：<strong className="font-medium text-ink-700">照片</strong>（原图与缩略图走文件存储，按张传输）</li>
            <li>已同步：<strong className="font-medium text-ink-700">删除</strong>（本机删除会同步到其他设备）</li>
            <li>同一条两边都改过时保留修改时间较晚的一条；较旧的那次修改会被覆盖，但会单独计数</li>
            <li>一次拉取最多 1000 条变更，数据多时再点一次即可继续</li>
          </ul>
        </div>
      </div>
    </SectionCard>
  )
}
