import Dexie, { type Table } from 'dexie'
import { recordDeletion, setTombstoneSink, TOMBSTONE_ENTITIES, type Tombstone } from '../lib/tombstones'
import type { ConflictCopy } from '../lib/conflicts'
import type { Task, TaskOccurrence, TaskReminder } from '../tasks/types'
import type { Memoir } from '../memoir/types'
import type {
  AIConfig,
  AppPrefs,
  DailyStatus,
  Entry,
  GameContent,
  Gift,
  HealthRecord,
  MetaRow,
  Person,
  Photo,
  PortraitInsight,
  Preference,
  Summary,
  Wish,
} from './types'

export class HeartLogDB extends Dexie {
  persons!: Table<Person, string>
  preferences!: Table<Preference, string>
  entries!: Table<Entry, string>
  dailyStatus!: Table<DailyStatus, string>
  health!: Table<HealthRecord, string>
  gifts!: Table<Gift, string>
  wishes!: Table<Wish, string>
  photos!: Table<Photo, string>
  insights!: Table<PortraitInsight, string>
  summaries!: Table<Summary, string>
  meta!: Table<MetaRow, string>
  tombstones!: Table<Tombstone, string>
  conflicts!: Table<ConflictCopy, string>
  tasks!: Table<Task, string>
  taskReminders!: Table<TaskReminder, string>
  taskOccurrences!: Table<TaskOccurrence, string>
  memoirs!: Table<Memoir, string>
  gameContent!: Table<GameContent, string>

  constructor() {
    super('heartlog')
    this.version(1).stores({
      persons: 'id, name, isActive, createdAt, updatedAt',
      preferences: 'id, personId, category, direction, updatedAt',
      entries: 'id, personId, occurredAt, type, createdAt, updatedAt',
      dailyStatus: 'id, personId, date, updatedAt',
      health: 'id, personId, occurredAt, status, updatedAt',
      gifts: 'id, personId, givenAt, updatedAt',
      wishes: 'id, personId, status, raisedAt, updatedAt',
      photos: 'id, personId, entryId, giftId, takenAt, createdAt, *tags',
      insights: 'id, personId, dimension, confirmState, updatedAt',
      summaries: 'id, personId, kind, rangeStart, rangeEnd, createdAt',
      meta: 'key',
    })
    // v2 只加一张表：删除同步用的墓碑。老库升级不丢数据（Dexie 按版本增量迁移）。
    this.version(2).stores({
      tombstones: 'id, entity, deletedAt, pushedAt',
    })
    // v3 只加一张表：同步冲突副本。覆盖前先留一份被丢弃的版本，可事后查看/取回。
    this.version(3).stores({
      conflicts: 'id, entity, rowId, discardedUpdatedAt, detectedAt, dismissedAt',
    })
    /**
     * v4：T8「为他记着」三张表。仍是增量新增，不动 v1~v3 的任何表与数据。
     * - tasks：任务本身（rev 为业务版本，与 updatedAt 分开，供私有同步拒绝旧版本覆盖）
     * - taskReminders：提醒计划，一个任务可多条；rev 独立，编辑提醒不会改任务版本
     * - taskOccurrences：发生实例，id = `${taskId}@${slotMs}` 天然幂等，
     *   站内提醒与系统通知共用它，所以「已读」与「完成」是两件事
     * 三张表都不参与公开发布（D-008 默认私有）。
     */
    this.version(4).stores({
      tasks: 'id, personId, status, kind, dueDate, updatedAt, *seriesId',
      taskReminders: 'id, taskId, enabled, updatedAt',
      taskOccurrences: 'id, taskId, slotAt, firedAt, readAt',
    })
    /**
     * v5：T5 回忆录。仍是增量新增，不动 v1~v4 任何表。
     *
     * 只建一张表：章节作为 `sections` 数组存在回忆录行内。
     * 章节数量是个位数到几十，单独建表会引入「章节与回忆录不同步」的中间态，
     * 而它们本来就是整篇一起编辑、一起保存的。
     */
    this.version(5).stores({
      memoirs: 'id, personId, status, updatedAt',
    })
    /**
     * v6：T6 第三版玩法内容（五道题 / 活动抽卡，第四版寻宝预留）。
     * 仍是增量新增，不动 v1~v5 的任何表；旧库升级时自动补空表。
     */
    this.version(6).stores({
      gameContent: 'id, personId, kind, enabled, updatedAt',
    })
  }
}

