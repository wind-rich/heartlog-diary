import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSearchParams } from 'react-router-dom'
import { Camera, Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { db, nowISO, savePerson, uid } from '../db/db'
import type { Anniversary, CalendarType, Person } from '../db/types'
import { CALENDAR_TYPES, PORTRAIT_DIMENSIONS } from '../lib/constants'
import { daysSince, fmtDate, lunarInfoOf, lunarToSolar, nextOccurrence, toDateStr, zodiacOf } from '../lib/date'
import { addPhotoFile } from '../lib/photo'
import { Avatar, Chips, Empty, Field, Modal, SectionCard, Segmented, Switch, Tag, useConfirm, useToast } from '../components/ui'
import PreferencePanel from '../components/profile/PreferencePanel'
import PortraitPanel from '../components/profile/PortraitPanel'
import { GiftPanel, WishPanel } from '../components/profile/WishGiftPanel'
import HealthPanel from '../components/profile/HealthPanel'
import { useApp } from '../state/app'

const TABS = [
  { key: 'info', label: '基础资料' },
  { key: 'pref', label: '兴趣偏好' },
  { key: 'portrait', label: '个人画像' },
  { key: 'wish', label: '愿望' },
  { key: 'gift', label: '礼物' },
  { key: 'health', label: '健康' },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function ProfilePage() {
  const { person, updatePerson } = useApp()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as TabKey) || 'info'

  if (!person) return null

  return (
    <div className="space-y-3">
      {/* 头部名片 */}
      <PersonCard person={person} />

      {/* Tab 栏 */}
      <div className="sticky top-14 z-30 -mx-4 px-4 py-2 bg-cream-50/95 backdrop-blur-sm">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setParams({ tab: t.key })}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13.5px] transition ${
                tab === t.key ? 'bg-rose-deep text-white font-medium' : 'bg-white text-ink-500 border border-cream-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'info' && <BasicsPanel person={person} onSave={updatePerson} />}
      {tab === 'pref' && <PreferencePanel personId={person.id} />}
      {tab === 'portrait' && <PortraitPanel personId={person.id} />}
      {tab === 'wish' && <WishPanel personId={person.id} />}
      {tab === 'gift' && <GiftPanel personId={person.id} />}
      {tab === 'health' && <HealthPanel personId={person.id} />}
    </div>
  )
}

function PersonCard({ person }: { person: Person }) {
  const lunar = person.birthday ? lunarInfoOf(occurrenceForDisplay(person)) : undefined
  return (
    <div className="card card-pad bg-gradient-to-br from-cream-100 to-white">
      <div className="flex items-center gap-3.5">
        <Avatar photoId={person.avatarPhotoId} name={person.nickname || person.name} size={68} />
        <div className="flex-1 min-w-0">
          <div className="text-[18px] font-semibold text-ink-900 truncate">
            {person.nickname || person.name || '还没有填名字'}
          </div>
          <div className="mt-1 flex items-center gap-2 flex-wrap text-[12.5px] text-ink-500">
            {person.zodiac && <Tag color="#C99BD9">{person.zodiac}</Tag>}
            {person.birthday && <span>生日 {person.birthday.slice(5)}</span>}
            {lunar && <span>农历{lunar.monthInChinese}月{lunar.dayInChinese}</span>}
          </div>
          {person.meetDate && (
            <div className="mt-1 text-[12.5px] text-ink-300">
              相识 {fmtDate(person.meetDate)} · 已经 {daysSince(person.meetDate)} 天
            </div>
          )}
        </div>
      </div>
      {person.intro && <p className="mt-3 text-[13.5px] text-ink-700 leading-relaxed">{person.intro}</p>}
    </div>
  )
}

function occurrenceForDisplay(person: Person) {
  if (!person.birthday) return new Date()
  const next = nextOccurrence(person.birthday, person.calendarType)
  return next?.date ?? new Date()
}

