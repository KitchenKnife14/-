const FORMULA_PREFIX = /^[\u0000-\u0020\uFEFF]*[=+\-@]/

export function csvCell(value: unknown): string {
  const text = String(value ?? '')
  const safe = FORMULA_PREFIX.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export function toCsv(rows: readonly (readonly unknown[])[], delimiter = ';'): string {
  return rows.map(row => row.map(csvCell).join(delimiter)).join('\r\n')
}
