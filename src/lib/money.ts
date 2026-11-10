export const kopecksToRubles = (k: number): number => k / 100

/**
 * Parses a user-entered ruble amount without floating-point rounding.
 * Accepts a decimal with at most two fractional digits; negative values are
 * allowed only when explicitly requested (e.g. an account's opening balance).
 * Returns null for malformed, non-finite, or unsafe values.
 */
export const parseRublesToKopecks = (
  value: string,
  options: { allowNegative?: boolean } = {},
): number | null => {
  let normalized = value.trim().replace(',', '.')
  let sign = 1
  if (normalized.startsWith('-')) {
    if (!options.allowNegative) return null
    sign = -1
    normalized = normalized.slice(1)
  }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized)
  if (!match) return null

  const rubles = Number(match[1])
  const kopecks = Number((match[2] ?? '').padEnd(2, '0') || '0')
  if (!Number.isSafeInteger(rubles)) return null

  const total = sign * (rubles * 100 + kopecks)
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
