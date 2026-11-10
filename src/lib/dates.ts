import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'

export const formatDate = (iso: string): string => {
  try {
    return format(parseISO(iso), 'd MMM yyyy', { locale: ru })
  } catch {
    return iso
  }
}

// Timestamp display is pinned to the app's Moscow timezone; date-only fields
// continue to use parseISO so their calendar day is not shifted by the device TZ.
export const formatDateInMoscow = (iso: string): string => {
  try {
    const parts = new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', year: 'numeric',
    }).formatToParts(new Date(iso))
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
    const day = part('day')
    const month = part('month')
    const year = part('year')
    if (!day || !month || !year) return iso
    return `${day} ${month} ${year}`
  } catch {
    return iso
  }
}

export const monthsUntilDate = (targetDate: string, fromDate: string = todayISO()): number | null => {
  const parseCalendarDate = (value: string): number | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
    const [year, month, day] = value.split('-').map(Number)
    const timestamp = Date.UTC(year, month - 1, day)
    const date = new Date(timestamp)
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
    return timestamp
  }
  const target = parseCalendarDate(targetDate)
  const from = parseCalendarDate(fromDate)
  if (target === null || from === null) return null
  return Math.max(1, Math.round((target - from) / (1000 * 60 * 60 * 24 * 30)))
}

export const formatDateShort = (iso: string): string => {
  try {
    return format(parseISO(iso), 'd MMM', { locale: ru })
  } catch {
    return iso
  }
}

export const formatDateLong = (iso: string): string => {
  try {
    return format(parseISO(iso), 'EEEEEE, d MMMM yyyy', { locale: ru })
  } catch {
    return iso
  }
}

export const monthKey = (iso: string): string => iso.slice(0, 7)

export const monthLabel = (year: number, month: number): string =>
  format(new Date(year, month, 1), 'LLLL yyyy', { locale: ru })

export const todayISO = (): string => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export const currentMoscowDate = (): Date => {
  const [year, month, day] = todayISO().split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

export const currentMoscowMonth = (): { year: number; month: number } => {
  const [year, month] = todayISO().split('-').map(Number)
  return { year, month: month - 1 }
}

export const firstDayOfMonth = (year: number, month: number): string =>
  `${year}-${String(month + 1).padStart(2, '0')}-01`

export const monthRange = (year: number, month: number): { start: string; end: string } => {
  const start = firstDayOfMonth(year, month)
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const end = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}
