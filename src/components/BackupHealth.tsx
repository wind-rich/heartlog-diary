/**
 * 备份体检（R-026 / P0 数据可恢复性）。
 *
 * 为什么需要这块：云端 `heartlog_backups` 是**手工按钮**触发的，代码里没有任何
 * 定时任务；而本机 IndexedDB 一旦损坏就等于全部丢失。所以「上次把完整数据
 * 导出到本机之外是什么时候」是唯一能判断可恢复性的信号，必须显式呈现，
 * 而不是让用户以为「云端会自动备份」。
 *
 * 这里只做三件事：
 * 1. 说清数据规模（记录 / 照片 / 待办），让「丢了会丢多少」可见；
 * 2. 显示上次本机导出的时间与距今天数，超过阈值就标黄/标红；
 * 3. 给一个就地导出的按钮，并把「复制到第二个位置」写成必须动作。
 *
 * 不做自动导出：浏览器不允许无交互地反复下载文件，硬做只会变成
 * 「看起来备份了、其实被浏览器拦掉」——比不备份更危险。
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Cloud, Download, Loader2 } from 'lucide-react'
import { db } from '../db/db'
import { exportBackup, LAST_EXPORT_KEY } from '../lib/backup'
import { listCloudBackups } from '../lib/cloudBackup'
import { getMetaValue } from '../db/db'
import { fmtDate, fmtTime, parseAny } from '../lib/date'
import { useToast } from './ui'

/** 超过这个天数就提醒一次：一周是「还愿意补做」和「已经忘了」的分界 */
const WARN_DAYS = 7
/** 超过这个天数按风险处理：一个月不导出，等于把唯一副本押在一块硬盘上 */
const RISK_DAYS = 30

interface Scale {
  entries: number
  photos: number
  preferences: number
  tasks: number
}

interface CloudInfo {
  count: number
  latestAt: string
}

function daysBetween(from: string, now: number): number {
  const t = parseAny(from).getTime()
  if (!Number.isFinite(t)) return Number.NaN
  return Math.floor((now - t) / 86_400_000)
}

export function BackupHealth() {
  const toast = useToast()
  const [scale, setScale] = useState<Scale | null>(null)
  const [lastExportAt, setLastExportAt] = useState('')
  const [cloudInfo, setCloudInfo] = useState<CloudInfo | null>(null)
  const [cloudErr, setCloudErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const reload = async () => {
    const [entries, photos, preferences, tasks] = await Promise.all([
      db.entries.count(),
      db.photos.count(),
      db.preferences.count(),
      db.tasks.count(),
    ])
    setScale({ entries, photos, preferences, tasks })
    setLastExportAt(await getMetaValue<string>(LAST_EXPORT_KEY, ''))
    setNow(Date.now())
    try {
      const rows = await listCloudBackups()
      setCloudInfo(
        rows.length
          ? { count: rows.length, latestAt: String((rows[0] as { created_at?: string }).created_at ?? '') }
          : { count: 0, latestAt: '' },
      )
      setCloudErr('')
    } catch (e) {
      // 未登录 / 离线都走到这里：不影响本机导出的判断
      setCloudInfo(null)
      setCloudErr((e as Error).message)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const days = lastExportAt ? daysBetween(lastExportAt, now) : Number.NaN
  const level: 'none' | 'ok' | 'warn' | 'risk' =
    !lastExportAt || Number.isNaN(days) ? 'none' : days <= WARN_DAYS ? 'ok' : days <= RISK_DAYS ? 'warn' : 'risk'

  const tone =
    level === 'ok'
      ? { box: 'border-[#CFE0C6] bg-[#F2F7EF] text-[#4F6B45]', icon: <CheckCircle2 size={14} /> }
      : level === 'none'
        ? { box: 'border-cream-200 bg-cream-50 text-ink-600', icon: <AlertTriangle size={14} /> }
        : level === 'warn'
          ? { box: 'border-[#F0DFB8] bg-[#FDF7E9] text-[#8A6A28]', icon: <AlertTriangle size={14} /> }
          : { box: 'border-rose-soft/60 bg-[#FFF3F1] text-[#8E4850]', icon: <AlertTriangle size={14} /> }

  const verdict =
    level === 'ok'
      ? `上次导出是 ${days} 天前，状态正常`
      : level === 'warn'
        ? `已经 ${days} 天没导出完整备份了，建议今天补一次`
        : level === 'risk'
          ? `已经 ${days} 天没导出，本机一旦出问题这批内容无法恢复`
          : '还没有导出过完整备份：当前数据只存在这台设备上'

  const doExport = async () => {
    setBusy(true)
    try {
      await exportBackup()
      toast('完整备份已开始下载，记得复制到 U 盘或另一台电脑')
      await reload()
    } catch (e) {
      toast(`备份失败：${(e as Error).message}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[12.5px] ${tone.box}`}>
        <span className="mt-0.5 shrink-0">{tone.icon}</span>
        <div className="space-y-0.5">
          <p className="font-medium">{verdict}</p>
          <p className="text-[11.5px] opacity-80">
            {lastExportAt
              ? `上次导出：${fmtDate(parseAny(lastExportAt))} ${fmtTime(parseAny(lastExportAt))}`
              : '上次导出：无记录'}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-cream-200 bg-cream-50 px-3 py-2 text-[12px] leading-relaxed text-ink-500">
        <p>
          本机数据：
          <b className="text-ink-700">{scale ? scale.entries : '…'}</b> 条记录 ·{' '}
          <b className="text-ink-700">{scale ? scale.photos : '…'}</b> 张照片 ·{' '}
          <b className="text-ink-700">{scale ? scale.preferences : '…'}</b> 条偏好 ·{' '}
          <b className="text-ink-700">{scale ? scale.tasks : '…'}</b> 件待办
        </p>
        <p className="mt-1 inline-flex items-start gap-1">
          <Cloud size={12} className="mt-0.5 shrink-0" />
          <span>
            {cloudInfo === null
              ? `云端备份：${cloudErr ? '未登录或读取失败（不影响本机导出）' : '读取中…'}`
              : cloudInfo.count === 0
                ? '云端备份：0 份。它是手工按钮，不会自动生成'
                : `云端备份：${cloudInfo.count} 份，最新 ${
                    cloudInfo.latestAt ? `${fmtDate(parseAny(cloudInfo.latestAt))} ${fmtTime(parseAny(cloudInfo.latestAt))}` : '时间未知'
                  }（手工按钮触发，不会自动跑）`}
          </span>
        </p>
      </div>

      <button
        type="button"
        className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px]"
        onClick={() => void doExport()}
        disabled={busy}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        立即导出完整备份
      </button>

      <p className="text-[11.5px] leading-relaxed text-ink-300">
        导出的 zip 就是全部内容（文字 + 照片原图）。下载完请<strong className="text-ink-500">再复制一份</strong>到
        U 盘或另一台电脑——只放在同一块硬盘上，等于没有第二份。
      </p>
    </div>
  )
}
