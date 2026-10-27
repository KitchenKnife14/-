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

export const todayISO = (): string => new Date().toISOString().slice(0, 10)

export const firstDayOfMonth = (year: number, month: number): string =>
  new Date(year, month, 1).toISOString().slice(0, 10)

export const monthRange = (year: number, month: number): { start: string; end: string } => {
  const start = new Date(year, month, 1)
  const end = new Date(year, month + 1, 0)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}
