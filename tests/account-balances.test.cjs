const test = require('node:test')
const assert = require('node:assert/strict')

test('account balances recalculate edits, deletions, planned rows, and transfers', async () => {
  const { calculateAccountBalances } = await import('../src/lib/accountBalances.js')
  const accounts = [
    { id: 'cash', starting_balance_kopecks: 100000 },
    { id: 'savings', starting_balance_kopecks: 5000 },
  ]
  const income = { id: 'i1', type: 'income', amount_kopecks: 20000, account_id: 'cash', planned: false }
  const expense = { id: 'e1', type: 'expense', amount_kopecks: 5000, account_id: 'cash', planned: false }
  const transfer = { id: 't1', type: 'transfer', amount_kopecks: 10000, account_id: 'cash', to_account_id: 'savings', planned: false }
  const planned = { id: 'p1', type: 'income', amount_kopecks: 900000, account_id: 'cash', planned: true }

  const initial = calculateAccountBalances(accounts, [income, expense, transfer, planned])
  assert.equal(initial.get('cash'), 105000)
  assert.equal(initial.get('savings'), 15000)
  assert.equal([...initial.values()].reduce((sum, value) => sum + value, 0), 120000)

  // Editing a transfer amount recalculates both sides from the ledger.
  const edited = calculateAccountBalances(accounts, [income, expense, { ...transfer, amount_kopecks: 12000 }, planned])
  assert.equal(edited.get('cash'), 103000)
  assert.equal(edited.get('savings'), 17000)

  // Deleting that transfer restores the pre-transfer account balances.
  const deleted = calculateAccountBalances(accounts, [income, expense, planned])
  assert.equal(deleted.get('cash'), 115000)
  assert.equal(deleted.get('savings'), 5000)
})

test('invalid, same-account, and unknown-account transfers do not corrupt balances', async () => {
  const { calculateAccountBalances } = await import('../src/lib/accountBalances.js')
  const accounts = [{ id: 'a', starting_balance_kopecks: -100 }, { id: 'b', starting_balance_kopecks: 200 }]
  const rows = [
    { type: 'transfer', amount_kopecks: 50, account_id: 'a', to_account_id: 'a', planned: false },
    { type: 'transfer', amount_kopecks: 50, account_id: 'a', to_account_id: 'missing', planned: false },
    { type: 'expense', amount_kopecks: 1.5, account_id: 'a', planned: false },
    { type: 'income', amount_kopecks: 100, account_id: 'missing', planned: false },
  ]
  const balances = calculateAccountBalances(accounts, rows)
  assert.equal(balances.get('a'), -100)
  assert.equal(balances.get('b'), 200)
})
