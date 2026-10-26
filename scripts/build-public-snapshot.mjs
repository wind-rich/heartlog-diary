/**
 * T1 真实快照映射：把私有完整备份映射成展示端公开快照。
 *
 * 用法：
 *   node scripts/build-public-snapshot.mjs
 *   node scripts/build-public-snapshot.mjs --zip <备份.zip> --out <输出目录>
 *
 * 输入：默认读取 verify/_artifacts/migration/private/original/source-backup.zip（已被 Git 忽略）
 * 输出：默认写入 verify/_artifacts/migration/private/publish/
 *   public-snapshot.json   公开快照（含清单、配置、业务内容；媒体用相对路径引用）
 *   media/                 原图与缩略图（沿用原有文件名，不重命名、不重压缩）
 *   _private/              映射报告、媒体索引（私有，不进 Git、不进公开包）
 *
 * 约束（对应大纲 T1）：
 * - 不把 BackupData 直接当公开结构；meta 整体排除，只做键名统计，不复制任何值。
 * - 逐字段映射，未映射字段必须显式列出，不静默丢弃。
 * - 相同输入必须产出相同的规范化内容与哈希；照片不重写、不重新压缩。
 * - 输出中不得出现 API 密钥、发布凭据等秘密。
 */
import JSZip from 'jszip'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync, statSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const ZIP = resolve(arg('zip', join(ROOT, 'verify/_artifacts/migration/private/original/source-backup.zip')))
const OUT = resolve(arg('out', join(ROOT, 'verify/_artifacts/migration/private/publish')))
const SITE_ID = arg('site-id', 'heartlog-main')

if (!existsSync(ZIP)) {
  console.error(`✗ 找不到备份：${ZIP}`)
  process.exit(1)
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** 递归排序对象键，用于生成稳定的规范化 JSON */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]))
  }
  return value
}

/** 实体数组按 id 排序，保证顺序稳定 */
const byId = (rows) => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))

/** 去掉 undefined 的键；空数组保留（表示“确实没有”） */
function compact(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue
    out[k] = v
  }
  return out
}

/* ---------------- 敏感信息脱敏 ---------------- */

/**
 * 公开站点默认会展示人物介绍、记录正文等作者手写文本。
 * 真实数据里可能混入身份证号、手机号，这里统一遮蔽，并在私有报告里记录条数与字段，
 * 报告不保存原文。哈希、ID、URL 等结构字段不参与脱敏，避免破坏引用与校验。
 */
const REDACTION_PATTERNS = [
  { name: 'cn-id-18', label: '[身份证号已隐藏]', re: /(?<!\d)\d{17}[\dXx](?!\d)/g },
  { name: 'cn-mobile', label: '[手机号已隐藏]', re: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
]
const SKIP_KEYS = new Set(['id', 'key', 'url', 'hash', 'contentHash', 'publishId', 'publishedAt', 'mime', 'size', 'formatVersion', 'siteId'])
const redactions = []

function maskText(value, path) {
  let out = value
  for (const p of REDACTION_PATTERNS) {
    const hits = out.match(p.re)
    if (!hits) continue
    redactions.push({ field: path, pattern: p.name, count: hits.length })
    out = out.replace(p.re, p.label)
  }
  return out
}

function deepMask(node, path = '') {
  if (typeof node === 'string') {
    const leaf = path.split('.').pop() || ''
    if (SKIP_KEYS.has(leaf)) return node
    return maskText(node, path)
  }
  if (Array.isArray(node)) return node.map((v) => deepMask(v, path))
  if (node && typeof node === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(node)) out[k] = deepMask(v, path ? `${path}.${k}` : k)
    return out
  }
  return node
}

