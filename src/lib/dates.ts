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

const localDateISO = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const todayISO = (): string => localDateISO(new Date())

export const firstDayOfMonth = (year: number, month: number): string =>
  localDateISO(new Date(year, month, 1))

export const monthRange = (year: number, month: number): { start: string; end: string } => {
  const start = new Date(year, month, 1)
  const end = new Date(year, month + 1, 0)
  return { start: localDateISO(start), end: localDateISO(end) }
}
