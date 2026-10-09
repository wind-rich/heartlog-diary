import { db } from '../db/db'
import type {
  DailyStatus,
  Entry,
  Gift,
  HealthRecord,
  Person,
  Photo,
  PortraitInsight,
  Preference,
  Summary,
  Wish,
} from '../db/types'
import { EVIDENCE_TYPES, entryTypeMeta, HEALTH_STATUS, prefCategoryMeta, WISH_STATUS } from './constants'
import {
  addDays,
  daysBetween,
  eachDay,
  endOfDay,
  endOfMonth,
  fmtDate,
  fmtDateTime,
  fmtTime,
  lunarInfoOf,
  nextOccurrence,
  parseAny,
  startOfDay,
  startOfMonth,
  startOfWeek,
  endOfWeek,
  toDateStr,
  WEEK_CN,
  zodiacOf,
} from './date'
import { moodLabelOf } from './stats'

export interface AllData {
  person?: Person
  entries: Entry[]
  statuses: DailyStatus[]
  preferences: Preference[]
  wishes: Wish[]
  gifts: Gift[]
  health: HealthRecord[]
  photos: Photo[]
  insights: PortraitInsight[]
  summaries: Summary[]
}

export async function loadAllData(personId: string): Promise<AllData> {
  const [person, entries, statuses, preferences, wishes, gifts, health, photos, insights, summaries] = await Promise.all([
    db.persons.get(personId),
    db.entries.where('personId').equals(personId).toArray(),
    db.dailyStatus.where('personId').equals(personId).toArray(),
    db.preferences.where('personId').equals(personId).toArray(),
    db.wishes.where('personId').equals(personId).toArray(),
    db.gifts.where('personId').equals(personId).toArray(),
    db.health.where('personId').equals(personId).toArray(),
    db.photos.where('personId').equals(personId).toArray(),
    db.insights.where('personId').equals(personId).toArray(),
    db.summaries.where('personId').equals(personId).toArray(),
  ])
  return { person, entries, statuses, preferences, wishes, gifts, health, photos, insights, summaries }
}

/* ------------------------------------------------------------------ */
/* 导出选项                                                            */
/* ------------------------------------------------------------------ */

export interface ExportOptions {
  rangeStart: Date
  rangeEnd: Date
  modules: {
    profile: boolean
    entries: boolean
    statuses: boolean
    preferences: boolean
    wishes: boolean
    gifts: boolean
    health: boolean
    insights: boolean
    summaries: boolean
  }
  includePhotos: boolean
  /** 图片在 Markdown 中的引用前缀（ZIP 内为 images/） */
  imagePrefix: string
}

export const DEFAULT_EXPORT_MODULES: ExportOptions['modules'] = {
  profile: true,
  entries: true,
  statuses: true,
  preferences: true,
  wishes: true,
  gifts: true,
  health: false,
  insights: true,
  summaries: true,
}

/* ------------------------------------------------------------------ */
/* 数据切片（按时间范围过滤）                                           */
/* ------------------------------------------------------------------ */

export function sliceByRange(data: AllData, start: Date, end: Date): AllData {
  const s = startOfDay(start).getTime()
  const e = endOfDay(end).getTime()
  const inR = (iso?: string) => {
    if (!iso) return false
    const t = parseAny(iso).getTime()
    return t >= s && t <= e
  }
  return {
    person: data.person,
    entries: data.entries.filter((x) => inR(x.occurredAt)),
    statuses: data.statuses.filter((x) => inR(x.date)),
    preferences: data.preferences.filter((x) => inR(x.updatedAt) || (x.lastConfirmedAt ? inR(x.lastConfirmedAt) : false)),
    wishes: data.wishes.filter((x) => inR(x.raisedAt ?? x.createdAt)),
    gifts: data.gifts.filter((x) => inR(x.givenAt)),
    health: data.health.filter((x) => inR(x.occurredAt)),
    photos: data.photos.filter((x) => inR(x.takenAt ?? x.createdAt)),
    insights: data.insights,
    summaries: data.summaries.filter((x) => x.createdAt >= start.toISOString() && x.createdAt <= end.toISOString()),
  }
}