/** 字段映射台账：记录每个源字段的处理方式，未登记的字段会被标为 unmapped */const MAPPING = {
  person: {
    id: 'copy',
    name: 'displayName',
    nickname: 'copy',
    intro: 'copy',
    avatarPhotoId: 'copy',
    birthday: 'copy',
    calendarType: 'copy',
    zodiac: 'copy',
    meetDate: 'copy',
    tags: 'copy',
    anniversaries: 'split→anniversaries[]',
    isActive: 'exclude:internal',
    zodiacOverridden: 'exclude:internal',
    createdAt: 'exclude:internal',
    updatedAt: 'exclude:internal',
  },
  entry: {
    id: 'copy',
    personId: 'copy',
    occurredAt: 'copy',
    type: 'kind',
    title: 'copy',
    content: 'copy',
    taSaid: 'copy',
    myObservation: 'copy',
    mood: 'copy',
    moodCustom: 'copy',
    moodLevel: 'copy',
    tagList: 'tags',
    photoIds: 'copy',
    quick: 'copy',
    followUp: 'exclude:private-intent',
    followUpDone: 'exclude:private-intent',
    createdAt: 'exclude:internal',
    updatedAt: 'exclude:internal',
  },
  photo: {
    id: 'copy',
    personId: 'copy',
    mime: 'copy',
    size: 'copy',
    takenAt: 'copy',
    caption: 'copy',
    tags: 'copy',
    entryId: 'copy',
    giftId: 'copy',
    file: 'media.full',
    thumbFile: 'media.thumb',
    keepOriginal: 'exclude:internal',
    createdAt: 'exclude:internal',
  },
  preference: {
    id: 'copy',
    personId: 'copy',
    category: 'copy',
    name: 'copy',
    direction: 'copy',
    likeLevel: 'copy',
    note: 'copy',
    tags: 'copy',
    lastConfirmedAt: 'copy',
    evidenceEntryIds: 'copy',
    createdAt: 'exclude:internal',
    updatedAt: 'exclude:internal',
  },
  wish: {
    id: 'copy',
    personId: 'copy',
    content: 'copy',
    raisedAt: 'copy',
    status: 'copy',
    priority: 'copy',
    occasion: 'copy',
    note: 'copy',
    giftId: 'copy',
    entryIds: 'copy',
    createdAt: 'exclude:internal',
    updatedAt: 'exclude:internal',
  },
  gift: {
    id: 'copy',
    personId: 'copy',
    name: 'copy',
    givenAt: 'copy',
    occasion: 'copy',
    feedback: 'copy',
    note: 'copy',
    photoIds: 'copy',
    wishId: 'copy',
    entryId: 'copy',
    amount: 'exclude:private-financial',
    createdAt: 'exclude:internal',
    updatedAt: 'exclude:internal',
  },
  health: {
    id: 'copy',
    personId: 'copy',
    occurredAt: 'copy',
    symptom: 'copy',
    severity: 'copy',
    note: 'copy',
    status: 'copy',
    recovery: 'copy',
    resolvedAt: 'copy',
    medication: 'exclude:private-medical',
    entryIds: 'exclude:not-in-public-contract',
    createdAt: 'exclude:internal',
    updatedAt: 'exclude:internal',
  },
  insight: {
    id: 'copy',
    personId: 'copy',
    dimension: 'copy',
    description: 'copy',
    evidenceType: 'copy',
    evidenceEntryIds: 'copy',
    confirmState: 'copy',
    userEdited: 'exclude:internal',
    createdAt: 'exclude:internal',
    updatedAt: 'exclude:internal',
  },
  summary: {
    id: 'copy',
    personId: 'copy',
    kind: 'copy',
    title: 'copy',
    rangeStart: 'copy',
    rangeEnd: 'copy',
    content: 'copy',
    generator: 'copy',
    evidenceEntryIds: 'copy',
    aiMeta: 'exclude:ai-credentials-and-query',
    createdAt: 'exclude:internal',
    updatedAt: 'exclude:internal',
  },
  dailyStatus: {
    id: 'copy',
    personId: 'copy',
    date: 'copy',
    mood: 'copy',
    moodLevel: 'copy',
    energy: 'copy',
    sleepHours: 'copy',
    goodThing: 'copy',
    worry: 'copy',
    note: 'copy',
    moodCustom: 'exclude:not-in-public-contract',
    needAttention: 'exclude:private-intent',
    createdAt: 'exclude:internal',
    updatedAt: 'exclude:internal',
  },
  anniversary: {
    id: 'copy',
    name: 'copy',
    date: 'copy',
    calendarType: 'copy',
    repeatYearly: 'copy',
    note: 'copy',
  },
}

/** 记录源数据中出现但映射台账未登记的字段 */
const unmapped = new Map()
function audit(entity, row) {
  const table = MAPPING[entity] || {}
  for (const field of Object.keys(row)) {
    if (table[field]) continue
    const key = `${entity}.${field}`
    unmapped.set(key, (unmapped.get(key) || 0) + 1)
  }
}

