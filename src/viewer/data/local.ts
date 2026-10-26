/**
 * 作者端本地快照：把本机 Dexie 数据映射成展示端那套 PublishedSnapshot 结构。
 *
 * 这样作者端可以直接复用访客端的全部页面（宇宙首页 / 故事 / 相册 / 档案），
 * 只在外面加编辑入口，不必维护第二套界面。
 *
 * 与 `lib/publishedCopy.ts` 方向相反：那边是「快照 → 本机」，这里是「本机 → 快照」。
 * 照片的 blob 会转成 objectURL 供 <img> 使用；这些 URL 随页面生命周期存在，刷新即释放。
 */
import { db, DEFAULT_PREFS, getMeta } from '../../db/db'
import type { AppPrefs } from '../../db/types'
import type { PublishedSnapshot, PublicPhoto, PublicEntry, ViewerGamesConfig } from '../types'
import { VIEWER_FORMAT_VERSION } from '../types'
import { GAME_IDS } from '../game/config'

const urls: string[] = []

export function revokeLocalMedia(): void {
  for (const u of urls.splice(0)) {
    try {
      URL.revokeObjectURL(u)
    } catch {
      // 忽略
    }
  }
}

function objectUrl(blob: Blob | undefined): string {
  if (!blob) return ''
  const u = URL.createObjectURL(blob)
  urls.push(u)
  return u
}

const byIdDesc = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => b.id.localeCompare(a.id))

/** 读取本机数据并组装成展示端结构；空库返回 null 由调用方处理 */
export async function buildLocalSnapshot(): Promise<PublishedSnapshot | null> {
  revokeLocalMedia()

  const persons = await db.persons.toArray()
  const person = persons.find((p) => p.isActive) ?? persons[0]
  if (!person) return null

  // 展示端配置里的开关（T6 小游戏等）来自作者偏好
  const prefs = await getMeta<AppPrefs>('prefs', DEFAULT_PREFS)

  const [entries, photos, preferences, wishes, gifts, health, insights, summaries, statuses] = await Promise.all([
    db.entries.toArray(),
    db.photos.toArray(),
    db.preferences.toArray(),
    db.wishes.toArray(),
    db.gifts.toArray(),
    db.health.toArray(),
    db.insights.toArray(),
    db.summaries.toArray(),
    db.dailyStatus.toArray(),
  ])

  const publicPhotos: PublicPhoto[] = byIdDesc(photos).map((p) => {
    const thumb = objectUrl(p.thumb)
    const full = objectUrl(p.blob)
    return {
      id: p.id,
      personId: p.personId,
      mime: p.mime,
      size: p.size,
      takenAt: p.takenAt,
      caption: p.caption,
      tags: p.tags ?? [],
      entryId: p.entryId,
      giftId: p.giftId,
      media: {
        thumb: { key: p.id, url: thumb, mime: p.mime, size: p.thumb?.size ?? 0 },
        full: { key: p.id, url: full, mime: p.mime, size: p.size },
      },
    }
  })

  const publicEntries: PublicEntry[] = byIdDesc(entries).map((e) => ({
    id: e.id,
    occurredAt: e.occurredAt,
    kind: e.type,
    title: e.title,
    content: e.content,
    taSaid: e.taSaid,
    myObservation: e.myObservation,
    mood: e.mood,
    moodCustom: e.moodCustom,
    moodLevel: e.moodLevel,
    tags: e.tagList ?? [],
    photoIds: e.photoIds ?? [],
    quick: !!e.quick,
  }))

  const gameEnabled = prefs.gameEnabled !== false
  const games = Object.fromEntries(
    GAME_IDS.map((id) => [
      id,
      { enabled: id === 'memory' ? prefs.games?.[id]?.enabled ?? gameEnabled : prefs.games?.[id]?.enabled === true },
    ]),
  ) as ViewerGamesConfig

  const snapshot: PublishedSnapshot = {
    manifest: {
      formatVersion: VIEWER_FORMAT_VERSION,
      siteId: 'local-author',
      publishId: 'local',
      publishedAt: new Date().toISOString(),
      counts: {
        persons: 1,
        anniversaries: person.anniversaries?.length ?? 0,
        entries: publicEntries.length,
        photos: publicPhotos.length,
        preferences: preferences.length,
        wishes: wishes.length,
        gifts: gifts.length,
        health: health.length,
        insights: insights.length,
        summaries: summaries.length,
        statuses: statuses.length,
      },
      contentHash: '',
    },
    config: {
      centerPersonId: person.id,
      tagline: '',
      coverPhotoId: person.avatarPhotoId,
      theme: 'warm-light',
      // T6：总开关 + 子玩法白名单；旧字段继续作为记忆配对的总开关兼容
      sections: { photos: true, stories: true, archive: true, wishes: true, health: true, music: false, game: gameEnabled },
      games,
    },
    person: {
      id: person.id,
      displayName: person.name,
      nickname: person.nickname,
      intro: person.intro,
      avatarPhotoId: person.avatarPhotoId,
      birthday: person.birthday,
      calendarType: person.calendarType ?? 'solar',
      zodiac: person.zodiac,
      meetDate: person.meetDate,
      tags: person.tags ?? [],
    },
    anniversaries: (person.anniversaries ?? [])
      .slice()
      .map((a) => ({
        id: a.id,
        name: a.name,
        date: a.date,
        calendarType: a.calendarType,
        repeatYearly: a.repeatYearly,
        note: a.note,
      })),
    entries: publicEntries,
    photos: publicPhotos,
    preferences: byIdDesc(preferences).map((r) => ({
      id: r.id,
      category: r.category,
      name: r.name,
      direction: r.direction,
      likeLevel: r.likeLevel,
      note: r.note,
      tags: r.tags ?? [],
      lastConfirmedAt: r.lastConfirmedAt,
      evidenceEntryIds: r.evidenceEntryIds ?? [],
    })),
    wishes: byIdDesc(wishes).map((r) => ({
      id: r.id,
      content: r.content,
      raisedAt: r.raisedAt,
      status: r.status,
      priority: r.priority,
      occasion: r.occasion,
      note: r.note,
      giftId: r.giftId,
      entryIds: r.entryIds ?? [],
    })),
    gifts: byIdDesc(gifts).map((r) => ({
      id: r.id,
      name: r.name,
      givenAt: r.givenAt,
      occasion: r.occasion,
      feedback: r.feedback,
      note: r.note,
      photoIds: r.photoIds ?? [],
      wishId: r.wishId,
      entryId: r.entryId,
    })),
    health: byIdDesc(health).map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
      symptom: r.symptom,
      severity: r.severity,
      note: r.note,
      status: r.status,
      recovery: r.recovery,
      resolvedAt: r.resolvedAt,
    })),
    insights: byIdDesc(insights).map((r) => ({
      id: r.id,
      dimension: r.dimension,
      description: r.description,
      evidenceType: r.evidenceType,
      evidenceEntryIds: r.evidenceEntryIds ?? [],
      confirmState: r.confirmState,
    })),
    summaries: byIdDesc(summaries).map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      rangeStart: r.rangeStart,
      rangeEnd: r.rangeEnd,
      content: r.content,
      generator: r.generator,
      evidenceEntryIds: r.evidenceEntryIds ?? [],
    })),
    statuses: byIdDesc(statuses).map((r) => ({
      id: r.id,
      date: r.date,
      mood: r.mood,
      moodLevel: r.moodLevel,
      energy: r.energy,
      sleepHours: r.sleepHours,
      goodThing: r.goodThing,
      worry: r.worry,
      note: r.note,
    })),
  }

  return snapshot
}
