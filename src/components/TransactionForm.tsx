import { useEffect, useId, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { googleSheets } from '../lib/googleSheets'
import Modal from './Modal'
import type { Account, Category, TxType } from '../lib/types'
import { parseRublesToKopecks } from '../lib/money'
import { clearPendingTransaction, fingerprintTransactionPayload, getOrCreatePendingTransactionId, pendingTransactionStorageKey } from '../lib/pendingTransaction'
import { todayISO } from '../lib/dates'
import { Loader as Loader2 } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  onSaved: () => void
  categories: Category[]
  accounts: Account[]
  userId: string | null
  editing?: TransactionDraft | null
  initialType?: TxType
}

export interface TransactionDraft {
  id: string
  type: TxType
  amount_kopecks: number
  operation_date: string
  category_id: string | null
  account_id: string | null
  to_account_id: string | null
  description: string
  planned: boolean
  responsible_user_id?: string | null
  created_by?: string | null
}

function createTransactionRequestId(): string {
  const bytes = new Uint8Array(16)
  window.crypto.getRandomValues(bytes)
  return 'tx_' + Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

export default function TransactionForm({ open, onClose, onSaved, categories, accounts, userId, editing, initialType = 'expense' }: Props) {
  const { family, members, memberProfiles } = useAuth()
  const fieldId = useId()
  const [type, setType] = useState<TxType>(initialType)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [categoryId, setCategoryId] = useState<string>('')
  const [accountId, setAccountId] = useState('')
  const [responsibleUserId, setResponsibleUserId] = useState(userId ?? '')
  const [toAccountId, setToAccountId] = useState('')
  const [description, setDescription] = useState('')
  const [planned, setPlanned] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingInsertRef = useRef<{ key: string; fingerprint: string; id: string } | null>(null)

  useEffect(() => {
    pendingInsertRef.current = null
    if (editing) {
      setType(editing.type)
      setAmount((editing.amount_kopecks / 100).toString())
      setDate(editing.operation_date)
      setCategoryId(editing.category_id ?? '')
      setAccountId(editing.account_id ?? '')
      setToAccountId(editing.to_account_id ?? '')
      setResponsibleUserId(editing.responsible_user_id ?? editing.created_by ?? userId ?? '')
      setDescription(editing.description)
      setPlanned(editing.planned)
    } else {
      setType(initialType)
      setAmount('')
      setDate(todayISO())
      setCategoryId('')
      setAccountId('')
      setToAccountId('')
      setResponsibleUserId(userId ?? '')
      setDescription('')
      setPlanned(false)
    }
    setError(null)
  }, [editing, open, initialType, userId])

  const visibleCats = categories
    .filter((c) => c.kind === type && (!c.archived || c.id === categoryId))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!family || !userId) return
    setError(null)
    const amt = parseRublesToKopecks(amount)
    if (amt === null || amt <= 0) {
      setError('Введите корректную сумму больше нуля')
      return
    }
    if (type === 'transfer' && (!accountId || !toAccountId || accountId === toAccountId)) {
      setError('Для перевода выберите два разных счёта')
      return
    }
    if (type === 'transfer' && (!accounts.some(a => a.id === accountId) || !accounts.some(a => a.id === toAccountId))) {
      setError('Выбранный счёт недоступен. Обновите список счетов.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        family_id: family.id,
        type,
        amount_kopecks: amt,
        operation_date: date,
        category_id: type === 'transfer' ? null : (categoryId || null),
        account_id: accountId || null,
        to_account_id: type === 'transfer' ? toAccountId : null,
        responsible_user_id: responsibleUserId || userId,
        description: description.trim(),
        planned,
      }
      if (editing) {
        const { error: err } = await googleSheets.from('transactions').update(payload).eq('id', editing.id)
        if (err) throw err
      } else {
        const insertPayload = { ...payload, created_by: userId }
        const fingerprint = await fingerprintTransactionPayload(insertPayload)
        const storageKey = pendingTransactionStorageKey(family.id, userId)
        let requestId: string

        if (pendingInsertRef.current?.key === storageKey && pendingInsertRef.current.fingerprint === fingerprint) {
          requestId = pendingInsertRef.current.id
        } else {
          try {
            requestId = getOrCreatePendingTransactionId(window.localStorage, storageKey, fingerprint, createTransactionRequestId)
          } catch {
            // Storage may be disabled or full. Keep retry protection for this mounted form.
            requestId = createTransactionRequestId()
          }
          pendingInsertRef.current = { key: storageKey, fingerprint, id: requestId }
        }

        const { error: err } = await googleSheets.from('transactions').insert({
          ...insertPayload,
          id: requestId,
        })
        if (err) throw err

        try {
          clearPendingTransaction(window.localStorage, storageKey, requestId)
        } catch {
          // A stale metadata record is harmless; the server remains the source of truth.
        }
        pendingInsertRef.current = null
      }
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Редактировать операцию' : 'Новая операция'}>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
          {(['expense', 'income', 'transfer'] as TxType[]).map((t) => (
            <button key={t} type="button" onClick={() => setType(t)}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${type === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
              {t === 'expense' ? 'Расход' : t === 'income' ? 'Доход' : 'Перевод'}
            </button>
          ))}
        </div>

        <div>
          <label className="label" htmlFor={`${fieldId}-amount`}>Сумма, ₽</label>
          <input id={`${fieldId}-amount`} className="input" type="number" step="0.01" min="0" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus />
        </div>
        <div>
          <label className="label" htmlFor={`${fieldId}-date`}>Дата</label>
          <input id={`${fieldId}-date`} className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {members.length > 1 && (
          <div>
            <label className="label" htmlFor={`${fieldId}-responsible`}>Ответственный участник</label>
            <select id={`${fieldId}-responsible`} className="input" value={responsibleUserId} onChange={(e) => setResponsibleUserId(e.target.value)}>
              {members.map((member) => {
                const profile = memberProfiles.find((item) => item.id === member.user_id)
                const fallback = member.role === 'owner' ? 'Первый участник' : 'Второй участник'
                return <option key={member.user_id} value={member.user_id}>{profile?.display_name || fallback}</option>
              })}
            </select>
          </div>
        )}

        {type === 'transfer' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="label" htmlFor={`${fieldId}-from-account`}>Со счёта</label><select id={`${fieldId}-from-account`} className="input" required value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Выберите счёт</option>{accounts.filter(a => !a.archived || a.id === accountId).map(a => <option key={a.id} value={a.id}>{a.name}{a.archived ? ' (архив)' : ''}</option>)}</select></div>
            <div><label className="label" htmlFor={`${fieldId}-to-account`}>На счёт</label><select id={`${fieldId}-to-account`} className="input" required value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}><option value="">Выберите счёт</option>{accounts.filter(a => a.id !== accountId && (!a.archived || a.id === toAccountId)).map(a => <option key={a.id} value={a.id}>{a.name}{a.archived ? ' (архив)' : ''}</option>)}</select></div>
          </div>
        ) : (
          <div>
            <label className="label" htmlFor={`${fieldId}-account`}>Счёт (для расчёта остатка)</label>
            <select id={`${fieldId}-account`} className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Не учитывать в остатках счетов</option>
              {accounts.filter(a => !a.archived || a.id === accountId).map(a => <option key={a.id} value={a.id}>{a.name}{a.archived ? ' (архив)' : ''}</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-400">Без счёта операция попадёт в общую статистику, но не изменит остаток отдельного счёта.</p>
          </div>
        )}

        {type !== 'transfer' && <div>
          <label className="label" htmlFor={`${fieldId}-category`}>Категория</label>
          <select id={`${fieldId}-category`} className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
            onKeyDown={(event) => {
              if (event.ctrlKey || event.metaKey || event.altKey || !/^[а-яё]$/iu.test(event.key)) return
              const letter = event.key.toLocaleLowerCase('ru-RU')
              const match = visibleCats.find((category) => category.name.trim().charAt(0).toLocaleLowerCase('ru-RU') === letter)
              if (match) { event.preventDefault(); setCategoryId(match.id) }
            }}>
            <option value="">Без категории</option>
            {visibleCats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
          <p className="mt-1 text-xs text-slate-400">Список по алфавиту. Начните вводить русскую букву, чтобы перейти к первой подходящей категории.</p>
        </div>}
        <div>
          <label className="label" htmlFor={`${fieldId}-description`}>Описание</label>
          <input id={`${fieldId}-description`} className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Необязательно" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={planned} onChange={(e) => setPlanned(e.target.checked)} className="rounded" />
          Запланировано (не считать как фактически оплаченное)
        </label>

        {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Отмена</button>
          <button type="submit" disabled={saving} className="btn-primary flex-1">
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