const zip = await JSZip.loadAsync(readFileSync(ZIP))
const dataRaw = await zip.file('data.json').async('nodebuffer')
const data = JSON.parse(dataRaw.toString('utf8'))

const tables = {
  persons: data.persons || [],
  preferences: data.preferences || [],
  entries: data.entries || [],
  dailyStatus: data.dailyStatus || [],
  health: data.health || [],
  gifts: data.gifts || [],
  wishes: data.wishes || [],
  photos: data.photos || [],
  insights: data.insights || [],
  summaries: data.summaries || [],
  meta: data.meta || [],
}

for (const row of tables.persons) audit('person', row)
for (const row of tables.preferences) audit('preference', row)
for (const row of tables.entries) audit('entry', row)
for (const row of tables.dailyStatus) audit('dailyStatus', row)
for (const row of tables.health) audit('health', row)
for (const row of tables.gifts) audit('gift', row)
for (const row of tables.wishes) audit('wish', row)
for (const row of tables.photos) audit('photo', row)
for (const row of tables.insights) audit('insight', row)
for (const row of tables.summaries) audit('summary', row)

const person = tables.persons[0]
if (!person) {
  console.error('✗ 备份里没有人物，无法生成展示快照')
  process.exit(1)
}

/* ---------------- 组装公开快照 ---------------- */

const anniversaries = byId(
  (person.anniversaries || []).map((a) => {
    audit('anniversary', a)
    return compact({
      id: a.id,
      name: a.name,
      date: a.date,
      calendarType: a.calendarType,
      repeatYearly: a.repeatYearly,
      note: a.note,
    })
  }),
)

const publicPerson = compact({
  id: person.id,
  displayName: person.name,
  nickname: person.nickname,
  intro: person.intro,
  avatarPhotoId: person.avatarPhotoId,
  birthday: person.birthday,
  calendarType: person.calendarType || 'solar',
  zodiac: person.zodiac,
  meetDate: person.meetDate,
  tags: person.tags || [],
})

const entries = byId(
  tables.entries.map((e) =>
    compact({
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
      tags: e.tagList || [],
      photoIds: e.photoIds || [],
      quick: !!e.quick,
    }),
  ),
)

const photos = byId(
  tables.photos.map((p) =>
    compact({
      id: p.id,
      personId: p.personId,
      mime: p.mime,
      size: p.size,
      takenAt: p.takenAt,
      caption: p.caption,
      tags: p.tags || [],
      entryId: p.entryId,
      giftId: p.giftId,
      media: {
        thumb: { key: `media/${p.thumbFile}`, url: `media/${p.thumbFile}`, mime: 'image/jpeg', size: 0 },
        full: { key: `media/${p.file}`, url: `media/${p.file}`, mime: p.mime || 'image/jpeg', size: p.size || 0 },
      },
    }),
  ),
)

const preferences = byId(
  tables.preferences.map((r) =>
    compact({
      id: r.id,
      category: r.category,
      name: r.name,
      direction: r.direction,
      likeLevel: r.likeLevel,
      note: r.note,
      tags: r.tags || [],
      lastConfirmedAt: r.lastConfirmedAt,
      evidenceEntryIds: r.evidenceEntryIds || [],
    }),
  ),
)

const wishes = byId(
  tables.wishes.map((r) =>
    compact({
      id: r.id,
      content: r.content,
      raisedAt: r.raisedAt,
      status: r.status,
      priority: r.priority,
      occasion: r.occasion,
      note: r.note,
      giftId: r.giftId,
      entryIds: r.entryIds || [],
    }),
  ),
)

const gifts = byId(
  tables.gifts.map((r) =>
    compact({
      id: r.id,
      name: r.name,
      givenAt: r.givenAt,
      occasion: r.occasion,
      feedback: r.feedback,
      note: r.note,
      photoIds: r.photoIds || [],
      wishId: r.wishId,
      entryId: r.entryId,
    }),
  ),
)

const health = byId(
  tables.health.map((r) =>
    compact({
      id: r.id,
      occurredAt: r.occurredAt,
      symptom: r.symptom,
      severity: r.severity,
      note: r.note,
      status: r.status,
      recovery: r.recovery,
      resolvedAt: r.resolvedAt,
    }),
  ),
)

