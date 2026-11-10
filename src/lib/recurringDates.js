/**
 * Advances a date-only recurring schedule while preserving its original calendar anchor.
 * Mirrors backend nextDate_() for daily, weekly, custom, monthly and yearly schedules.
 */
export function advanceRecurringDate(isoDate, frequency, customIntervalDays, anchorIso = isoDate) {
  const parse = (value) => {
    if (typeof value !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return null
    const [year, month, day] = value.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day, 12))
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
    return { year, month: month - 1, day }
  }
  const current = parse(isoDate)
  const anchor = parse(anchorIso)
  if (!current || !anchor) return null
  let { year, month, day } = current
  if (frequency === 'daily' || frequency === 'weekly' || frequency === 'custom') {
    const increment = frequency === 'daily' ? 1 : frequency === 'weekly' ? 7 : Math.max(1, Number(customIntervalDays) || 30)
    return new Date(Date.UTC(year, month, day + increment, 12)).toISOString().slice(0, 10)
  }
  if (frequency === 'yearly') { year += 1; month = anchor.month; day = anchor.day }
  else if (frequency === 'monthly') { month += 1; if (month > 11) { month = 0; year += 1 }; day = anchor.day }
  else return null
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(day, lastDay), 12)).toISOString().slice(0, 10)
}
