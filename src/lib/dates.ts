import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'

export const formatDate = (iso: string): string => {
  try {
    return format(parseISO(iso), 'd MMM yyyy', { locale: ru })
  } catch {
    return iso
  }
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