const insights = byId(
  tables.insights.map((r) =>
    compact({
      id: r.id,
      dimension: r.dimension,
      description: r.description,
      evidenceType: r.evidenceType,
      evidenceEntryIds: r.evidenceEntryIds || [],
      confirmState: r.confirmState,
    }),
  ),
)

const summaries = byId(
  tables.summaries.map((r) =>
    compact({
      id: r.id,
      kind: r.kind,
      title: r.title,
      rangeStart: r.rangeStart,
      rangeEnd: r.rangeEnd,
      content: r.content,
      generator: r.generator,
      evidenceEntryIds: r.evidenceEntryIds || [],
    }),
  ),
)

const statuses = byId(
  tables.dailyStatus.map((r) =>
    compact({
      id: r.id,
      date: r.date,
      mood: r.mood,
      moodLevel: r.moodLevel,
      energy: r.energy,
      sleepHours: r.sleepHours,
      goodThing: r.goodThing,
      worry: r.worry,
      note: r.note,
    }),
  ),
)

/**
 * 展示配置：逐字段白名单。
 * 既有备份里没有寄语、封面、主题这些展示设置，因此只能给兼容默认值，
 * 并在报告里标为「需作者补填」，不从 meta 猜。
 */
const config = {
  centerPersonId: person.id,
  tagline: '',
  coverPhotoId: undefined,
  theme: 'warm-light',
  sections: { photos: true, stories: true, archive: true, wishes: true, health: true, music: false },
}

/* ---------------- 媒体落盘 ---------------- */

const mediaDir = join(OUT, 'media')
const privDir = join(OUT, '_private')
if (existsSync(mediaDir)) rmSync(mediaDir, { recursive: true, force: true })
mkdirSync(mediaDir, { recursive: true })
mkdirSync(privDir, { recursive: true })

const mediaIndex = []
const mappedById = new Map(photos.map((p) => [p.id, p]))
for (const p of tables.photos) {
  const mapped = mappedById.get(p.id)
  for (const [kind, name] of [
    ['full', p.file],
    ['thumb', p.thumbFile],
  ]) {
    if (!name) continue
    const entry = zip.file(`photos/${name}`)
    if (!entry) {
      console.error(`✗ 缺少媒体文件 photos/${name}`)
      process.exit(1)
    }
    const buf = await entry.async('nodebuffer')
    writeFileSync(join(mediaDir, name), buf)
    const hash = sha256(buf)
    mediaIndex.push({ photoId: p.id, kind, file: name, bytes: buf.length, sha256: hash })

    // 回填真实字节数与哈希，展示端与发布服务可用于校验
    if (mapped) {
      mapped.media[kind].size = buf.length
      mapped.media[kind].hash = hash
    }
  }
}

/* ---------------- 规范化与哈希 ---------------- */

const content = canonical(
  deepMask({
    config,
    person: publicPerson,
    anniversaries,
    entries,
    photos,
    preferences,
    wishes,
    gifts,
    health,
    insights,
    summaries,
    statuses,
  }),
)

const contentHash = sha256(JSON.stringify(content))
const zipMtime = statSync(ZIP).mtime.toISOString()
const publishedAt = arg('published-at', zipMtime)
const publishId = `pub_${contentHash.slice(0, 12)}`

const counts = {
  persons: 1,
  anniversaries: anniversaries.length,
  entries: entries.length,
  photos: photos.length,
  preferences: preferences.length,
  wishes: wishes.length,
  gifts: gifts.length,
  health: health.length,
  insights: insights.length,
  summaries: summaries.length,
  statuses: statuses.length,
}

const snapshot = {
  manifest: {
    formatVersion: 1,
    siteId: SITE_ID,
    publishId,
    publishedAt,
    counts,
    contentHash,
  },
  ...content,
}

/* ---------------- 秘密与完整性检查 ---------------- */

const serialized = JSON.stringify(snapshot)
const forbidden = ['apiKey', 'proxyUrl', 'cloudModel', 'publishToken', 'secret']
const leaks = forbidden.filter((k) => serialized.includes(k))
if (leaks.length) {
  console.error(`✗ 公开快照中出现疑似私有字段：${leaks.join(', ')}`)
  process.exit(1)
}

