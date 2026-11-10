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

test('changed payload gets a new request ID', async () => {
  const { getOrCreatePendingTransactionId } = await loadPendingModule()
  const storage = createStorage()
  let generated = 0
  const createId = () => `tx_${String(++generated).padStart(32, '0')}`
  const first = getOrCreatePendingTransactionId(storage, 'family-a:user-a', 'a'.repeat(64), createId, 1000)
  const changed = getOrCreatePendingTransactionId(storage, 'family-a:user-a', 'b'.repeat(64), createId, 2000)
  assert.notEqual(first, changed)
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
