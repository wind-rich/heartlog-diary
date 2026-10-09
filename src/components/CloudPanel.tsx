import { useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  Loader2,
  LogOut,
  Mail,
  RefreshCw,
  RotateCcw,
  Trash2,
  Undo2,
} from 'lucide-react'
import { Field, SectionCard, Segmented, Tag, useConfirm, useToast } from './ui'
import { useApp } from '../state/app'
import { fmtDate, fmtTime, parseAny } from '../lib/date'
import { fmtSize } from '../lib/photo'
import {
  AuthError,
  sendEmailCode,
  signInWithEmailPassword,
  signOutCloud,
  startPasswordReset,
  submitEmailOtp,
  type PasswordResetHandle,
  type PendingEmailOtp,
} from '../lib/cloudAuth'
import {
  createCloudBackup,
  deleteCloudBackup,
  listCloudBackups,
  restoreCloudBackup,
  type CloudBackupProgress,
  type CloudBackupRow,
} from '../lib/cloudBackup'
import type { ImportMode } from '../lib/backup'

type AuthMode = 'code' | 'password'

const STAGE_TEXT: Record<CloudBackupProgress['stage'], string> = {
  collect: '正在读取本地记录',
  photos: '正在上传照片',
  upload: '正在上传备份数据',
  record: '正在登记备份',
  download: '正在下载云端数据',
  restore: '正在写入本地',
  done: '完成',
}

