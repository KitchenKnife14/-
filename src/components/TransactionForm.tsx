import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { googleSheets } from '../lib/googleSheets'
import Modal from './Modal'
import type { Account, Category, TxType } from '../lib/types'
import { rublesToKopecks } from '../lib/money'
import { todayISO } from '../lib/dates'
import { Loader as Loader2 } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  onSaved: () => void
  categories: Category[]
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
}

export default function TransactionForm({ open, onClose, onSaved, categories, userId, editing, initialType = 'expense' }: Props) {
  const { family } = useAuth()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [type, setType] = useState<TxType>(initialType)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [categoryId, setCategoryId] = useState<string>('')
  const [accountId, setAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [description, setDescription] = useState('')
  const [planned, setPlanned] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !family) return
    let active = true
    googleSheets.from('accounts').select('*').eq('family_id', family.id).then(({ data, error: err }) => {
      if (!active) return
      if (err) setError(err.message)
      else setAccounts((data ?? []) as Account[])
    })
    return () => { active = false }
  }, [open, family?.id])

  useEffect(() => {
    if (editing) {
      setType(editing.type)
      setAmount((editing.amount_kopecks / 100).toString())
      setDate(editing.operation_date)
      setCategoryId(editing.category_id ?? '')
      setAccountId(editing.account_id ?? '')
      setToAccountId(editing.to_account_id ?? '')
      setDescription(editing.description)
      setPlanned(editing.planned)
    } else {
      setType(initialType)
      setAmount('')
      setDate(todayISO())
      setCategoryId('')
      setAccountId('')
      setToAccountId('')
      setDescription('')
      setPlanned(false)
    }
    setError(null)
  }, [editing, open, initialType])

  const visibleCats = categories.filter((c) => c.kind === type && (!c.archived || c.id === categoryId))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!family || !userId) return
    setError(null)
    const amt = rublesToKopecks(parseFloat(amount.replace(',', '.')))
    if (!Number.isSafeInteger(amt) || amt <= 0) {
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
        description: description.trim(),
        planned,
      }
      if (editing) {
        const { error: err } = await googleSheets.from('transactions').update(payload).eq('id', editing.id)
        if (err) throw err
      } else {
        const { error: err } = await googleSheets.from('transactions').insert({ ...payload, created_by: userId })
        if (err) throw err
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
          <label className="label">Сумма, ₽</label>
          <input className="input" type="number" step="0.01" min="0" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus />
        </div>
        <div>
          <label className="label">Дата</label>
          <input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {type === 'transfer' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="label">Со счёта</label><select className="input" required value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Выберите счёт</option>{accounts.filter(a => !a.archived || a.id === accountId).map(a => <option key={a.id} value={a.id}>{a.name}{a.archived ? ' (архив)' : ''}</option>)}</select></div>
            <div><label className="label">На счёт</label><select className="input" required value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}><option value="">Выберите счёт</option>{accounts.filter(a => a.id !== accountId && (!a.archived || a.id === toAccountId)).map(a => <option key={a.id} value={a.id}>{a.name}{a.archived ? ' (архив)' : ''}</option>)}</select></div>
          </div>
        ) : (
          <div><label className="label">Счёт</label><select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Не учитывать в остатках счетов</option>{accounts.filter(a => !a.archived || a.id === accountId).map(a => <option key={a.id} value={a.id}>{a.name}{a.archived ? ' (архив)' : ''}</option>)}</select></div>
        )}

        {type !== 'transfer' && <div>
          <label className="label">Категория</label>
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Без категории</option>
            {visibleCats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </div>}
        <div>
          <label className="label">Описание</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Необязательно" />
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
