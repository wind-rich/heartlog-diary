/**
 * lunar-javascript 未随包提供类型声明，这里按实际用到的 API 手工补一份。
 * 只声明本项目使用到的成员，避免 any 扩散。
 */
declare module 'lunar-javascript' {
  export class Solar {
    static fromDate(date: Date): Solar
    static fromYmd(year: number, month: number, day: number): Solar
    getYear(): number
    getMonth(): number
    getDay(): number
    getWeek(): number
    getWeekInChinese(): string
    getXingZuo(): string
    getFestivals(): string[]
    getOtherFestivals(): string[]
    getLunar(): Lunar
    toYmd(): string
    toYmdHms(): string
    subtract(days: number): Solar
  }

  export class Lunar {
    static fromDate(date: Date): Lunar
    static fromYmd(year: number, month: number, day: number): Lunar
    getYear(): number
    getMonth(): number
    getDay(): number
    getMonthInChinese(): string
    getDayInChinese(): string
    getFestivals(): string[]
    getOtherFestivals(): string[]
    getJieQi(): string
    getJieQiTable(): Record<string, Solar>
    getYearInGanZhi(): string
    getYearShengXiao(): string
    getSolar(): Solar
    toString(): string
  }

  export class Holiday {
    getName(): string
    isWork(): boolean
    getTarget(): string
  }

  export class HolidayUtil {
    static getHoliday(year: number, month: number, day: number): Holiday | null
    static getHolidays(year: number): Holiday[] | undefined
  }
}