export function CloudPanel() {
  const { cloudUser, cloudChecked, refreshCloudUser } = useApp()
  const toast = useToast()
  const confirm = useConfirm()

  const [authMode, setAuthMode] = useState<AuthMode>('code')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState<PendingEmailOtp | null>(null)
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [authMsg, setAuthMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [backups, setBackups] = useState<CloudBackupRow[] | null>(null)
  const [listErr, setListErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<CloudBackupProgress | null>(null)
  const [note, setNote] = useState('')
  const [resetHandle, setResetHandle] = useState<PasswordResetHandle | null>(null)

  const signedIn = Boolean(cloudUser)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const loadBackups = async () => {
    if (!signedIn) return
    setListErr('')
    try {
      setBackups(await listCloudBackups())
    } catch (e) {
      setBackups([])
      setListErr((e as Error).message)
    }
  }

  useEffect(() => {
    if (signedIn) void loadBackups()
    else setBackups(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn])

  /* ---------------- 认证 ---------------- */

  const onSendCode = async () => {
    setAuthMsg(null)
    setSending(true)
    try {
      const p = await sendEmailCode(email)
      setPending(p)
      setCooldown(60)
      setAuthMsg({
        ok: true,
        text: p.isExistingUser ? '验证码已发送，请查收邮箱。' : '验证码已发送。这是新邮箱，请同时设置一个登录密码。',
      })
    } catch (e) {
      setAuthMsg({ ok: false, text: e instanceof AuthError ? e.message : (e as Error).message })
    } finally {
      setSending(false)
    }
  }

  const onSubmitCode = async () => {
    setAuthMsg(null)
    setSubmitting(true)
    try {
      if (!pending) throw new AuthError('请先点击「获取验证码」')
      await submitEmailOtp(pending, code, password)
      setPending(null)
      setCode('')
      setPassword('')
      await refreshCloudUser()
      toast('登录成功')
    } catch (e) {
      setAuthMsg({ ok: false, text: e instanceof AuthError ? e.message : (e as Error).message })
    } finally {
      setSubmitting(false)
    }
  }

  const onPasswordLogin = async () => {
    setAuthMsg(null)
    setSubmitting(true)
    try {
      await signInWithEmailPassword(email, password)
      setPassword('')
      await refreshCloudUser()
      toast('登录成功')
    } catch (e) {
      setAuthMsg({ ok: false, text: e instanceof AuthError ? e.message : (e as Error).message })
    } finally {
      setSubmitting(false)
    }
  }

  const onResetPassword = async () => {
    setAuthMsg(null)
    setSubmitting(true)
    try {
      const handle = await startPasswordReset(email)
      setAuthMsg({ ok: true, text: '重置验证码已发送到邮箱，请把邮件里的验证码填到下面的「验证码」框，并输入新密码，再点「重置密码」。' })
      // 复用下面的表单提交
      setPending({ email, verificationId: '__reset__', isExistingUser: true })
      setResetHandle(() => handle)
      setAuthMode('code')
    } catch (e) {
      setAuthMsg({ ok: false, text: e instanceof AuthError ? e.message : (e as Error).message })
    } finally {
      setSubmitting(false)
    }
  }

  const onSubmitReset = async () => {
    if (!resetHandle) return
    setAuthMsg(null)
    setSubmitting(true)
    try {
      if (password.length < 6) throw new AuthError('新密码至少 6 位')
      const res = await resetHandle.updateUser({ nonce: code.trim(), password })
      if (res.error) throw new AuthError('验证码不正确或已过期')
      setResetHandle(null)
      setPending(null)
      setCode('')
      setPassword('')
      await refreshCloudUser()
      toast('密码已重置并登录')
    } catch (e) {
      setAuthMsg({ ok: false, text: e instanceof AuthError ? e.message : (e as Error).message })
    } finally {
      setSubmitting(false)
    }
  }

  const onSignOut = async () => {
    try {
      await signOutCloud()
      await refreshCloudUser()
      toast('已退出登录，本地记录仍然保留')
    } catch (e) {
      toast(`退出登录失败：${(e as Error).message}`, 'err')
    }
  }

  /* ---------------- 云端备份 ---------------- */

  const onBackup = async () => {
    setNote('')
    setBusy(true)
    setProgress({ stage: 'collect', done: 0, total: 1 })
    try {
      const res = await createCloudBackup({ label: note.trim() || undefined, onProgress: setProgress })
      toast(
        `云端备份完成：上传 ${res.uploadedPhotos} 张照片${res.reusedPhotos > 0 ? `，复用已有 ${res.reusedPhotos} 张` : ''}`,
      )
      await loadBackups()
    } catch (e) {
      toast(`云端备份失败：${(e as Error).message}`, 'err')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const onRestore = async (row: CloudBackupRow, mode: ImportMode) => {
    const ok = await confirm({
      title: mode === 'replace' ? '覆盖恢复？' : '合并恢复？',
      desc:
        mode === 'replace'
          ? '这会先清空本机全部记录，再用云端备份覆盖。本机未备份的改动会丢失。'
          : '云端备份中本机没有的记录会被补进来；同一条记录不会覆盖你本地的修改。',
      danger: mode === 'replace',
      confirmText: mode === 'replace' ? '我确定覆盖' : '开始恢复',
    })
    if (!ok) return
    setBusy(true)
    setProgress({ stage: 'download', done: 0, total: 1 })
    try {
      const res = await restoreCloudBackup(row, mode, setProgress)
      const imported = Object.values(res.imported).reduce((a, b) => a + b, 0)
      const skipped = Object.values(res.skipped).reduce((a, b) => a + b, 0)
      toast(`恢复完成：新增 ${imported} 条，跳过 ${skipped} 条`)
      if (res.warnings.length) toast(res.warnings[0], 'err')
    } catch (e) {
      toast(`恢复失败：${(e as Error).message}`, 'err')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const onDelete = async (row: CloudBackupRow) => {
    const ok = await confirm({
      title: '删除云端备份？',
      desc: `将删除「${row.label || row.backup_key}」这份云端备份，删除后无法找回。本机记录不受影响。`,
      danger: true,
      confirmText: '删除',
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await deleteCloudBackup(row)
      toast(res.removedPhotos > 0 ? `已删除，同时清理了 ${res.removedPhotos} 张不再被引用的照片` : '已删除该云端备份')
      await loadBackups()
    } catch (e) {
      toast(`删除失败：${(e as Error).message}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  /* ---------------- 渲染 ---------------- */

  return (
    <SectionCard
      title={
        <>
          <CloudUpload size={15} className="text-rose-deep" /> 云服务
        </>
      }
      action={
        cloudChecked ? (
          <Tag color={signedIn ? '#8CBF9B' : '#B9ADA2'}>{signedIn ? '已登录' : '未登录'}</Tag>
        ) : (
          <Tag color="#B9ADA2">检查中</Tag>
        )
      }
    >
      {!signedIn && (
        <p className="text-[12px] text-ink-300 leading-relaxed mb-3">
          登录后可以把记录备份到云端，换手机时一键恢复。不登录也能照常使用，所有记录仍然只存在本机。
        </p>
      )}

      {signedIn ? (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-cream-100 px-3 py-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[13px] text-ink-700">
              <Mail size={13} className="text-ink-300 shrink-0" />
              <span className="truncate">{cloudUser?.email ?? '已登录'}</span>
            </div>
            <p className="text-[11px] text-ink-300 mt-0.5">云端数据只归这个账号所有，其他账号看不到。</p>
          </div>
          <button className="btn-text shrink-0" onClick={onSignOut}>
            <LogOut size={14} /> 退出
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <Segmented
            options={[
              { value: 'code', label: '邮箱验证码' },
              { value: 'password', label: '邮箱密码' },
            ]}
            value={authMode}
            onChange={(v) => {
              setAuthMode(v as AuthMode)
              setAuthMsg(null)
              setResetHandle(null)
              setPending(null)
            }}
          />

          <Field label="邮箱">
            <input
              className="input"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </Field>

          {authMode === 'code' && (
            <>
              <Field label="验证码">
                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    inputMode="numeric"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="6 位数字"
                  />
                  <button
                    type="button"
                    className="btn-ghost shrink-0"
                    onClick={onSendCode}
                    disabled={sending || cooldown > 0 || Boolean(resetHandle)}
                  >
                    {sending ? <Loader2 size={15} className="animate-spin" /> : null}
                    {cooldown > 0 ? `${cooldown}s` : '获取验证码'}
                  </button>
                </div>
              </Field>

              <Field
                label={resetHandle ? '新密码' : pending && !pending.isExistingUser ? '设置密码' : '密码（新邮箱注册时需要）'}
                hint={resetHandle ? '用于重置后的登录，至少 6 位。' : '老邮箱用验证码登录可以留空。'}
              >
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少 6 位"
                />
              </Field>

              <button
                className="btn-primary w-full"
                onClick={resetHandle ? onSubmitReset : onSubmitCode}
                disabled={submitting}
              >
                {submitting ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                {resetHandle ? '重置密码' : '登录 / 注册'}
              </button>
            </>
          )}

          {authMode === 'password' && (
            <>
              <Field label="密码">
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void onPasswordLogin()
                  }}
                  placeholder="登录密码"
                />
              </Field>
              <button className="btn-primary w-full" onClick={onPasswordLogin} disabled={submitting}>
                {submitting ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                登录
              </button>
              <button className="btn-text w-full" onClick={onResetPassword} disabled={submitting || !email}>
                忘记密码？
              </button>
            </>
          )}

          {authMsg && (
            <div
              className={`rounded-xl p-3 text-[12px] leading-relaxed flex gap-2 ${
                authMsg.ok ? 'bg-[#E9F5EC] border border-[#C4E0CC] text-[#3F6B4C]' : 'bg-[#FDECEA] border border-[#F5C9C3] text-[#9B3B2E]'
              }`}
            >
              {authMsg.ok ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <AlertCircle size={14} className="shrink-0 mt-0.5" />}
              <span className="whitespace-pre-line">{authMsg.text}</span>
            </div>
          )}
        </div>
      )}

      {signedIn && (
        <div className="mt-4 space-y-3 border-t border-cream-200 pt-3">
          <Field label="备份备注" hint="可选，用来区分不同设备或时间点的备份。">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：换手机前的备份" />
          </Field>

          <button className="btn-primary w-full" onClick={onBackup} disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <CloudUpload size={15} />}
            备份到云端
          </button>

          {progress && (
            <div className="flex items-center gap-2 text-[12px] text-ink-500">
              <Loader2 size={13} className="animate-spin shrink-0" />
              <span>
                {STAGE_TEXT[progress.stage]}
                {progress.total > 1 ? ` ${progress.done}/${progress.total}` : ''}
                …
              </span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-[12px] text-ink-500">云端备份记录</span>
            <button className="btn-text" onClick={loadBackups} disabled={busy}>
              <RefreshCw size={13} /> 刷新
            </button>
          </div>

          {listErr && <p className="text-[12px] text-[#9B3B2E]">{listErr}</p>}

          {backups === null ? (
            <p className="text-[12px] text-ink-300">读取中…</p>
          ) : backups.length === 0 ? (
            <p className="text-[12px] text-ink-300">还没有云端备份。点上面的按钮创建第一份。</p>
          ) : (
            <ul className="space-y-2">
              {backups.map((row) => (
                <li key={row.id} className="rounded-xl border border-cream-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13px] text-ink-700 truncate">{row.label || '未命名备份'}</p>
                      <p className="text-[11px] text-ink-300 mt-0.5">
                        {formatWhen(row.created_at)} · {row.record_count} 条记录 · {row.photo_count} 张照片 · {fmtSize(row.size_bytes)}
                      </p>
                      {row.device && <p className="text-[11px] text-ink-300">来自：{row.device}</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button className="btn-ghost" onClick={() => onRestore(row, 'merge')} disabled={busy}>
                      <Undo2 size={13} /> 合并恢复
                    </button>
                    <button className="btn-ghost" onClick={() => onRestore(row, 'replace')} disabled={busy}>
                      <RotateCcw size={13} /> 覆盖恢复
                    </button>
                    <button className="btn-text text-[#9B3B2E]" onClick={() => onDelete(row)} disabled={busy}>
                      <Trash2 size={13} /> 删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="text-[11px] text-ink-300 leading-relaxed">
            「合并恢复」只补充本机没有的记录，不会覆盖你改过的内容；「覆盖恢复」会先清空本机再完整还原。
            照片在云端按 id 去重存放，多份备份共用同一批文件。
          </p>
        </div>
      )}
    </SectionCard>
  )
}

function formatWhen(iso: string): string {
  try {
    const d = parseAny(iso)
    if (!d || Number.isNaN(d.getTime())) return iso
    return `${fmtDate(d)} ${fmtTime(d)}`
  } catch {
    return iso
  }
}
