export const kopecksToRubles = (k: number): number => k / 100

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
    maximumFractionDigits: 0,
  }).format(r) + ' ₽'
}

export const formatNumber = (r: number): string =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(r)
