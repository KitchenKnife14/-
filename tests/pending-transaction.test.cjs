const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

async function loadPendingModule() {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/pendingTransaction.ts'), 'utf8')
  const javascript = ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 })
  return import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'))
}

function createStorage() {
  const values = new Map()
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null },
    setItem(key, value) { values.set(key, value) },
    removeItem(key) { values.delete(key) },
  }
}

test('pending transaction ID is reused for the same payload across form remounts', async () => {
  const { getOrCreatePendingTransactionId } = await loadPendingModule()
  const storage = createStorage()
  let generated = 0
  const createId = () => `tx_${String(++generated).padStart(32, '0')}`
  const first = getOrCreatePendingTransactionId(storage, 'family-a:user-a', 'a'.repeat(64), createId, 1000)
  const afterRemount = getOrCreatePendingTransactionId(storage, 'family-a:user-a', 'a'.repeat(64), createId, 2000)
  assert.equal(first, afterRemount)
  assert.equal(generated, 1)
})

test('changed payload cannot replace an operation with an uncertain result', async () => {
  const { getOrCreatePendingTransactionId, PendingTransactionConflictError } = await loadPendingModule()
  const storage = createStorage()
  let generated = 0
  const createId = () => `tx_${String(++generated).padStart(32, '0')}`
  const first = getOrCreatePendingTransactionId(storage, 'family-a:user-a', 'a'.repeat(64), createId, 1000)
  assert.throws(
    () => getOrCreatePendingTransactionId(storage, 'family-a:user-a', 'b'.repeat(64), createId, 2000),
    PendingTransactionConflictError,
  )
  assert.equal(getOrCreatePendingTransactionId(storage, 'family-a:user-a', 'a'.repeat(64), createId, 3000), first)
  assert.equal(generated, 1)
})

test('a definitively rejected pending operation can be cleared before correcting its payload', async () => {
  const { getOrCreatePendingTransactionId, clearPendingTransaction } = await loadPendingModule()
  const storage = createStorage()
  let generated = 0
  const createId = () => `tx_${String(++generated).padStart(32, '0')}`
  const key = 'family-a:user-a'
  const first = getOrCreatePendingTransactionId(storage, key, 'a'.repeat(64), createId, 1000)
  clearPendingTransaction(storage, key, first)
  const corrected = getOrCreatePendingTransactionId(storage, key, 'b'.repeat(64), createId, 2000)
  assert.notEqual(first, corrected)
  assert.equal(generated, 2)
})

test('expired or malformed pending metadata is discarded', async () => {
  const { getOrCreatePendingTransactionId, PENDING_TRANSACTION_TTL_MS } = await loadPendingModule()
  const storage = createStorage()
  const key = 'family-a:user-a'
  let generated = 0
  const createId = () => `tx_${String(++generated).padStart(32, '0')}`
  const first = getOrCreatePendingTransactionId(storage, key, 'a'.repeat(64), createId, 1000)
  const afterExpiry = getOrCreatePendingTransactionId(storage, key, 'a'.repeat(64), createId, 1001 + PENDING_TRANSACTION_TTL_MS)
  assert.notEqual(first, afterExpiry)
  storage.setItem(key, '{broken')
  const afterCorruption = getOrCreatePendingTransactionId(storage, key, 'a'.repeat(64), createId, 2000 + PENDING_TRANSACTION_TTL_MS)
  assert.notEqual(afterExpiry, afterCorruption)
})

test('pending metadata is isolated by family and user storage key', async () => {
  const { pendingTransactionStorageKey, getOrCreatePendingTransactionId } = await loadPendingModule()
  const storage = createStorage()
  let generated = 0
  const createId = () => `tx_${String(++generated).padStart(32, '0')}`
  const keyA = pendingTransactionStorageKey('family-a', 'user-a')
  const keyB = pendingTransactionStorageKey('family-b', 'user-a')
  const keyC = pendingTransactionStorageKey('family-a', 'user-b')
  const a = getOrCreatePendingTransactionId(storage, keyA, 'a'.repeat(64), createId, 1000)
  const b = getOrCreatePendingTransactionId(storage, keyB, 'a'.repeat(64), createId, 1000)
  const c = getOrCreatePendingTransactionId(storage, keyC, 'a'.repeat(64), createId, 1000)
  assert.equal(new Set([a, b, c]).size, 3)
})

test('successful request cleanup removes only the matching pending ID', async () => {
  const { getOrCreatePendingTransactionId, clearPendingTransaction } = await loadPendingModule()
  const storage = createStorage()
  let generated = 0
  const createId = () => `tx_${String(++generated).padStart(32, '0')}`
  const key = 'family-a:user-a'
  const id = getOrCreatePendingTransactionId(storage, key, 'a'.repeat(64), createId, 1000)
  clearPendingTransaction(storage, key, 'tx_' + 'f'.repeat(32))
  assert.ok(storage.getItem(key))
  clearPendingTransaction(storage, key, id)
  assert.equal(storage.getItem(key), null)
})

