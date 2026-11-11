export const PENDING_TRANSACTION_TTL_MS = 24 * 60 * 60 * 1000

interface PendingTransactionRecord {
  version: 1
  id: string
  fingerprint: string
  createdAt: number
}

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function pendingTransactionStorageKey(familyId: string, userId: string): string {
  return `budget:pending-transaction:v1:${encodeURIComponent(familyId)}:${encodeURIComponent(userId)}`
}

function readRecord(storage: KeyValueStorage, key: string, now: number): PendingTransactionRecord | null {
  const raw = storage.getItem(key)
  if (!raw) return null

  try {
    const value = JSON.parse(raw) as Partial<PendingTransactionRecord>
    const valid = value.version === 1
      && typeof value.id === 'string' && /^(?:tx|op)_[a-f0-9]{32}$/.test(value.id)
      && typeof value.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(value.fingerprint)
      && typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
      && value.createdAt <= now
    if (!valid || now - value.createdAt! > PENDING_TRANSACTION_TTL_MS) {
      storage.removeItem(key)
      return null
    }
    return value as PendingTransactionRecord
  } catch {
    storage.removeItem(key)
    return null
  }
}

export function getOrCreatePendingTransactionId(
  storage: KeyValueStorage,
  key: string,
  fingerprint: string,
  createId: () => string,
  now = Date.now(),
): string {
  const current = readRecord(storage, key, now)
  if (current?.fingerprint === fingerprint) return current.id

  const record: PendingTransactionRecord = {
    version: 1,
    id: createId(),
    fingerprint,
    createdAt: now,
  }
  storage.setItem(key, JSON.stringify(record))
  return record.id
}

export function clearPendingTransaction(
  storage: KeyValueStorage,
  key: string,
  expectedId: string,
): void {
  const raw = storage.getItem(key)
  if (!raw) return
  try {
    const current = JSON.parse(raw) as Partial<PendingTransactionRecord>
    if (current.id === expectedId) storage.removeItem(key)
  } catch {
    storage.removeItem(key)
  }
}

export async function fingerprintTransactionPayload(payload: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Безопасное хеширование недоступно в этом браузере')
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}


/** Isolated pending key for one create-form flow, family and user. */
export function pendingMutationStorageKey(
  table: string,
  familyId: string,
  userId: string,
  scope = 'create',
): string {
  return `budget:pending-mutation:v1:${encodeURIComponent(table)}:${encodeURIComponent(familyId)}:${encodeURIComponent(userId)}:${encodeURIComponent(scope)}`
}

export function getOrCreatePendingMutationId(
  storage: KeyValueStorage,
  key: string,
  fingerprint: string,
  createId: () => string,
  now = Date.now(),
): string {
  const current = readRecord(storage, key, now)
  if (current?.fingerprint === fingerprint) return current.id
  const record: PendingTransactionRecord = {
    version: 1,
    id: createId(),
    fingerprint,
    createdAt: now,
  }
  storage.setItem(key, JSON.stringify(record))
  return record.id
}

export const clearPendingMutation = clearPendingTransaction