// meta 整体隔离：只记录键名，且验证其值未出现在输出中
const metaKeys = tables.meta.map((r) => r.key)
for (const row of tables.meta) {
  const raw = JSON.stringify(row.value ?? '')
  const secret = raw.match(/"apiKey"\s*:\s*"([^"]{8,})"/)
  if (secret && serialized.includes(secret[1])) {
    console.error(`✗ meta「${row.key}」中的密钥出现在公开快照里`)
    process.exit(1)
  }
}
if (serialized.includes('"meta"')) {
  console.error('✗ 公开快照包含 meta 节点')
  process.exit(1)
}

// 引用完整性：照片与记录、头像、愿望与礼物
const photoIds = new Set(photos.map((p) => p.id))
const entryIds = new Set(entries.map((e) => e.id))
const dangling = []
for (const e of entries) for (const id of e.photoIds) if (!photoIds.has(id)) dangling.push(`entry ${e.id} → photo ${id}`)
for (const p of photos) if (p.entryId && !entryIds.has(p.entryId)) dangling.push(`photo ${p.id} → entry ${p.entryId}`)
if (publicPerson.avatarPhotoId && !photoIds.has(publicPerson.avatarPhotoId))
  dangling.push(`person → avatar ${publicPerson.avatarPhotoId}`)
for (const g of gifts) for (const id of g.photoIds) if (!photoIds.has(id)) dangling.push(`gift ${g.id} → photo ${id}`)
for (const pr of preferences) for (const id of pr.evidenceEntryIds) if (!entryIds.has(id)) dangling.push(`preference ${pr.id} → entry ${id}`)
for (const w of wishes) for (const id of w.entryIds) if (!entryIds.has(id)) dangling.push(`wish ${w.id} → entry ${id}`)

/* ---------------- 写出 ---------------- */

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'public-snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`)

const report = {
  generatedAt: new Date().toISOString(),
  source: { zip: ZIP, zipMtime, zipBytes: statSync(ZIP).size, dataSha256: sha256(dataRaw) },
  publishId,
  contentHash,
  counts,
  meta: { rows: metaKeys.length, keys: metaKeys, policy: '整体排除，不复制任何值' },
  media: { files: mediaIndex.length, bytes: mediaIndex.reduce((n, m) => n + m.bytes, 0) },
  unmapped: [...unmapped.entries()].map(([field, rows]) => ({ field, rows, policy: '见 MAPPING 台账' })),
  redactions: {
    total: redactions.reduce((n, r) => n + r.count, 0),
    items: redactions,
    policy: '身份证号与手机号在公开快照中遮蔽；原文只存在于私有原始备份',
  },
  mapping: MAPPING,
  danglingReferences: dangling,
  configDefaults: {
    tagline: '备份中没有展示寄语，需作者补填',
    coverPhotoId: '备份中没有封面设置，缺失时用头像',
    sections: config.sections,
  },
}
writeFileSync(join(privDir, 'mapping-report.json'), `${JSON.stringify(report, null, 2)}\n`)
writeFileSync(join(privDir, 'media-index.json'), `${JSON.stringify(mediaIndex, null, 2)}\n`)

console.log(`✓ 公开快照已生成：${join(OUT, 'public-snapshot.json')}`)
console.log(`  发布 ID   ${publishId}`)
console.log(`  内容哈希  ${contentHash}`)
console.log(`  记录数    ${entries.length} 条记录 / ${photos.length} 张照片 / ${anniversaries.length} 个纪念日 / ${preferences.length} 条偏好 / ${wishes.length} 个心愿 / ${health.length} 条健康`)
console.log(`  媒体      ${mediaIndex.length} 份（${(report.media.bytes / 1024 / 1024).toFixed(1)} MB）`)
console.log(`  meta      ${metaKeys.length} 行已整体排除（键名：${metaKeys.join(', ')}）`)
console.log(`  未映射字段 ${unmapped.size} 项${unmapped.size ? '：' + [...unmapped.keys()].join(', ') : ''}`)
console.log(`  脱敏      ${redactions.reduce((n, r) => n + r.count, 0)} 处${redactions.length ? '（' + [...new Set(redactions.map((r) => r.field))].join(', ') + '）' : ''}`)
console.log(`  悬空引用  ${dangling.length} 项`)
console.log(`  产物文件  ${readdirSync(OUT).join(', ')}`)

if (dangling.length) process.exitCode = 2
