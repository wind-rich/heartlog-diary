import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { db, entryRepo, nowISO } from '../db/db'
import type { Entry, EntryType, Mood } from '../db/types'
import { COMMON_TAGS, ENTRY_TYPES, MOODS } from '../lib/constants'
import { fmtDate, fromLocalInput, toDateStr, toLocalInput } from '../lib/date'
import { addPhotoFiles } from '../lib/photo'
import { Chips, Field, Modal, PhotoImg, Stars, Switch, useToast } from './ui'
import { useApp } from '../state/app'

interface Props {
  open: boolean
  onClose: () => void
  personId: string
  entry?: Entry
  /** 补记：默认日期 */
  defaultDate?: Date
  quick?: boolean
}

interface DraftPhoto {
  id?: string
  file?: File
}

export default function EntryEditor({ open, onClose, personId, entry, defaultDate, quick = false }: Props) {
  const toast = useToast()
  const { prefs } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)

  const [occurredAt, setOccurredAt] = useState('')
  const [type, setType] = useState<EntryType>('daily')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [taSaid, setTaSaid] = useState('')
  const [myObservation, setMyObservation] = useState('')
  const [mood, setMood] = useState<Mood | undefined>()
  const [moodCustom, setMoodCustom] = useState('')
  const [moodLevel, setMoodLevel] = useState<number | undefined>()
  const [tagList, setTagList] = useState<string[]>([])
  const [followUp, setFollowUp] = useState('')
  const [followUpDone, setFollowUpDone] = useState(false)
  const [photos, setPhotos] = useState<DraftPhoto[]>([])
  const [busy, setBusy] = useState(false)
  const [showMore, setShowMore] = useState(!quick)

  // 关联创建
  const [linkGift, setLinkGift] = useState(false)
  const [linkHealth, setLinkHealth] = useState(false)
  const [linkPref, setLinkPref] = useState(false)

  useEffect(() => {
    if (!open) return
    if (entry) {
      setOccurredAt(toLocalInput(entry.occurredAt))
      setType(entry.type)
      setTitle(entry.title)
      setContent(entry.content ?? '')
      setTaSaid(entry.taSaid ?? '')
      setMyObservation(entry.myObservation ?? '')
      setMood(entry.mood)
      setMoodCustom(entry.moodCustom ?? '')
      setMoodLevel(entry.moodLevel)
      setTagList(entry.tagList ?? [])
      setFollowUp(entry.followUp ?? '')
      setFollowUpDone(entry.followUpDone)
      setShowMore(true)
      db.photos.bulkGet(entry.photoIds ?? []).then((list) => {
        setPhotos(list.filter(Boolean).map((p) => ({ id: p!.id })))
      })
    } else {
      const base = defaultDate ?? new Date()
      setOccurredAt(toLocalInput(base))
      setType('daily')
      setTitle('')
      setContent('')
      setTaSaid('')
      setMyObservation('')
      setMood(undefined)
      setMoodCustom('')
      setMoodLevel(undefined)
      setTagList([])
      setFollowUp('')
      setFollowUpDone(false)
      setPhotos([])
      setShowMore(!quick)
    }
    setLinkGift(false)
    setLinkHealth(false)
    setLinkPref(false)
  }, [open, entry, defaultDate, quick])

  const existingIds = useMemo(() => entry?.photoIds ?? [], [entry])

  const pickFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      const created = await addPhotoFiles(Array.from(files), {
        personId,
        entryId: entry?.id,
        keepOriginal: prefs.keepOriginalPhoto,
        photoMaxEdge: prefs.photoMaxEdge,
        thumbMaxEdge: prefs.thumbMaxEdge,
      })
      setPhotos((prev) => [...prev, ...created.map((p) => ({ id: p.id }))])
      toast(`已添加 ${created.length} 张照片`)
    } catch (e) {
      toast(`照片添加失败：${(e as Error).message}`, 'err')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const removePhoto = async (p: DraftPhoto, idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx))
    if (p.id && !existingIds.includes(p.id)) {
      await db.photos.delete(p.id)
    }
  }

  const save = async () => {
    if (!title.trim() && !content.trim() && !taSaid.trim()) {
      toast('至少写一句标题或经过吧', 'err')
      return
    }
    setBusy(true)
    try {
      const iso = fromLocalInput(occurredAt)
      const photoIds = photos.map((p) => p.id!).filter(Boolean)
      const data = {
        personId,
        occurredAt: iso,
        type,
        title: title.trim() || '（无标题）',
        content: content.trim() || undefined,
        taSaid: taSaid.trim() || undefined,
        myObservation: myObservation.trim() || undefined,
        mood,
        moodCustom: mood === 'custom' ? moodCustom.trim() || undefined : undefined,
        moodLevel,
        tagList,
        photoIds,
        followUp: followUp.trim() || undefined,
        followUpDone,
        quick: quick && !showMore,
      }

      let saved: Entry
      if (entry) {
        await entryRepo.update(entry.id, data)
        saved = { ...entry, ...data }
      } else {
        saved = await entryRepo.create(data)
      }

      // 照片回填归属事件
      for (const pid of photoIds) {
        await db.photos.update(pid, { entryId: saved.id })
      }

      // 关联创建
      if (!entry) {
        if (linkGift) {
          await db.gifts.put({
            id: `g_${saved.id}`,
            personId,
            name: saved.title,
            givenAt: saved.occurredAt,
            occasion: saved.title,
            feedback: saved.taSaid,
            entryId: saved.id,
            photoIds,
            createdAt: nowISO(),
            updatedAt: nowISO(),
          })
        }
        if (linkHealth) {
          await db.health.put({
            id: `h_${saved.id}`,
            personId,
            occurredAt: saved.occurredAt,
            symptom: saved.title,
            note: saved.content,
            status: 'ongoing',
            entryIds: [saved.id],
            createdAt: nowISO(),
            updatedAt: nowISO(),
          })
        }
        if (linkPref) {
          await db.preferences.put({
            id: `pr_${saved.id}`,
            personId,
            category: 'other',
            name: saved.title,
            direction: 'like',
            note: saved.content,
            tags: saved.tagList,
            lastConfirmedAt: toDateStr(saved.occurredAt),
            evidenceEntryIds: [saved.id],
            createdAt: nowISO(),
            updatedAt: nowISO(),
          })
        }
      }

      toast(entry ? '已更新' : '已记下')
      onClose()
    } catch (e) {
      toast(`保存失败：${(e as Error).message}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      sheet
      full={!quick}
      title={entry ? '编辑记录' : quick ? '随手记一笔' : '新记录'}
      footer={
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="btn-primary flex-[2]" onClick={save} disabled={busy}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            {entry ? '保存修改' : '保存'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 快速记录：一句话 + 照片 + 标签 */}
        <Field label="发生了什么" required>
          <textarea
            className="textarea"
            rows={quick && !showMore ? 2 : 2}
            placeholder="例：今天送了耳机，TA 很开心"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ fontSize: 16 }}
          />
        </Field>

        <div className="flex items-center justify-between gap-3">
          <Field label="类型" className="mb-0 flex-1">
            <Chips
              options={ENTRY_TYPES.map((t) => ({ value: t.value, label: t.label, emoji: t.emoji }))}
              value={type}
              onChange={(v) => setType(v as EntryType)}
            />
          </Field>
        </div>

        <Field label="发生时间" hint="补记历史事件时改成真实发生时间，创建时间会另存。">
          <input
            type="datetime-local"
            className="input"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
          />
        </Field>

        <div>
          <div className="label">照片</div>
          <div className="flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <div key={p.id ?? i} className="relative w-[84px] h-[84px] rounded-xl overflow-hidden bg-cream-200">
                {p.id && <PhotoImg photoId={p.id} className="w-full h-full object-cover" />}
                <button
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/55 text-white flex items-center justify-center"
                  onClick={() => removePhoto(p, i)}
                  aria-label="删除照片"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button
              className="w-[84px] h-[84px] rounded-xl border border-dashed border-cream-300 bg-cream-50 text-ink-300 flex flex-col items-center justify-center gap-1 hover:border-rose-soft hover:text-rose-deep"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
              <span className="text-[11px]">加照片</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => pickFiles(e.target.files)}
            />
          </div>
        </div>

        {!showMore ? (
          <div className="pt-1">
            <button className="btn-text" onClick={() => setShowMore(true)}>
              <Camera size={14} /> 展开完整记录（经过 / TA 说了什么 / 我的观察 / 心情 / 后续）
            </button>
          </div>
        ) : (
          <>
            <Field label="具体经过">
              <textarea
                className="textarea"
                rows={3}
                placeholder="事情是怎么发生的，细节越多后面越有得回顾"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </Field>

            <div className="p-3 rounded-xl bg-cream-100 border border-cream-200 space-y-3">
              <p className="text-[12px] text-ink-500 leading-snug">
                下面两项分开保存：<b className="text-ink-700">TA 说了什么</b> 是 TA 的直接表达，
                <b className="text-ink-700">我的观察</b> 是你自己的判断。区分开能让 AI 总结更准确。
              </p>
              <Field label="TA 说了什么" className="mb-0">
                <textarea
                  className="textarea bg-white"
                  rows={2}
                  placeholder="例：TA 说今天很累"
                  value={taSaid}
                  onChange={(e) => setTaSaid(e.target.value)}
                />
              </Field>
              <Field label="我的观察" className="mb-0">
                <textarea
                  className="textarea bg-white"
                  rows={2}
                  placeholder="例：我感觉 TA 有点失落"
                  value={myObservation}
                  onChange={(e) => setMyObservation(e.target.value)}
                />
              </Field>
            </div>

            <Field label="当天心情">
              <Chips
                options={MOODS.map((m) => ({ value: m.value, label: m.label, emoji: m.emoji }))}
                value={mood ?? ''}
                onChange={(v) => setMood((v as Mood) || undefined)}
              />
              {mood === 'custom' && (
                <input
                  className="input mt-2"
                  placeholder="自定义心情，例如「松了一口气」"
                  value={moodCustom}
                  onChange={(e) => setMoodCustom(e.target.value)}
                />
              )}
            </Field>

            <Field label="心情程度（可选 1~5）">
              <Stars value={moodLevel} onChange={setMoodLevel} />
            </Field>

            <Field label="标签">
              <Chips
                options={COMMON_TAGS.map((t) => ({ value: t, label: t }))}
                value={tagList}
                onChange={(v) => setTagList(v as string[])}
                multi
                allowCustom
              />
            </Field>

            <Field label="后续需要做什么" hint="留空的记录不会出现在「待跟进」里。">
              <input
                className="input"
                placeholder="例：下次问问 TA 耳机戴着舒不舒服"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
              />
            </Field>
            {followUp.trim() && (
              <Switch checked={followUpDone} onChange={setFollowUpDone} label="这件事已经完成了" />
            )}

            {!entry && type === 'gift' && (
              <Switch checked={linkGift} onChange={setLinkGift} label="同时记入「礼物」清单" desc="方便以后看送礼历史与 TA 的反应" />
            )}
            {!entry && type === 'health' && (
              <Switch checked={linkHealth} onChange={setLinkHealth} label="同时加入「健康跟进」" desc="状态默认「跟进中」，可在档案页更新恢复情况" />
            )}
            {!entry && type === 'interest' && (
              <Switch
                checked={linkPref}
                onChange={setLinkPref}
                label="同时加入「兴趣与偏好」"
                desc={`会以「${title.trim() || '这条记录'}」为名建立偏好，依据指向本条记录`}
              />
            )}
          </>
        )}

        {quick && showMore && (
          <button className="btn-text" onClick={() => setShowMore(false)}>
            收起，只记这一句
          </button>
        )}

        {entry && (
          <div className="text-[12px] text-ink-300 pt-1 border-t border-cream-200">
            创建于 {fmtDate(entry.createdAt)} · 最近修改 {fmtDate(entry.updatedAt)}
          </div>
        )}
      </div>
    </Modal>
  )
}