/* ------------------------------------------------------------------ */
/* Markdown 导出                                                       */
/* ------------------------------------------------------------------ */

export function buildMarkdown(data: AllData, opts: ExportOptions, imageMap?: Map<string, string>): string {
  const person = data.person
  const name = person?.nickname || person?.name || 'TA'
  const L: string[] = []
  const m = opts.modules

  L.push(`# ${name} · 心意簿导出`)
  L.push('')
  L.push(`- 导出时间：${fmtDateTime(new Date())}`)
  L.push(`- 数据范围：${fmtDate(opts.rangeStart)} 至 ${fmtDate(opts.rangeEnd)}`)
  L.push(`- 说明：本文件由「心意簿」生成，图片以相对路径引用。`)
  L.push('')
  L.push('---')
  L.push('')

  if (m.profile && person) {
    L.push('## 一、基础档案')
    L.push('')
    L.push('| 项目 | 内容 |')
    L.push('| --- | --- |')
    L.push(`| 姓名 | ${person.name || '—'} |`)
    L.push(`| 昵称 | ${person.nickname || '—'} |`)
    if (person.birthday) {
      const next = nextOccurrence(person.birthday, person.calendarType)
      const calText = person.calendarType === 'lunar' ? '农历' : '公历'
      const nextText = next ? `，下次 ${fmtDate(next.date)}（${next.daysLeft} 天后）` : ''
      L.push(`| 生日 | ${person.birthday}（${calText}）${nextText} |`)
    } else {
      L.push('| 生日 | — |')
    }
    L.push(`| 星座 | ${person.zodiac || '—'}${person.zodiacOverridden ? '（手动设定）' : ''} |`)
    L.push(`| 相识日 | ${person.meetDate || '—'} |`)
    if (person.meetDate) {
      const d = daysBetween(parseAny(person.meetDate), new Date()) + 1
      L.push(`| 已相识 | ${d} 天 |`)
    }
    L.push(`| 个人介绍 | ${(person.intro || '—').replace(/\n/g, ' ')} |`)
    if (person.anniversaries?.length) {
      L.push('')
      L.push('### 纪念日')
      L.push('')
      for (const a of person.anniversaries) {
        const next = nextOccurrence(a.date, a.calendarType)
        L.push(
          `- **${a.name}**：${a.date}（${a.calendarType === 'lunar' ? '农历' : '公历'}）${next ? ` · 下次 ${fmtDate(next.date)}（${next.daysLeft} 天后）` : ''}${a.note ? ` · ${a.note}` : ''}`,
        )
      }
    }
    L.push('')
  }

  if (m.preferences && data.preferences.length) {
    L.push('## 二、兴趣与偏好')
    L.push('')
    const groups = new Map<string, Preference[]>()
    for (const p of data.preferences) groups.set(p.category, [...(groups.get(p.category) ?? []), p])
    for (const [cat, list] of groups) {
      L.push(`### ${prefCategoryMeta(cat).emoji} ${prefCategoryMeta(cat).label}`)
      L.push('')
      for (const p of list) {
        const dir = p.direction === 'like' ? '喜欢' : p.direction === 'dislike' ? '不喜欢' : '想尝试'
        L.push(`- **${p.name}**（${dir}${p.likeLevel ? `，喜欢程度 ${p.likeLevel}/5` : ''}）`)
        if (p.note) L.push(`  - 备注：${p.note}`)
        if (p.lastConfirmedAt) L.push(`  - 最近确认：${p.lastConfirmedAt}`)
        if (p.evidenceEntryIds?.length) L.push(`  - 依据：${p.evidenceEntryIds.length} 条记录`)
      }
      L.push('')
    }
  }

  if (m.entries && data.entries.length) {
    L.push('## 三、生活时间线')
    L.push('')
    const sorted = [...data.entries].sort((a, b) => parseAny(b.occurredAt).getTime() - parseAny(a.occurredAt).getTime())
    let lastDate = ''
    for (const e of sorted) {
      const d = toDateStr(e.occurredAt)
      if (d !== lastDate) {
        L.push(`### ${fmtDate(e.occurredAt, true)}`)
        L.push('')
        lastDate = d
      }
      const meta = entryTypeMeta(e.type)
      L.push(`#### ${meta.emoji} ${e.title || '（无标题）'} · ${fmtTime(e.occurredAt)}`)
      L.push('')
      if (e.content) L.push(`- 具体经过：${e.content}`)
      if (e.taSaid) L.push(`- TA 说：${e.taSaid}`)
      if (e.myObservation) L.push(`- 我的观察：${e.myObservation}`)
      if (e.mood) L.push(`- 当天心情：${moodLabelOf(e.mood, e.moodCustom)}${e.moodLevel ? `（${e.moodLevel}/5）` : ''}`)
      if (e.tagList?.length) L.push(`- 标签：${e.tagList.join('、')}`)
      if (e.followUp) L.push(`- 后续：${e.followUp}${e.followUpDone ? ' ✅' : ''}`)
      L.push('')
      if (opts.includePhotos && e.photoIds?.length) {
        for (const pid of e.photoIds) {
          const rel = imageMap?.get(pid)
          if (rel) L.push(`![${e.title || '照片'}](${opts.imagePrefix}${rel})`)
        }
        L.push('')
      }
    }
  }

  if (m.statuses && data.statuses.length) {
    L.push('## 四、每日状态')
    L.push('')
    L.push('| 日期 | 心情 | 精力 | 睡眠 | 好事 | 烦心事 |')
    L.push('| --- | --- | --- | --- | --- | --- |')
    for (const s of [...data.statuses].sort((a, b) => (a.date < b.date ? 1 : -1))) {
      L.push(
        `| ${s.date} | ${s.mood ? moodLabelOf(s.mood, s.moodCustom) : '—'} | ${s.energy ? `${s.energy}/5` : '—'} | ${s.sleepHours ? `${s.sleepHours}h` : '—'} | ${(s.goodThing || '—').replace(/\|/g, '｜')} | ${(s.worry || '—').replace(/\|/g, '｜')} |`,
      )
    }
    L.push('')
  }

  if (m.wishes && data.wishes.length) {
    L.push('## 五、愿望清单')
    L.push('')
    for (const w of data.wishes) {
      const st = WISH_STATUS.find((x) => x.value === w.status)?.label ?? w.status
      L.push(`- [${w.status === 'fulfilled' || w.status === 'gifted' ? 'x' : ' '}] **${w.content}**（${st}）${w.occasion ? ` · 场合：${w.occasion}` : ''}${w.note ? ` · ${w.note}` : ''}`)
    }
    L.push('')
  }

  if (m.gifts && data.gifts.length) {
    L.push('## 六、礼物记录')
    L.push('')
    L.push('| 日期 | 礼物 | 场合 | 金额 | TA 的反应 |')
    L.push('| --- | --- | --- | --- | --- |')
    for (const g of [...data.gifts].sort((a, b) => (a.givenAt < b.givenAt ? 1 : -1))) {
      L.push(
        `| ${toDateStr(g.givenAt)} | ${g.name} | ${g.occasion || '—'} | ${g.amount ? `¥${g.amount}` : '—'} | ${(g.feedback || '—').replace(/\|/g, '｜')} |`,
      )
    }
    L.push('')
  }

  if (m.health && data.health.length) {
    L.push('## 七、健康记录')
    L.push('')
    for (const h of data.health) {
      const st = HEALTH_STATUS.find((x) => x.value === h.status)?.label ?? h.status
      L.push(`- ${fmtDate(h.occurredAt)} **${h.symptom}**（${st}${h.severity ? `，程度 ${h.severity}/5` : ''}）`)
      if (h.medication) L.push(`  - 就医/用药：${h.medication}`)
      if (h.note) L.push(`  - 备注：${h.note}`)
      if (h.recovery) L.push(`  - 恢复情况：${h.recovery}`)
    }
    L.push('')
    L.push('> 健康记录仅供本人回顾，不作为医学判断依据。')
    L.push('')
  }

  if (m.insights && data.insights.length) {
    L.push('## 八、个人画像')
    L.push('')
    const dims = new Map<string, PortraitInsight[]>()
    for (const i of data.insights) dims.set(i.dimension, [...(dims.get(i.dimension) ?? []), i])
    for (const [dim, list] of dims) {
      L.push(`### ${dim}`)
      L.push('')
      for (const i of list) {
        const ev = EVIDENCE_TYPES.find((x) => x.value === i.evidenceType)?.label ?? i.evidenceType
        L.push(`- ${i.description}`)
        L.push(`  - 依据类型：${ev}`)
        L.push(`  - 引用记录：${i.evidenceEntryIds?.length ?? 0} 条`)
        L.push(`  - 状态：${i.confirmState === 'confirmed' ? '已确认' : i.confirmState === 'rejected' ? '已否决' : '待确认'}`)
      }
      L.push('')
    }
  }

  if (m.summaries && data.summaries.length) {
    L.push('## 九、回顾报告')
    L.push('')
    for (const s of data.summaries) {
      L.push(`### ${s.title}（${s.generator === 'ai' ? 'AI 生成' : '手动'}）`)
      L.push('')
      L.push(s.content)
      L.push('')
    }
  }

  if (opts.includePhotos && data.photos.length) {
    L.push('## 十、照片索引')
    L.push('')
    for (const p of [...data.photos].sort((a, b) => ((a.takenAt ?? a.createdAt) < (b.takenAt ?? b.createdAt) ? 1 : -1))) {
      const rel = imageMap?.get(p.id)
      const when = fmtDateTime(p.takenAt ?? p.createdAt)
      if (rel) L.push(`- ${when} · ${p.caption || '照片'} → \`${opts.imagePrefix}${rel}\``)
      else L.push(`- ${when} · ${p.caption || '照片'}`)
    }
    L.push('')
  }

  return L.join('\n')
}