function BasicsPanel({ person, onSave }: { person: Person; onSave: (patch: Partial<Person>) => Promise<void> }) {
  const toast = useToast()
  const confirm = useConfirm()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState(person.name)
  const [nickname, setNickname] = useState(person.nickname ?? '')
  const [birthday, setBirthday] = useState(person.birthday ?? '')
  const [calendarType, setCalendarType] = useState<CalendarType>(person.calendarType)
  const [zodiacOverride, setZodiacOverride] = useState(person.zodiacOverridden ? person.zodiac ?? '' : '')
  const [meetDate, setMeetDate] = useState(person.meetDate ?? '')
  const [intro, setIntro] = useState(person.intro ?? '')
  const [anniversaries, setAnniversaries] = useState<Anniversary[]>(person.anniversaries ?? [])

  useEffect(() => {
    setName(person.name)
    setNickname(person.nickname ?? '')
    setBirthday(person.birthday ?? '')
    setCalendarType(person.calendarType)
    setZodiacOverride(person.zodiacOverridden ? person.zodiac ?? '' : '')
    setMeetDate(person.meetDate ?? '')
    setIntro(person.intro ?? '')
    setAnniversaries(person.anniversaries ?? [])
  }, [person.id])

  const autoZodiac = useMemo(() => {
    if (!birthday) return ''
    const parts = birthday.split('-').map(Number)
    const [, mm, dd] = parts
    if (!mm || !dd) return ''
    if (calendarType === 'solar') return zodiacOf(mm, dd)
    const y = parts[0] || new Date().getFullYear()
    const solar = lunarToSolar(y, mm, dd)
    return solar ? zodiacOf(solar.getMonth() + 1, solar.getDate()) : ''
  }, [birthday, calendarType])

  const lunarPreview = useMemo(() => {
    if (!birthday || calendarType !== 'lunar') return ''
    const next = nextOccurrence(birthday, 'lunar')
    return next ? `今年的公历生日是 ${fmtDate(next.date)}` : ''
  }, [birthday, calendarType])

  const uploadAvatar = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      const photo = await addPhotoFile(files[0], { personId: person.id, photoMaxEdge: 800, thumbMaxEdge: 240, keepOriginal: true })
      await onSave({ avatarPhotoId: photo.id })
      toast('头像已更新')
    } catch (e) {
      toast(`头像更新失败：${(e as Error).message}`, 'err')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        nickname: nickname.trim() || undefined,
        birthday: birthday || undefined,
        calendarType,
        zodiac: zodiaoOrAuto(),
        zodiacOverridden: Boolean(zodiacOverride.trim()),
        meetDate: meetDate || undefined,
        intro: intro.trim() || undefined,
        anniversaries,
      })
      toast('档案已保存')
    } finally {
      setSaving(false)
    }
  }

  function zodiaoOrAuto() {
    return zodiacOverride.trim() || autoZodiac || undefined
  }

  const addAnniversary = () => {
    setAnniversaries((prev) => [
      ...prev,
      { id: uid('an_'), name: '', date: toDateStr(new Date()), calendarType: 'solar', repeatYearly: true },
    ])
  }

  return (
    <div className="space-y-3">
      <SectionCard title="头像">
        <div className="flex items-center gap-4">
          <Avatar photoId={person.avatarPhotoId} name={nickname || name} size={72} />
          <div className="flex-1">
            <button className="btn-ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
              {busy ? '处理中…' : '上传头像'}
            </button>
            {person.avatarPhotoId && (
              <button
                className="btn-text ml-2"
                onClick={async () => {
                  const ok = await confirm({ title: '移除头像？', desc: '照片本身会保留在相册里。', confirmText: '移除' })
                  if (ok) {
                    await onSave({ avatarPhotoId: undefined })
                    toast('已移除头像')
                  }
                }}
              >
                移除
              </button>
            )}
            <p className="text-[12px] text-ink-300 mt-1.5">头像只存在你的设备上，不会上传到任何服务器。</p>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadAvatar(e.target.files)} />
      </SectionCard>

      <SectionCard title="基础信息">
        <Field label="名字">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="TA 的名字" />
        </Field>
        <Field label="昵称" hint="会显示在应用顶栏和大部分报告里。">
          <input className="input" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="平时怎么称呼 TA" />
        </Field>

        <Field label="生日" hint={lunarPreview || '支持公历或农历，切换历法后会自动换算。'}>
          <input type="date" className="input" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
          <div className="mt-2">
            <Segmented options={CALENDAR_TYPES} value={calendarType} onChange={(v) => setCalendarType(v)} />
          </div>
        </Field>

        <Field
          label="星座"
          hint={
            calendarType === 'lunar'
              ? `根据公历生日自动算出：${autoZodiac || '—'}。留空表示使用自动值，也可以手动覆盖。`
              : `根据公历生日自动算出：${autoZodiac || '—'}。星座只作为档案展示，画像结论主要依据实际记录。`
          }
        >
          <input
            className="input"
            value={zodiacOverride}
            onChange={(e) => setZodiacOverride(e.target.value)}
            placeholder={autoZodiac || '自动计算'}
          />
        </Field>

        <Field label="相识日" hint={meetDate ? `已经认识 ${daysSince(meetDate)} 天` : undefined}>
          <input type="date" className="input" value={meetDate} onChange={(e) => setMeetDate(e.target.value)} />
        </Field>

        <Field label="个人介绍">
          <textarea
            className="textarea"
            rows={3}
            placeholder="TA 是个什么样的人、你们怎么认识的、你喜欢 TA 的什么地方…"
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
          />
        </Field>

        <button className="btn-primary w-full" onClick={save} disabled={saving}>
          {saving && <Loader2 size={16} className="animate-spin" />}
          <Save size={16} /> 保存档案
        </button>
      </SectionCard>

      <SectionCard
        title="纪念日"
        action={
          <button className="btn-text" onClick={addAnniversary}>
            <Plus size={14} /> 添加
          </button>
        }
      >
        {anniversaries.length === 0 ? (
          <p className="text-[13.5px] text-ink-300">还没有其他纪念日。相识日和生日会自动出现在「今天」页的提醒里。</p>
        ) : (
          <div className="space-y-3">
            {anniversaries.map((a, i) => {
              const next = nextOccurrence(a.date, a.calendarType)
              return (
                <div key={a.id} className="rounded-xl border border-cream-200 bg-white p-3">
                  <div className="flex gap-2">
                    <input
                      className="input flex-1"
                      placeholder="纪念日名称，例：第一次一起旅行"
                      value={a.name}
                      onChange={(e) =>
                        setAnniversaries((prev) => prev.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))
                      }
                    />
                    <button
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-ink-300 hover:bg-cream-100 shrink-0"
                      onClick={() => setAnniversaries((prev) => prev.filter((_, idx) => idx !== i))}
                      aria-label="删除纪念日"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <input
                      type="date"
                      className="input flex-1"
                      value={a.date}
                      onChange={(e) =>
                        setAnniversaries((prev) => prev.map((x, idx) => (idx === i ? { ...x, date: e.target.value } : x)))
                      }
                    />
                  </div>
                  <div className="mt-2">
                    <Segmented
                      options={CALENDAR_TYPES}
                      value={a.calendarType}
                      onChange={(v) =>
                        setAnniversaries((prev) => prev.map((x, idx) => (idx === i ? { ...x, calendarType: v } : x)))
                      }
                    />
                  </div>
                  <div className="mt-1">
                    <Switch
                      checked={a.repeatYearly}
                      onChange={(v) => setAnniversaries((prev) => prev.map((x, idx) => (idx === i ? { ...x, repeatYearly: v } : x)))}
                      label="每年重复"
                      desc={next ? `下次：${fmtDate(next.date)}（${next.daysLeft} 天后）` : '不会进入年度提醒'}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <p className="text-[12px] text-ink-300 mt-3 leading-relaxed">
          农历日期与节日数据全部在本地计算，断网也能正常显示，不依赖任何外部接口。
        </p>
      </SectionCard>

      <PortraitHint />
    </div>
  )
}

function PortraitHint() {
  const { person } = useApp()
  const count = useLiveQuery(
    async () => (person?.id ? db.insights.where('personId').equals(person.id).count() : 0),
    [person?.id],
  )
  const prefs = useLiveQuery(
    async () => (person?.id ? db.preferences.where('personId').equals(person.id).count() : 0),
    [person?.id],
  )
  if (!count && !prefs) {
    return (
      <Empty
        title="档案越用越顺手"
        desc={'建议顺序：先随手记录 → 时间线回顾 → 有依据的个人画像 → 导出留存。\n第一次使用时，先把生日和相识日填上，就能看到提醒了。'}
      />
    )
  }
  return (
    <div className="card card-pad">
      <div className="text-[13.5px] text-ink-700">
        已经记录了 <b>{prefs ?? 0}</b> 条偏好、<b>{count ?? 0}</b> 条画像。
      </div>
      <p className="text-[12.5px] text-ink-300 mt-1">
        画像维度参考：{PORTRAIT_DIMENSIONS.map((d) => d.label).join(' · ')}
      </p>
    </div>
  )
}

export { nowISO }
