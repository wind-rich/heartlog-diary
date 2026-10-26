import { useEffect, useState } from 'react'
import { Download, FolderOpen, Link2, PencilLine, Loader2, AlertTriangle, Cloud } from 'lucide-react'
import { importBackupZip } from '../lib/backup'
import { copyFromFiles, copyFromUrl, describeImport, type CopyProgress } from '../lib/publishedCopy'
import { sendEmailCode, submitEmailOtp, type PendingEmailOtp } from '../lib/cloudAuth'
import { getCloudSession } from '../lib/cloud'
import { pullFromCloud, type SyncProgress } from '../lib/sync'
import { useApp } from '../state/app'
import { useToast } from './ui'

/**
 * 作者端启动闸门：这台设备没有任何记录时显示。
 *
 * 设计原则（对应 T2）：
 * - 不自动创建空白人物，也不自动把空白副本当成最新版本；
 * - 明确给出三条路：导入完整备份、从已发布内容建立副本、从空白开始；
 * - 空白开始需要二次确认，并说明不会覆盖云端或已发布内容。
 */
export function StartGate() {
  const { startBlank, markReady } = useApp()
  const toast = useToast()
  const [busy, setBusy] = useState<null | 'zip' | 'files' | 'url' | 'blank' | 'cloud'>(null)
  const [showCloud, setShowCloud] = useState(false)
  const [cloudEmail, setCloudEmail] = useState('')
  const [cloudCode, setCloudCode] = useState('')
  const [pendingOtp, setPendingOtp] = useState<PendingEmailOtp | null>(null)
  const [sessionEmail, setSessionEmail] = useState('')
  const [siteSnapshot, setSiteSnapshot] = useState('')
  const [notice, setNotice] = useState('')
  const [progress, setProgress] = useState<CopyProgress | null>(null)
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null)
  const [error, setError] = useState('')
  const [url, setUrl] = useState('')
  const [showUrl, setShowUrl] = useState(false)

  const onProgress = (p: CopyProgress) => setProgress(p)

  // 发布站点自带 snapshot 目录，同源可直接读取；本地开发没有，则自动隐藏一键入口
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const url = new URL('./snapshot/public-snapshot.json', window.location.href).toString()
        const res = await fetch(url, { method: 'HEAD' })
        if (alive && res.ok) setSiteSnapshot(url)
      } catch {
        // 本地开发环境没有该文件，忽略
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const session = await getCloudSession()
      if (!alive || !session) return
      setSessionEmail(session.user?.email || session.user?.name || '当前账号')
    })()
    return () => {
      alive = false
    }
  }, [])

  async function handleZip(file: File) {
    setBusy('zip')
    setError('')
    try {
      const res = await importBackupZip(file, 'merge')
      if (res.errors.length) {
        setError(res.errors.join('；'))
        return
      }
      toast(describeImport(res))
      await markReady()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length) return
    setBusy('files')
    setError('')
    try {
      const res = await copyFromFiles(Array.from(files), onProgress)
      toast(`${describeImport(res.imported)}（${res.publishId}）`)
      await markReady()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  async function handleUrl() {
    if (!url.trim()) {
      setError('请填写快照地址')
      return
    }
    setBusy('url')
    setError('')
    try {
      const res = await copyFromUrl(url.trim(), onProgress)
      toast(`${describeImport(res.imported)}（${res.publishId}）`)
      await markReady()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  async function handleSendCode() {
    setBusy('cloud')
    setError('')
    try {
      const pending = await sendEmailCode(cloudEmail)
      setPendingOtp(pending)
      setNotice(pending.isExistingUser ? '验证码已发送，请查收邮箱后填写验证码。' : '验证码已发送（该邮箱将直接注册登录，无需密码）。')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function handleCloudLogin() {
    if (!pendingOtp) {
      setError('请先点击「获取验证码」')
      return
    }
    setBusy('cloud')
    setError('')
    setNotice('')
    try {
      // 邮箱验证码注册/登录不需要密码
      await submitEmailOtp(pendingOtp, cloudCode)
      const session = await getCloudSession()
      if (!session) throw new Error('登录未完成，请重试')
      setSessionEmail(session.user?.email || session.user?.name || '当前账号')
      setPendingOtp(null)
      await doPull()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function doPull() {
    setBusy('cloud')
    setError('')
    setNotice('')
    try {
      const res = await pullFromCloud({ onProgress: setSyncProgress })
      if (res.pulled > 0) {
        const photos = res.photosDownloaded > 0 ? `、${res.photosDownloaded} 张照片` : ''
        toast(`已从云端取回 ${res.pulled} 条记录${photos}`)
        if (res.photoErrors.length > 0) {
          setNotice(
            `记录已取回，但有 ${res.photoErrors.length} 张照片没下载成功（${res.photoErrors[0]}）。进入应用后在「设置 → 多端同步」再点一次即可重试。`,
          )
        }
        await markReady()
      } else {
        // 云端为空不是错误，但必须说清楚下一步，否则用户以为登录失败了
        setNotice(
          '云端目前还没有记录。请先在一台已经有内容的设备上打开这个页面：导入内容 → 设置 → 多端同步 → 「上传本机到云端」；上传完成后再回来点「拉取云端记录」。',
        )
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function handleSeedFromSite() {
    if (!siteSnapshot) return
    setBusy('url')
    setError('')
    setNotice('')
    try {
      const res = await copyFromUrl(siteSnapshot, onProgress)
      toast(`${describeImport(res.imported)}（${res.publishId}）`)
      await markReady()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  async function handleBlank() {
    setBusy('blank')
    setError('')
    try {
      await startBlank()
    } finally {
      setBusy(null)
    }
  }

  const syncProgressText =
    syncProgress && syncProgress.total > 0
      ? `${
          syncProgress.phase === 'photos-down'
            ? '正在下载照片'
            : syncProgress.phase === 'pull'
              ? '正在读取云端记录'
              : '正在同步'
        } ${syncProgress.done}/${syncProgress.total}…`
      : null

  const progressText =
    progress && busy !== 'zip'
      ? progress.phase === 'read'
        ? '正在读取快照…'
        : progress.phase === 'media'
          ? `正在取回照片 ${progress.done}/${progress.total}…`
          : '正在写入本机数据库…'
      : ''

  return (
    <div className="min-h-full bg-cream-50">
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <div className="flex items-center gap-2 text-rose-deep">
          <span className="text-xl leading-none">♥</span>
          <span className="text-[13px] tracking-wide text-ink-500">心意簿 · 作者端</span>
        </div>

        <h1 className="mt-4 text-[24px] font-semibold leading-snug text-ink-900">这台设备上还没有记录</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-500">
          先选一个来源。这里的任何选择都只影响本机数据库，不会覆盖旧站、云端备份或已经发布的内容。
        </p>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-soft/50 bg-[#FFF3F1] px-3 py-2 text-[12.5px] text-[#8E4850]">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {notice && (
          <div className="mt-3 rounded-xl border border-amber-200/70 bg-[#FFF7E8] px-3 py-2 text-[12.5px] leading-relaxed text-[#8A5A2B]">
            {notice}
          </div>
        )}

        <div className="mt-6 space-y-3">
          {/* 0. 从云端同步（手机与电脑共用的主路径） */}
          <section className="card card-pad ring-1 ring-rose-soft/40">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-rose-soft/15 p-2 text-rose-deep">
                <Cloud size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-medium text-ink-900">从云端同步（手机与电脑共用）</div>

                {sessionEmail ? (
                  <>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
                      已登录：<span className="text-ink-700">{sessionEmail}</span>。这台设备还没有内容，可以从云端拉取。
                    </p>
                    <button
                      type="button"
                      className="btn-primary mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px]"
                      onClick={() => void doPull()}
                      disabled={busy !== null}
                    >
                      {busy === 'cloud' ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />}
                      拉取云端记录
                    </button>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
                      登录同一个账号，拉取云端那份记录。换手机、换电脑都用这一条。
                    </p>
                    <button
                      type="button"
                      className="btn-primary mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px]"
                      onClick={() => setShowCloud((v) => !v)}
                      disabled={busy !== null}
                    >
                      {busy === 'cloud' ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />}
                      {showCloud ? '收起登录' : '登录并拉取'}
                    </button>

                    {showCloud && (
                      <div className="mt-3 space-y-2">
                        <input
                          className="input"
                          placeholder="邮箱地址"
                          value={cloudEmail}
                          onChange={(e) => setCloudEmail(e.target.value)}
                          disabled={busy !== null}
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="btn-ghost px-3 py-1.5 text-[12.5px]"
                            onClick={() => void handleSendCode()}
                            disabled={busy !== null || !cloudEmail.trim()}
                          >
                            获取验证码
                          </button>
                          <input
                            className="input flex-1"
                            placeholder="邮箱验证码"
                            value={cloudCode}
                            onChange={(e) => setCloudCode(e.target.value)}
                            disabled={busy !== null}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-primary px-3 py-1.5 text-[12.5px]"
                          onClick={() => void handleCloudLogin()}
                          disabled={busy !== null || !pendingOtp || !cloudCode.trim()}
                        >
                          登录并拉取
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>

          {/* 1. 完整备份 */}
          <section className="card card-pad">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-cream-100 p-2 text-ink-700">
                <Download size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-medium text-ink-900">导入完整备份（ZIP）</div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
                  恢复最完整：记录、照片、人物档案与偏好都会按备份还原。适合从手机或另一台电脑迁移过来。
                </p>
                <label className="btn-primary mt-3 inline-flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-[13px]">
                  {busy === 'zip' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  选择备份文件
                  <input
                    type="file"
                    accept=".zip,application/zip"
                    className="hidden"
                    disabled={busy !== null}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.currentTarget.value = ''
                      if (f) void handleZip(f)
                    }}
                  />
                </label>
              </div>
            </div>
          </section>

          {/* 2. 从已发布内容建立副本 */}
          <section className="card card-pad">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-cream-100 p-2 text-ink-700">
                <FolderOpen size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-medium text-ink-900">从已发布内容建立副本</div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
                  只取公开快照里的业务内容（记录、照片、偏好、心愿、健康），不含作者 AI 配置与发布凭据。
                  推荐直接选择发布目录里的 <code className="rounded bg-cream-100 px-1">snapshot</code> 文件夹，完全离线。
                </p>
                {siteSnapshot && (
                  <button
                    type="button"
                    className="btn-primary mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px]"
                    onClick={() => void handleSeedFromSite()}
                    disabled={busy !== null}
                  >
                    {busy === 'url' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    使用本站已发布内容（一键）
                  </button>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="btn-ghost inline-flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-[13px]">
                    {busy === 'files' ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                    选择发布目录
                    <input
                      type="file"
                      className="hidden"
                      disabled={busy !== null}
                      onChange={(e) => {
                        const list = e.target.files
                        e.currentTarget.value = ''
                        void handleFiles(list)
                      }}
                      // 目录选择：Chromium 支持 webkitdirectory
                      {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn-text px-2 py-1 text-[12.5px]"
                    onClick={() => setShowUrl((v) => !v)}
                    disabled={busy !== null}
                  >
                    <Link2 size={13} className="mr-1 inline" />
                    改用地址
                  </button>
                </div>

                {showUrl && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input
                      className="input flex-1 min-w-[200px]"
                      placeholder="https://…/snapshot/public-snapshot.json"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      disabled={busy !== null}
                    />
                    <button
                      type="button"
                      className="btn-ghost px-3 py-1.5 text-[13px]"
                      onClick={() => void handleUrl()}
                      disabled={busy !== null}
                    >
                      {busy === 'url' ? <Loader2 size={14} className="animate-spin" /> : '读取'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* 3. 空白开始 */}
          <section className="card card-pad">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-cream-100 p-2 text-ink-700">
                <PencilLine size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-medium text-ink-900">从空白开始</div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
                  只在本机新建一个空白档案，适合先试试功能。空白内容不会被当成新版本发布出去。
                </p>
                <button
                  type="button"
                  className="btn-ghost mt-3 px-3 py-1.5 text-[13px]"
                  onClick={() => void handleBlank()}
                  disabled={busy !== null}
                >
                  {busy === 'blank' ? <Loader2 size={14} className="animate-spin" /> : '新建空白档案'}
                </button>
              </div>
            </div>
          </section>
        </div>

        {syncProgressText && busy === 'cloud' && (
          <p className="mt-4 text-center text-[12px] text-ink-500">{syncProgressText}</p>
        )}
        {progressText && <p className="mt-4 text-center text-[12px] text-ink-500">{progressText}</p>}

        <p className="mt-6 text-center text-[11.5px] leading-relaxed text-ink-300">
          导入不会删除本机已有内容；只有「从空白开始」会新建档案，且不会上传任何数据。
        </p>
      </div>
    </div>
  )
}
