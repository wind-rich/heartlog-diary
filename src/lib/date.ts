import { HolidayUtil, Lunar, Solar } from 'lunar-javascript'
import type { CalendarType } from '../db/types'

/* ------------------------------------------------------------------ */
/* 基础格式化                                                          */
/* ------------------------------------------------------------------ */

export const WEEK_CN = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
export const WEEK_SHORT = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** yyyy-MM-dd（本地时区） */
export function toDateStr(d: Date | string): string {
  const date = typeof d === 'string' ? parseAny(d) : d
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 本地 datetime-local 输入值 yyyy-MM-ddTHH:mm */
export function toLocalInput(d: Date | string): string {
  const date = typeof d === 'string' ? parseAny(d) : d
  return `${toDateStr(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** 解析任意时间字符串（兼容 Safari） */
export function parseAny(s: string): Date {
  if (!s) return new Date()
  // 纯日期
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d
  return new Date()
}

/** datetime-local 值 -> ISO */
export function fromLocalInput(v: string): string {
  if (!v) return new Date().toISOString()
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return new Date().toISOString()
  return d.toISOString()
}

export function fmtDate(d: Date | string, withWeek = false): string {
  const date = typeof d === 'string' ? parseAny(d) : d
  const base = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
  return withWeek ? `${base} ${WEEK_CN[date.getDay()]}` : base
}

export function fmtDateShort(d: Date | string): string {
  const date = typeof d === 'string' ? parseAny(d) : d
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

export function fmtTime(d: Date | string): string {
  const date = typeof d === 'string' ? parseAny(d) : d
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

export function fmtDateTime(d: Date | string): string {
  return `${fmtDate(d)} ${fmtTime(d)}`
}

/** 相对日期：今天 / 昨天 / 前天 / N 天前 / 具体日期 */
export function relativeDay(d: Date | string): string {
  const date = typeof d === 'string' ? parseAny(d) : d
  const a = startOfDay(date).getTime()
  const b = startOfDay(new Date()).getTime()
  const diff = Math.round((b - a) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  if (diff === 2) return '前天'
  if (diff === -1) return '明天'
  if (diff > 2 && diff < 30) return `${diff} 天前`
  if (diff < -1 && diff > -30) return `${-diff} 天后`
  return fmtDateShort(date)
}

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function endOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function addMonths(d: Date, n: number): Date {
  const x = new Date(d)
  const day = x.getDate()
  x.setDate(1)
  x.setMonth(x.getMonth() + n)
  const lastDay = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()
  x.setDate(Math.min(day, lastDay))
  return x
}

/** 周一为一周起点 */
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d)
  const wd = (x.getDay() + 6) % 7
  return addDays(x, -wd)
}

export function endOfWeek(d: Date): Date {
  return endOfDay(addDays(startOfWeek(d), 6))
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function endOfMonth(d: Date): Date {
  return endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86400000)
}

/** 从某日起到今天过了多少天（含当天按 +1 习惯） */
export function daysSince(d: Date | string): number {
  const date = typeof d === 'string' ? parseAny(d) : d
  return daysBetween(date, new Date()) + 1
}

/** 两个日期之间的所有日期（含首尾） */
export function eachDay(start: Date, end: Date): Date[] {
  const out: Date[] = []
  let cur = startOfDay(start)
  const last = startOfDay(end)
  let guard = 0
  while (cur.getTime() <= last.getTime() && guard < 4000) {
    out.push(new Date(cur))
    cur = addDays(cur, 1)
    guard++
  }
  return out
}

export function weekRangeLabel(start: Date, end: Date): string {
  return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`
}

export function monthRangeLabel(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月`
}

/* ------------------------------------------------------------------ */
/* 公历 / 农历 / 星座 / 节日                                            */
/* ------------------------------------------------------------------ */

const ZODIAC: { name: string; from: [number, number] }[] = [
  { name: '摩羯座', from: [12, 22] },
  { name: '水瓶座', from: [1, 20] },
  { name: '双鱼座', from: [2, 19] },
  { name: '白羊座', from: [3, 21] },
  { name: '金牛座', from: [4, 20] },
  { name: '双子座', from: [5, 21] },
  { name: '巨蟹座', from: [6, 22] },
  { name: '狮子座', from: [7, 23] },
  { name: '处女座', from: [8, 23] },
  { name: '天秤座', from: [9, 23] },
  { name: '天蝎座', from: [10, 24] },
  { name: '射手座', from: [11, 23] },
]

/** 根据公历生日计算星座 */
export function zodiacOf(month: number, day: number): string {
  const sorted = [...ZODIAC].sort((a, b) => a.from[0] - b.from[0])
  let result = '摩羯座'
  for (const z of sorted) {
    const [m, d] = z.from
    if (month > m || (month === m && day >= d)) result = z.name
  }
  return result
}

export interface LunarInfo {
  lunarDateStr: string
  monthInChinese: string
  dayInChinese: string
  ganzhi: string
  zodiacAnimal: string
  jieQi: string
  festivals: string[]
}

/**
 * 公历日期 -> 农历信息。
 * 农历/节气数据为本地内置算法，不依赖任何网络接口；
 * 即使外部节日接口不可用，生日、纪念日与农历展示依然正常。
 */
export function lunarInfoOf(d: Date | string): LunarInfo {
  const date = typeof d === 'string' ? parseAny(d) : d
  const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate())
  const lunar = solar.getLunar()
  const jieQiRaw = lunar.getJieQi() || ''
  return {
    lunarDateStr: `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
    monthInChinese: lunar.getMonthInChinese(),
    dayInChinese: lunar.getDayInChinese(),
    ganzhi: `${lunar.getYearInGanZhi()}年`,
    zodiacAnimal: lunar.getYearShengXiao(),
    jieQi: jieQiRaw,
    festivals: dedupe([...(solar.getFestivals() || []), ...(lunar.getFestivals() || [])]),
  }
}