test('payload fingerprint is SHA-256 and changes with normalized payload', async () => {
  const { fingerprintTransactionPayload } = await loadPendingModule()
  const first = await fingerprintTransactionPayload({ amount_kopecks: 4510, description: 'Проезд' })
  const same = await fingerprintTransactionPayload({ amount_kopecks: 4510, description: 'Проезд' })
  const changed = await fingerprintTransactionPayload({ amount_kopecks: 4511, description: 'Проезд' })
  assert.match(first, /^[a-f0-9]{64}$/)
  assert.equal(first, same)
  assert.notEqual(first, changed)
})


test('generic pending mutation IDs are isolated by table, family, user and form scope', async () => {
  const { pendingMutationStorageKey, getOrCreatePendingMutationId } = await loadPendingModule()
  const storage = createStorage()
  let generated = 0
  const createId = () => `op_${String(++generated).padStart(32, '0')}`
  const a = pendingMutationStorageKey('accounts', 'family-a', 'user-a')
  const b = pendingMutationStorageKey('budgets', 'family-a', 'user-a')
  const c = pendingMutationStorageKey('goal_contributions', 'family-a', 'user-a', 'goal-1')
  const d = pendingMutationStorageKey('goal_contributions', 'family-a', 'user-a', 'goal-2')
  const ids = [a,b,c,d].map(key => getOrCreatePendingMutationId(storage,key,'a'.repeat(64),createId,1000))
  assert.equal(new Set(ids).size, 4)
})

test('generic pending mutation reuses ID after uncertain result and clears only after confirmed success', async () => {
  const { pendingMutationStorageKey, runPendingMutation } = await loadPendingModule()
  const storage = createStorage()
  let generated = 0
  let observedId = ''
  const createId = () => `op_${String(++generated).padStart(32, '0')}`
  const key = pendingMutationStorageKey('planned_purchases','family-a','user-a')
  await assert.rejects(
    runPendingMutation(storage,key,'c'.repeat(64),createId,async id => {
      observedId = id
      throw new Error('network timeout')
    },1000),
    /network timeout/,
  )
  const retry = await runPendingMutation(storage,key,'c'.repeat(64),createId,async id => {
    assert.equal(id,observedId)
    return { data: { id }, error: null }
  },2000)
  assert.equal(retry.data.id,observedId)
  assert.equal(generated,1)
  assert.equal(storage.getItem(key),null)
})

test('generic pending mutation blocks changed payload after uncertain result', async () => {
  const { pendingMutationStorageKey, runPendingMutation, PendingTransactionConflictError } = await loadPendingModule()
  const storage = createStorage()
  const createId = () => `op_${'1'.repeat(32)}`
  const key = pendingMutationStorageKey('accounts','family-a','user-a')
  await assert.rejects(
    runPendingMutation(storage,key,'a'.repeat(64),createId,async () => { throw new Error('network timeout') },1000),
    /network timeout/,
  )
  await assert.rejects(
    runPendingMutation(storage,key,'b'.repeat(64),createId,async () => ({ error: null }),2000),
    PendingTransactionConflictError,
  )
})

test('generic pending mutation clears ID only after a definitive backend rejection', async () => {
  const { pendingMutationStorageKey, runPendingMutation } = await loadPendingModule()
  const storage = createStorage()
  let generated = 0
  const createId = () => `op_${String(++generated).padStart(32, '0')}`
  const key = pendingMutationStorageKey('budgets','family-a','user-a')
  await assert.rejects(
    runPendingMutation(storage,key,'a'.repeat(64),createId,async () => {
      const error = new Error('validation rejected')
      error.name = 'BackendRequestError'
      throw error
    },1000),
    /validation rejected/,
  )
  assert.equal(storage.getItem(key),null)
  const corrected = await runPendingMutation(storage,key,'b'.repeat(64),createId,async id => ({ data: { id }, error: null }),2000)
  assert.ok(corrected.data.id)
  assert.equal(generated,2)
})


test('all financial create forms use the shared safe pending mutation lifecycle', () => {
  const files = [
    'AccountsPage.tsx',
    'CategoriesPage.tsx',
    'GoalsPage.tsx',
    'PurchasesPage.tsx',
    'RecurringPage.tsx',
    'BudgetsPage.tsx',
  ]
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, '../src/pages', file), 'utf8')
    assert.match(source, /runPendingMutation\(/, `${file} must use runPendingMutation`)
    assert.doesNotMatch(source, /getOrCreatePendingMutationId\(/, `${file} must not bypass the shared lifecycle`)
    assert.doesNotMatch(source, /clearPendingMutation\(/, `${file} must not clear pending IDs outside the shared lifecycle`)
  }
})

test('category create form keeps a stable pending ID for an uncertain insert', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/pages/CategoriesPage.tsx'), 'utf8')
  assert.match(source, /pendingMutationStorageKey\('categories'/)
  assert.match(source, /fingerprintTransactionPayload\(insertPayload\)/)
  assert.match(source, /runPendingMutation\(storage, pendingKey, fingerprint/)
  assert.match(source, /from\('categories'\)\.insert\(\{ \.\.\.insertPayload, id \}\)/)
})