export const db = new HeartLogDB()

/* ------------------------------------------------------------------ */
/* 删除墓碑采集：挂在 Dexie 的 deleting 钩子上                          */
/* 这样任何删除路径（含以后新增的）都会被记下来，不依赖调用点自觉。      */
/* ------------------------------------------------------------------ */

setTombstoneSink(async (items) => {
  await db.tombstones.bulkPut(items)
})

for (const entity of TOMBSTONE_ENTITIES) {
  const table = (db as unknown as Record<string, Table<unknown, string>>)[entity]
  if (!table?.hook) continue
  table.hook('deleting', (primKey) => {
    if (primKey === undefined || primKey === null) return
    recordDeletion(entity, String(primKey))
  })
}

/* ------------------------------------------------------------------ */
/* 通用工具                                                            */
/* ------------------------------------------------------------------ */

export function uid(prefix = ''): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14)
  return `${prefix}${Date.now().toString(36)}${rand}`
}

export function nowISO(): string {
  return new Date().toISOString()
}

/* ------------------------------------------------------------------ */
/* meta 键值设置                                                       */
/* ------------------------------------------------------------------ */

export const DEFAULT_AI: AIConfig = {
  enabled: false,
  provider: 'own',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  cloudModel: '',
  viaProxy: false,
  proxyUrl: '',
  temperature: 0.7,
}

export const DEFAULT_PREFS: AppPrefs = {
  keepOriginalPhoto: false,
  photoMaxEdge: 1920,
  thumbMaxEdge: 400,
  moodBlankForMissing: true,
  remindersEnabled: true,
  remindDaysAhead: 7,
  gameEnabled: true,
  games: {
    memory: { enabled: true },
    puzzle: { enabled: false },
    photoGuess: { enabled: false },
    memoryBox: { enabled: false },
    timeline: { enabled: false },
    quiz: { enabled: false },
    dateDraw: { enabled: false },
    treasure: { enabled: false },
  },
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key)
  if (!row || row.value === undefined || row.value === null) return fallback
  return { ...(fallback as object), ...(row.value as object) } as T
}

/**
 * 读取标量型的 meta（字符串 / 数字）。
 *
 * 注意：`getMeta` 是给对象型配置用的——它会用展开合并默认值，字符串走展开会变成一个
 * 下标对象（`{0:'2',1:'0',...}`），再把这种东西传给 PostgREST 就会得到
 * `invalid input syntax for type timestamp with time zone: "[object Object]"`。
 * 字符串、数字一律用这个函数。
 */
export async function getMetaValue<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key)
  if (!row || row.value === undefined || row.value === null) return fallback
  return row.value as T
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
  await db.meta.put({ key, value })
}

/* ------------------------------------------------------------------ */
/* 人物                                                                */
/* ------------------------------------------------------------------ */

/**
 * 取当前主人物。
 * 多个人物时选择规则必须「确定」——否则刷新后可能切到另一条记录上，
 * 表现为「记录明明在库里，界面却是空的」。
 * 规则：先选有内容的（事件/照片/偏好数量最多），再比创建时间最早的。
 */
export async function getPrimaryPerson(): Promise<Person | undefined> {
  const all = await db.persons.toArray()
  if (!all.length) return undefined
  const active = all.filter((p) => p.isActive)
  const pool = active.length ? active : all
  if (pool.length === 1) return pool[0]

  const scored = await Promise.all(
    pool.map(async (p) => ({
      person: p,
      score:
        (await db.entries.where('personId').equals(p.id).count()) +
        (await db.photos.where('personId').equals(p.id).count()) +
        (await db.preferences.where('personId').equals(p.id).count()) +
        (await db.wishes.where('personId').equals(p.id).count()),
    })),
  )
  scored.sort((a, b) => b.score - a.score || (a.person.createdAt < b.person.createdAt ? -1 : 1))
  return scored[0].person
}

