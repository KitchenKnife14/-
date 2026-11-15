export const PENDING_TRANSACTION_TTL_MS = 24 * 60 * 60 * 1000

export class PendingTransactionConflictError extends Error {
  constructor() {
    super('Предыдущий запрос ещё не подтверждён. Повторите отправку с прежними данными; после подтверждения можно будет внести изменения.')
    this.name = 'PendingTransactionConflictError'
  }
}

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

const volatilePendingValues = new Map<string, string>()
const volatilePendingStorage: KeyValueStorage = {
  getItem(key) { return volatilePendingValues.get(key) ?? null },
  setItem(key, value) { volatilePendingValues.set(key, value) },
  removeItem(key) { volatilePendingValues.delete(key) },
}

/** Uses persistent browser storage when writable; otherwise keeps IDs in memory for this page session. */
export function getPendingStorage(
  getPersistentStorage: () => KeyValueStorage = () => window.localStorage,
): KeyValueStorage {
  let persistent: KeyValueStorage
  try {
    persistent = getPersistentStorage()
  } catch {
    return volatilePendingStorage
  }
  let useVolatile = false
  return {
    getItem(key) {
      if (useVolatile) return volatilePendingStorage.getItem(key)
      try {
        return persistent.getItem(key)
      } catch {
        useVolatile = true
        return volatilePendingStorage.getItem(key)
      }
    },
    setItem(key, value) {
      if (useVolatile) {
        volatilePendingStorage.setItem(key, value)
        return
      }
      try {
        persistent.setItem(key, value)
      } catch {
        // getOrCreate reads first; if that read succeeded and there was no record,
        // falling back here cannot replace an existing persistent pending ID.
        useVolatile = true
        volatilePendingStorage.setItem(key, value)
      }
    },
    removeItem(key) {
      if (useVolatile) {
        volatilePendingStorage.removeItem(key)
        return
      }
      try {
        persistent.removeItem(key)
      } catch {
        // Keep the persistent record: a later retry will safely reuse its ID.
      }
    },
  }
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
  if (current && current.fingerprint !== fingerprint) {
    throw new PendingTransactionConflictError()
  }

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
  if (current && current.fingerprint !== fingerprint) {
    throw new PendingTransactionConflictError()
  }
  const record: PendingTransactionRecord = {
    version: 1,
    id: createId(),
    fingerprint,
    createdAt: now,
  }
  storage.setItem(key, JSON.stringify(record))
  return record.id
}

export async function runPendingMutation<T>(
  storage: KeyValueStorage,
  key: string,
  fingerprint: string,
  createId: () => string,
  execute: (id: string) => Promise<T>,
  now = Date.now(),
): Promise<T> {
  const id = getOrCreatePendingMutationId(storage, key, fingerprint, createId, now)
  try {
    const result = await execute(id)
    if (result && typeof result === 'object' && 'error' in result) {
      const error = (result as { error?: unknown }).error
      if (error) throw error
    }
    clearPendingMutation(storage, key, id)
    return result
  } catch (error) {
    if (error instanceof Error && error.name === 'BackendRequestError') {
      clearPendingMutation(storage, key, id)
    }
    throw error
  }
}

export const clearPendingMutation = clearPendingTransaction