/* ------------------------------------------------------------------ */
/* 打印版 HTML（用于「预览 + 保存为 PDF」）                             */
/* ------------------------------------------------------------------ */

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface HtmlImage {
  id: string
  dataUrl: string
  caption?: string
}

export function buildPrintHtml(data: AllData, opts: ExportOptions, images: HtmlImage[], autoPrint = false): string {
  const person = data.person
  const name = person?.nickname || person?.name || 'TA'
  const m = opts.modules
  const imgById = new Map(images.map((i) => [i.id, i]))
  const blocks: string[] = []

  const section = (no: string, title: string, body: string) =>
    `<section class="sec"><h2>${no}　${esc(title)}</h2>${body}</section>`

  if (m.profile && person) {
    const rows: [string, string][] = [
      ['姓名', person.name || '—'],
      ['昵称', person.nickname || '—'],
      ['生日', person.birthday ? `${person.birthday}（${person.calendarType === 'lunar' ? '农历' : '公历'}）` : '—'],
      ['星座', `${person.zodiac || '—'}${person.zodiacOverridden ? '（手动设定）' : ''}`],
      ['相识日', person.meetDate ? `${person.meetDate}（已相识 ${daysBetween(parseAny(person.meetDate), new Date()) + 1} 天）` : '—'],
    ]
    let body = `<table class="kv">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`
    if (person.intro) body += `<p class="para">${esc(person.intro).replace(/\n/g, '<br/>')}</p>`
    if (person.anniversaries?.length) {
      body += `<ul class="list">${person.anniversaries
        .map((a) => {
          const next = nextOccurrence(a.date, a.calendarType)
          return `<li><b>${esc(a.name)}</b>：${esc(a.date)}（${a.calendarType === 'lunar' ? '农历' : '公历'}）${next ? `，下次 ${esc(fmtDate(next.date))}（${next.daysLeft} 天后）` : ''}${a.note ? `，${esc(a.note)}` : ''}</li>`
        })
        .join('')}</ul>`
    }
    blocks.push(section('一', '基础档案', body))
  }

  if (m.preferences && data.preferences.length) {
    const groups = new Map<string, Preference[]>()
    for (const p of data.preferences) groups.set(p.category, [...(groups.get(p.category) ?? []), p])
    let body = ''
    for (const [cat, list] of groups) {
      body += `<h3>${esc(prefCategoryMeta(cat).label)}</h3><ul class="list">`
      for (const p of list) {
        const dir = p.direction === 'like' ? '喜欢' : p.direction === 'dislike' ? '不喜欢' : '想尝试'
        body += `<li><b>${esc(p.name)}</b>（${dir}${p.likeLevel ? `，程度 ${p.likeLevel}/5` : ''}）${p.note ? ` — ${esc(p.note)}` : ''}${
          p.lastConfirmedAt ? `<span class="meta">最近确认 ${esc(p.lastConfirmedAt)}</span>` : ''
        }${p.evidenceEntryIds?.length ? `<span class="meta">依据 ${p.evidenceEntryIds.length} 条记录</span>` : ''}</li>`
      }
      body += '</ul>'
    }
    blocks.push(section('二', '兴趣与偏好', body))
  }

  if (m.entries && data.entries.length) {
    const sorted = [...data.entries].sort((a, b) => parseAny(b.occurredAt).getTime() - parseAny(a.occurredAt).getTime())
    let body = ''
    let lastDate = ''
    for (const e of sorted) {
      const d = toDateStr(e.occurredAt)
      if (d !== lastDate) {
        if (lastDate) body += '</div>'
        body += `<div class="daygroup"><div class="dayhead">${esc(fmtDate(e.occurredAt, true))}</div>`
        lastDate = d
      }
      const meta = entryTypeMeta(e.type)
      body += `<article class="card"><div class="cardtitle"><span class="badge" style="background:${meta.color}22;color:${meta.color}">${esc(meta.label)}</span> <b>${esc(e.title || '（无标题）')}</b> <span class="time">${esc(fmtTime(e.occurredAt))}</span></div>`
      if (e.content) body += `<p><span class="k">经过</span>${esc(e.content).replace(/\n/g, '<br/>')}</p>`
      if (e.taSaid) body += `<p><span class="k">TA 说</span>${esc(e.taSaid).replace(/\n/g, '<br/>')}</p>`
      if (e.myObservation) body += `<p><span class="k">我的观察</span>${esc(e.myObservation).replace(/\n/g, '<br/>')}</p>`
      if (e.mood) body += `<p><span class="k">心情</span>${esc(moodLabelOf(e.mood, e.moodCustom))}${e.moodLevel ? `（${e.moodLevel}/5）` : ''}</p>`
      if (e.tagList?.length) body += `<p><span class="k">标签</span>${e.tagList.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</p>`
      if (e.followUp) body += `<p><span class="k">后续</span>${esc(e.followUp)}${e.followUpDone ? ' ✅' : ''}</p>`
      if (opts.includePhotos && e.photoIds?.length) {
        const imgs = e.photoIds.map((id) => imgById.get(id)).filter(Boolean) as HtmlImage[]
        if (imgs.length) {
          body += `<div class="photorow">${imgs.map((i) => `<figure><img src="${i.dataUrl}" alt=""/><figcaption>${esc(i.caption || '')}</figcaption></figure>`).join('')}</div>`
        }
      }
      body += '</article>'
    }
    if (lastDate) body += '</div>'
    blocks.push(section('三', '生活时间线', body))
  }

  if (m.statuses && data.statuses.length) {
    const rows = [...data.statuses].sort((a, b) => (a.date < b.date ? 1 : -1))
    let body = `<table class="grid"><thead><tr><th>日期</th><th>心情</th><th>精力</th><th>睡眠</th><th>好事</th><th>烦心事</th><th>需关注</th></tr></thead><tbody>`
    for (const s of rows) {
      body += `<tr><td>${esc(s.date)}</td><td>${esc(s.mood ? moodLabelOf(s.mood, s.moodCustom) : '—')}</td><td>${s.energy ? `${s.energy}/5` : '—'}</td><td>${s.sleepHours ? `${s.sleepHours}h` : '—'}</td><td>${esc(s.goodThing || '—')}</td><td>${esc(s.worry || '—')}</td><td>${esc(s.needAttention || '—')}</td></tr>`
    }
    body += '</tbody></table>'
    blocks.push(section('四', '每日状态', body))
  }

  if (m.wishes && data.wishes.length) {
    const body = `<ul class="list">${data.wishes
      .map((w) => {
        const st = WISH_STATUS.find((x) => x.value === w.status)?.label ?? w.status
        return `<li><b>${esc(w.content)}</b>（${st}）${w.occasion ? ` · ${esc(w.occasion)}` : ''}${w.note ? ` — ${esc(w.note)}` : ''}</li>`
      })
      .join('')}</ul>`
    blocks.push(section('五', '愿望清单', body))
  }

  if (m.gifts && data.gifts.length) {
    let body = `<table class="grid"><thead><tr><th>日期</th><th>礼物</th><th>场合</th><th>金额</th><th>TA 的反应</th></tr></thead><tbody>`
    for (const g of [...data.gifts].sort((a, b) => (a.givenAt < b.givenAt ? 1 : -1))) {
      body += `<tr><td>${esc(toDateStr(g.givenAt))}</td><td>${esc(g.name)}</td><td>${esc(g.occasion || '—')}</td><td>${g.amount ? `¥${g.amount}` : '—'}</td><td>${esc(g.feedback || '—')}</td></tr>`
    }
    body += '</tbody></table>'
    if (opts.includePhotos) {
      const giftImgs = data.gifts.flatMap((g) => (g.photoIds ?? []).map((id) => imgById.get(id))).filter(Boolean) as HtmlImage[]
      if (giftImgs.length) {
        body += `<div class="photorow">${giftImgs.map((i) => `<figure><img src="${i.dataUrl}" alt=""/></figure>`).join('')}</div>`
      }
    }
    blocks.push(section('六', '礼物记录', body))
  }

  if (m.health && data.health.length) {
    const body = `<ul class="list">${data.health
      .map((h) => {
        const st = HEALTH_STATUS.find((x) => x.value === h.status)?.label ?? h.status
        return `<li>${esc(fmtDate(h.occurredAt))} <b>${esc(h.symptom)}</b>（${st}${h.severity ? `，程度 ${h.severity}/5` : ''}）${h.medication ? `<span class="meta">${esc(h.medication)}</span>` : ''}${h.recovery ? `<span class="meta">恢复：${esc(h.recovery)}</span>` : ''}</li>`
      })
      .join('')}</ul><p class="note">健康记录仅供本人回顾，不作为医学判断依据。</p>`
    blocks.push(section('七', '健康记录', body))
  }

  if (m.insights && data.insights.length) {
    const dims = new Map<string, PortraitInsight[]>()
    for (const i of data.insights) dims.set(i.dimension, [...(dims.get(i.dimension) ?? []), i])
    let body = ''
    for (const [dim, list] of dims) {
      body += `<h3>${esc(dim)}</h3><ul class="list">`
      for (const i of list) {
        const ev = EVIDENCE_TYPES.find((x) => x.value === i.evidenceType)?.label ?? i.evidenceType
        body += `<li>${esc(i.description)}<span class="meta">${esc(ev)} · 引用 ${i.evidenceEntryIds?.length ?? 0} 条记录 · ${
          i.confirmState === 'confirmed' ? '已确认' : i.confirmState === 'rejected' ? '已否决' : '待确认'
        }</span></li>`
      }
      body += '</ul>'
    }
    blocks.push(section('八', '个人画像', body))
  }

  if (m.summaries && data.summaries.length) {
    const body = data.summaries.map((s) => `<div class="summary"><h3>${esc(s.title)}（${s.generator === 'ai' ? 'AI 生成' : '手动'}）</h3><pre>${esc(s.content)}</pre></div>`).join('')
    blocks.push(section('九', '回顾报告', body))
  }

  if (opts.includePhotos && data.photos.length) {
    const grid = data.photos
      .map((p) => {
        const img = imgById.get(p.id)
        if (!img) return ''
        return `<figure class="albumfig"><img src="${img.dataUrl}" alt=""/><figcaption>${esc(fmtDateTime(p.takenAt ?? p.createdAt))}${p.caption ? ` · ${esc(p.caption)}` : ''}</figcaption></figure>`
      })
      .join('')
    blocks.push(section('十', '照片', `<div class="album">${grid}</div>`))
  }

  const cover = `<header class="cover"><div class="heart">♥</div><h1>${esc(name)}</h1><p class="sub">${esc(fmtDate(opts.rangeStart))} 至 ${esc(fmtDate(opts.rangeEnd))}</p><p class="sub2">心意簿 · 导出于 ${esc(fmtDateTime(new Date()))}</p></header>`

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<title>${esc(name)} · 心意簿</title>
<style>
  @page { size: A4; margin: 14mm 12mm 16mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
    color: #3B332E; line-height: 1.75; font-size: 12.5px; background: #FFFCF8;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page { max-width: 190mm; margin: 0 auto; padding: 16px 0; }
  .cover { text-align: center; padding: 40px 0 28px; border-bottom: 2px solid #F3D9C4; margin-bottom: 22px; break-after: page; }
  .cover .heart { font-size: 40px; color: #D9705F; line-height: 1; }
  .cover h1 { font-size: 26px; margin: 10px 0 6px; letter-spacing: 2px; }
  .cover .sub { color: #8A7D72; margin: 2px 0; font-size: 13px; }
  .cover .sub2 { color: #B9ADA2; margin: 12px 0 0; font-size: 11px; }
  .sec { margin-bottom: 26px; break-inside: auto; }
  .sec > h2 {
    font-size: 16px; margin: 0 0 12px; padding: 6px 0 8px; color: #3B332E;
    border-bottom: 1px solid #F3D9C4; break-after: avoid;
  }
  h3 { font-size: 13.5px; margin: 16px 0 8px; color: #5C5148; break-after: avoid; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; break-inside: auto; }
  table.kv th { width: 22%; text-align: left; background: #FFF6EE; }
  table th, table td { border: 1px solid #F0E2D4; padding: 6px 8px; vertical-align: top; word-break: break-word; }
  table.grid { font-size: 11.5px; }
  table.grid thead { display: table-header-group; }
  table.grid tr { break-inside: avoid; }
  .para { margin: 8px 0 12px; white-space: pre-wrap; }
  ul.list { margin: 6px 0 14px; padding-left: 20px; }
  ul.list > li { margin-bottom: 6px; break-inside: avoid; }
  .meta { display: inline-block; margin-left: 8px; color: #8A7D72; font-size: 11px; background: #FFF6EE; border-radius: 4px; padding: 0 6px; }
  .note { color: #8A7D72; font-size: 11px; }
  .daygroup { break-inside: auto; }
  .dayhead {
    font-weight: 600; color: #5C5148; margin: 16px 0 8px; padding-left: 10px;
    border-left: 3px solid #F2A7A0; break-after: avoid;
  }
  .card {
    border: 1px solid #F3E4D6; border-radius: 10px; background: #fff;
    padding: 10px 12px; margin-bottom: 10px; break-inside: avoid;
  }
  .cardtitle { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
  .cardtitle .time { color: #B9ADA2; font-size: 11px; margin-left: auto; }
  .badge { font-size: 10.5px; border-radius: 999px; padding: 1px 8px; }
  .card p { margin: 4px 0; break-inside: avoid; }
  .k { display: inline-block; min-width: 4.6em; color: #8A7D72; }
  .tag { display: inline-block; background: #FFF6EE; border: 1px solid #F3D9C4; border-radius: 999px; padding: 0 8px; margin-right: 4px; font-size: 11px; }
  .photorow { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .photorow figure { margin: 0; width: 118px; break-inside: avoid; }
  .photorow img { width: 100%; height: 88px; object-fit: cover; border-radius: 6px; border: 1px solid #F3E4D6; }
  .photorow figcaption { font-size: 10px; color: #8A7D72; text-align: center; }
  .album { display: flex; flex-wrap: wrap; gap: 10px; }
  .albumfig { margin: 0; width: 31%; break-inside: avoid; }
  .albumfig img { width: 100%; height: 110px; object-fit: cover; border-radius: 8px; border: 1px solid #F3E4D6; }
  .albumfig figcaption { font-size: 10px; color: #8A7D72; text-align: center; margin-top: 3px; }
  .summary pre {
    white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 12px;
    background: #FFFCF8; border: 1px solid #F3E4D6; border-radius: 8px; padding: 10px; break-inside: avoid;
  }
  .footer { text-align: center; color: #B9ADA2; font-size: 10.5px; margin-top: 28px; border-top: 1px solid #F3D9C4; padding-top: 10px; }
  @media print { .page { padding: 0; max-width: none; } }
</style></head>
<body><div class="page">${cover}${blocks.join('')}
<div class="footer">心意簿 · 仅保存在你自己设备上的记录</div>
</div>${
    autoPrint
      ? '<script>window.addEventListener("load", function(){ setTimeout(function(){ try { window.focus(); window.print(); } catch(e){} }, 500); });</script>'
      : ''
  }
</body></html>`
}

/* ------------------------------------------------------------------ */
/* 打印 / 预览                                                          */
/* ------------------------------------------------------------------ */

/** 打开新窗口展示可打印的 HTML（用户可选择「另存为 PDF」） */
export function openPrintWindow(html: string): Window | null {
  const w = window.open('', '_blank')
  if (!w) return null
  w.document.open()
  w.document.write(html)
  w.document.close()
  return w
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function downloadText(text: string, filename: string, mime = 'text/markdown;charset=utf-8'): void {
  downloadBlob(new Blob([text], { type: mime }), filename)
}

/* ------------------------------------------------------------------ */
/* 快捷时间范围                                                         */
/* ------------------------------------------------------------------ */

export function rangePresets(now = new Date()) {
  return {
    today: { start: startOfDay(now), end: endOfDay(now), label: '今天' },
    thisWeek: { start: startOfWeek(now), end: endOfWeek(now), label: '本周' },
    lastWeek: { start: addDays(startOfWeek(now), -7), end: addDays(endOfWeek(now), -7), label: '上周' },
    thisMonth: { start: startOfMonth(now), end: endOfMonth(now), label: '本月' },
    lastMonth: { start: startOfMonth(addDays(startOfMonth(now), -1)), end: endOfMonth(addDays(startOfMonth(now), -1)), label: '上月' },
    thisYear: { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear(), 11, 31, 23, 59, 59), label: '今年' },
  }
}

export { eachDay, addDays, daysBetween, toDateStr, fmtDate, WEEK_CN, zodiacOf }
