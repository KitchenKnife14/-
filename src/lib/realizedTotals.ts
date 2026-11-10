export interface RealizedTransaction {
  type: string
  amount_kopecks: number
  planned?: boolean
}

export interface RealizedTotals {
  income: number
  expense: number
  net: number
}

/**
 * Canonical realized totals: exclude planned rows and transfers; only income
 * and expense affect the net result. Date/family filtering belongs to callers.
 */
export function calculateRealizedTotals(
  transactions: readonly RealizedTransaction[],
): RealizedTotals {
  let income = 0
  let expense = 0
  for (const transaction of transactions) {
    if (transaction.planned) continue
    if (transaction.type === 'income') income += transaction.amount_kopecks
    else if (transaction.type === 'expense') expense += transaction.amount_kopecks
  }
  return { income, expense, net: income - expense }
}