/** 清理重复产生的空人物档案（只删完全没有关联数据的，绝不碰有内容的） */
async function cleanupEmptyPersons(keepId: string): Promise<void> {
  const all = await db.persons.toArray()
  if (all.length <= 1) return
  for (const p of all) {
    if (p.id === keepId) continue
    const [entries, photos, prefs, wishes, gifts, health, statuses, insights, summaries] = await Promise.all([
      db.entries.where('personId').equals(p.id).count(),
      db.photos.where('personId').equals(p.id).count(),
      db.preferences.where('personId').equals(p.id).count(),
      db.wishes.where('personId').equals(p.id).count(),
      db.gifts.where('personId').equals(p.id).count(),
      db.health.where('personId').equals(p.id).count(),
      db.dailyStatus.where('personId').equals(p.id).count(),
      db.insights.where('personId').equals(p.id).count(),
      db.summaries.where('personId').equals(p.id).count(),
    ])
    const total = entries + photos + prefs + wishes + gifts + health + statuses + insights + summaries
    const hasProfile = Boolean(p.name || p.nickname || p.birthday || p.avatarPhotoId || p.meetDate || p.intro)
    if (total === 0 && !hasProfile) await db.persons.delete(p.id)
  }
}

/**
 * 确保存在一个主人物。
 * 注意：必须做「单例化」，因为 React StrictMode 下 effect 会执行两次，
 * 并发调用会各自查到「还没有人物」从而插入两条，导致数据分散。
 */
let ensurePromise: Promise<Person> | undefined

export function ensurePrimaryPerson(): Promise<Person> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const existing = await getPrimaryPerson()
      if (existing) {
        await cleanupEmptyPersons(existing.id)
        return existing
      }
      const t = nowISO()
      const person: Person = {
        id: uid('p_'),
        name: '',
        calendarType: 'solar',
        anniversaries: [],
        tags: [],
        isActive: true,
        createdAt: t,
        updatedAt: t,
      }
      await db.persons.put(person)
      return person
    })().catch((err) => {
      ensurePromise = undefined
      throw err
    })
  }
  return ensurePromise
}

export async function savePerson(patch: Partial<Person> & { id: string }): Promise<Person> {
  const current = await db.persons.get(patch.id)
  const next = { ...(current as Person), ...patch, updatedAt: nowISO() }
  await db.persons.put(next)
  return next
}

/* ------------------------------------------------------------------ */
/* 通用 CRUD 工厂                                                      */
/* ------------------------------------------------------------------ */

type WithPersonAndTime = { id: string; personId: string; createdAt: string; updatedAt: string }

export function makeRepo<T extends WithPersonAndTime>(table: Table<T, string>, prefix: string) {
  return {
    async create(data: Omit<T, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<T, 'id'>>): Promise<T> {
      const t = nowISO()
      const row = { ...(data as object), id: (data as { id?: string }).id || uid(prefix), createdAt: t, updatedAt: t } as T
      await table.put(row)
      return row
    },
    async update(id: string, patch: Partial<T>): Promise<void> {
      await table.update(id, { ...(patch as object), updatedAt: nowISO() } as never)
    },
    async remove(id: string): Promise<void> {
      await table.delete(id)
    },
    async get(id: string): Promise<T | undefined> {
      return table.get(id)
    },
    async listByPerson(personId: string): Promise<T[]> {
      return table.where('personId').equals(personId).toArray()
    },
  }
}

export const prefRepo = makeRepo(db.preferences, 'pr_')
export const entryRepo = makeRepo(db.entries, 'e_')
export const giftRepo = makeRepo(db.gifts, 'g_')
export const wishRepo = makeRepo(db.wishes, 'w_')
export const healthRepo = makeRepo(db.health, 'h_')
export const insightRepo = makeRepo(db.insights, 'i_')
/** 总结 / 回顾：档案页「历史回顾」用 */
export const summaryRepo = makeRepo(db.summaries, 'sm_')

