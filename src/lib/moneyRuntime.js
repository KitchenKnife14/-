export const kopecksToRubles = (kopecks) => kopecks / 100;

/**
 * Convert a user-entered RUB decimal string into exact integer kopecks.
 * No floating-point rounding is performed. Comma and dot separators are accepted.
 * Values with more than two decimal places or outside the safe-integer range are rejected.
 */
export function parseRublesToKopecks(value, allowNegative = false) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (!normalized) return null;

  const match = normalized.match(/^([+-]?)(?:(\d+)(?:\.(\d{1,2}))?|\.(\d{1,2}))$/);
  if (!match) return null;

  const negative = match[1] === '-';
  if (negative && !allowNegative) return null;

  const whole = Number(match[2] || '0');
  if (!Number.isSafeInteger(whole)) return null;

  const fractionText = (match[3] ?? match[4] ?? '').padEnd(2, '0');
  const kopecks = whole * 100 + Number(fractionText || '0');
  if (!Number.isSafeInteger(kopecks)) return null;

  const signed = negative ? -kopecks : kopecks;
  return Number.isSafeInteger(signed) ? signed : null;
}

// Compatibility export for numeric call sites. New forms must pass the original string
// to parseRublesToKopecks so precision is validated before Number conversion.
export const rublesToKopecks = (rubles) => {
  const parsed = parseRublesToKopecks(String(rubles));
  return parsed === null ? Number.NaN : parsed;
};

export const formatRubles = (kopecks) => {
  const rubles = kopecks / 100;
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(rubles);
};

export const formatRublesShort = (kopecks) => {
  const rubles = kopecks / 100;
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(rubles) + ' ₽';
};

export const formatNumber = (rubles) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(rubles);