function dedupe(list: string[]): string[] {
  return Array.from(new Set(list.filter(Boolean)))
}

/** 节日信息（公历 + 农历 + 节气 + 法定节假日，全部本地计算，断网可用） */
export function festivalsOf(d: Date | string): string[] {
  const date = typeof d === 'string' ? parseAny(d) : d
  const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate())
  const lunar = solar.getLunar()
  const list = dedupe([
    ...(solar.getFestivals() || []),
    ...(solar.getOtherFestivals() || []),
    ...(lunar.getFestivals() || []),
    ...(lunar.getOtherFestivals() || []),
  ])
  const jq = lunar.getJieQi()
  if (jq) list.push(jq)
  try {
    const holiday = HolidayUtil.getHoliday(date.getFullYear(), date.getMonth() + 1, date.getDate())
    if (holiday) list.push(`${holiday.getName()}${holiday.isWork() ? '(调休上班)' : '假期'}`)
  } catch {
    // 法定节假日数据超出内置年份范围时静默忽略，不影响其余功能
  }
  return dedupe(list)
}

/** 农历 (年, 月, 日) -> 公历 Date；month 为负表示闰月 */
export function lunarToSolar(year: number, month: number, day: number): Date | null {
  try {
    const lunar = Lunar.fromYmd(year, month, day)
    const solar = lunar.getSolar()
    return new Date(solar.getYear(), solar.getMonth() - 1, solar.getDay())
  } catch {
    return null
  }
}

/**
 * 把「生日/纪念日」换算成下一次（或指定年份）的公历日期。
 * - 公历：直接取该年 mm-dd，2/29 在非闰年回落到 2/28。
 * - 农历：把存下来的 mm-dd 当作农历月日，在目标公历年份内寻找对应日期。
 */
export function occurrenceInYear(storedDate: string, calendarType: CalendarType, year: number): Date | null {
  const [, mm, dd] = storedDate.split('-').map(Number)
  if (!mm || !dd) return null
  if (calendarType === 'solar') {
    const d = new Date(year, mm - 1, dd)
    if (d.getMonth() !== mm - 1) return new Date(year, mm - 1, 28) // 2/29 -> 2/28
    return d
  }
  // 农历：在目标公历年内试 13 个月（含闰月用负月份），命中农历月日即为当年生日
  for (const m of lunarMonthCandidates(year, mm)) {
    const solar = lunarToSolar(year, m, dd)
    if (solar && solar.getFullYear() === year) return solar
  }
  // 兜底：跨年到下一年
  for (const m of lunarMonthCandidates(year + 1, mm)) {
    const solar = lunarToSolar(year + 1, m, dd)
    if (solar) return solar
  }
  return null
}

function lunarMonthCandidates(year: number, month: number): number[] {
  const lunarYear = Lunar.fromYmd(year, 1, 1)
  const table = lunarYear.getJieQiTable()
  // lunar-javascript 闰月以负月份表示；这里先试正月份，再试闰月
  const candidates = [month, -month]
  void table
  return candidates
}

export interface UpcomingItem {
  key: string
  name: string
  /** 目标公历日期 */
  date: Date
  /** 距今天数，0 表示今天 */
  daysLeft: number
  /** 原始存储值 */
  storedDate: string
  calendarType: CalendarType
  /** 农历显示 */
  lunarText: string
  /** 是第几年 */
  yearsCount?: number
  kind: 'birthday' | 'anniversary' | 'meet'
}

/** 计算下次发生日期（今天含在内） */
export function nextOccurrence(
  storedDate: string,
  calendarType: CalendarType,
  from: Date = new Date(),
): { date: Date; daysLeft: number } | null {
  if (!storedDate) return null
  const base = startOfDay(from)
  for (const y of [base.getFullYear(), base.getFullYear() + 1]) {
    const d = occurrenceInYear(storedDate, calendarType, y)
    if (!d) continue
    const target = startOfDay(d)
    if (target.getTime() >= base.getTime()) {
      return { date: target, daysLeft: daysBetween(base, target) }
    }
  }
  return null
}

/** 已过去的年数（用于「在一起第 N 年」） */
export function yearsSince(storedDate: string, calendarType: CalendarType): number | undefined {
  if (!storedDate) return undefined
  const [y] = storedDate.split('-').map(Number)
  if (!y || y < 1900) return undefined
  const now = new Date()
  return now.getFullYear() - y
}
