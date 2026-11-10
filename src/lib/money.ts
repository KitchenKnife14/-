export const kopecksToRubles = (k: number): number => k / 100

/**
 * Parses a user-entered ruble amount without floating-point rounding.
 * Accepts an unsigned decimal with at most two fractional digits.
 * Returns null for malformed, negative, non-finite, or unsafe values.
 */
export const parseRublesToKopecks = (value: string): number | null => {
  const normalized = value.trim().replace(',', '.')
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized)
  if (!match) return null

  const rubles = Number(match[1])
  const kopecks = Number((match[2] ?? '').padEnd(2, '0') || '0')
  if (!Number.isSafeInteger(rubles) || rubles < 0) return null

  const total = rubles * 100 + kopecks
  return Number.isSafeInteger(total) ? total : null
}

export const rublesToKopecks = (r: number): number => Math.round(r * 100)

export const formatRubles = (k: number): string => {
  const r = k / 100
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(r)
}

export const formatRublesShort = (k: number): string => {
  const r = k / 100
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(r) + ' ₽'
}

export const formatNumber = (r: number): string =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(r)
