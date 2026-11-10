const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

async function loadTotalsModule() {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/realizedTotals.ts'), 'utf8')
  const javascript = ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 })
  return import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'))
}

test('canonical realized totals match the Telegram balance regression fixture', async () => {
  const { calculateRealizedTotals } = await loadTotalsModule()
  const rows = [
    { type: 'income', amount_kopecks: 100000, description: 'Фактический доход', planned: false },
    { type: 'expense', amount_kopecks: 25000, description: 'Фактический расход', planned: false },
    { type: 'income', amount_kopecks: 50000, description: 'Плановый доход', planned: true },
    { type: 'expense', amount_kopecks: 15000, description: 'Плановый расход', planned: true },
    { type: 'transfer', amount_kopecks: 10000, description: 'Перевод', planned: false },
  ]
  assert.deepEqual(calculateRealizedTotals(rows), {
    income: 100000,
    expense: 25000,
    net: 75000,
  })
})

test('dashboard, transactions and reports use the same realized totals helper', () => {
  for (const file of [
    '../src/pages/DashboardPage.tsx',
    '../src/pages/TransactionsPage.tsx',
    '../src/pages/ReportsPage.tsx',
  ]) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
    assert.match(source, /calculateRealizedTotals/, file)
  }
})