/** 每日状态按 personId + date 唯一，使用 upsert */
export async function upsertDailyStatus(
  personId: string,
  date: string,
  patch: Partial<DailyStatus>,
): Promise<DailyStatus> {
  const existing = await db.dailyStatus.filter((d) => d.personId === personId && d.date === date).first()
  const t = nowISO()
  if (existing) {
    const next = { ...existing, ...patch, updatedAt: t }
    await db.dailyStatus.put(next)
    return next
  }
  const row: DailyStatus = {
    id: uid('d_'),
    personId,
    date,
    createdAt: t,
    updatedAt: t,
    ...patch,
  }
  await db.dailyStatus.put(row)
  return row
}

/* ------------------------------------------------------------------ */
/* 照片                                                                */
/* ------------------------------------------------------------------ */

export async function putPhoto(photo: Photo): Promise<Photo> {
  await db.photos.put(photo)
  return photo
}

/** 只改题注：不动图片数据，清空即视为「没有题注」 */
export async function updatePhotoCaption(id: string, caption: string): Promise<Photo | undefined> {
  const photo = await db.photos.get(id)
  if (!photo) return undefined
  const text = caption.trim()
  const next: Photo = { ...photo, caption: text || undefined }
  await db.photos.put(next)
  return next
}

export async function deletePhotoCascade(id: string): Promise<void> {
  const photo = await db.photos.get(id)
  if (!photo) return
  await db.transaction('rw', db.photos, db.entries, db.gifts, db.persons, async () => {
    await db.photos.delete(id)
    const entries = await db.entries.where('personId').equals(photo.personId).toArray()
    for (const e of entries) {
      if (e.photoIds.includes(id)) {
        await db.entries.update(e.id, { photoIds: e.photoIds.filter((x) => x !== id), updatedAt: nowISO() })
      }
    }
    const gifts = await db.gifts.where('personId').equals(photo.personId).toArray()
    for (const g of gifts) {
      if (g.photoIds.includes(id)) {
        await db.gifts.update(g.id, { photoIds: g.photoIds.filter((x) => x !== id), updatedAt: nowISO() })
      }
    }
    const person = await db.persons.get(photo.personId)
    if (person?.avatarPhotoId === id) {
      await db.persons.update(person.id, { avatarPhotoId: undefined, updatedAt: nowISO() })
    }
  })
}

/* ------------------------------------------------------------------ */
/* 事件删除的级联清理                                                   */
/* ------------------------------------------------------------------ */

export async function deleteEntryCascade(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.entries, db.photos, db.preferences, db.insights, db.health, db.gifts, db.wishes],
    async () => {
    await db.entries.delete(id)
    // 事件上的照片一并解除关联（照片本身保留在相册）
    const photos = await db.photos.where('entryId').equals(id).toArray()
    for (const p of photos) await db.photos.update(p.id, { entryId: undefined })
    // 偏好 / 画像的依据引用
    const prefs = await db.preferences.toArray()
    for (const pr of prefs) {
      if (pr.evidenceEntryIds.includes(id)) {
        await db.preferences.update(pr.id, {
          evidenceEntryIds: pr.evidenceEntryIds.filter((x) => x !== id),
          updatedAt: nowISO(),
        })
      }
    }
    const insights = await db.insights.toArray()
    for (const ins of insights) {
      if (ins.evidenceEntryIds.includes(id)) {
        await db.insights.update(ins.id, {
          evidenceEntryIds: ins.evidenceEntryIds.filter((x) => x !== id),
          updatedAt: nowISO(),
        })
      }
    }
    const healths = await db.health.toArray()
    for (const h of healths) {
      if (h.entryIds.includes(id)) {
        await db.health.update(h.id, { entryIds: h.entryIds.filter((x) => x !== id), updatedAt: nowISO() })
      }
    }
    const gifts = await db.gifts.toArray()
    for (const g of gifts) {
      if (g.entryId === id) await db.gifts.update(g.id, { entryId: undefined, updatedAt: nowISO() })
    }
    const wishes = await db.wishes.toArray()
    for (const w of wishes) {
      if (w.entryIds.includes(id)) {
        await db.wishes.update(w.id, { entryIds: w.entryIds.filter((x) => x !== id), updatedAt: nowISO() })
      }
    }
  })
}
