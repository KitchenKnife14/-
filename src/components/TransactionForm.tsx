import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import Modal from './Modal'
import type { Category, TxType } from '../lib/types'
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
  description: string
  planned: boolean
}

export default function TransactionForm({ open, onClose, onSaved, categories, userId, editing, initialType = 'expense' }: Props) {
  const { family } = useAuth()
  const [type, setType] = useState<TxType>(initialType)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [categoryId, setCategoryId] = useState<string>('')
  const [description, setDescription] = useState('')
  const [planned, setPlanned] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (editing) {
      setType(editing.type)
      setAmount((editing.amount_kopecks / 100).toString())
      setDate(editing.operation_date)
      setCategoryId(editing.category_id ?? '')
      setDescription(editing.description)
      setPlanned(editing.planned)
    } else {
      setType(initialType)
      setAmount('')
      setDate(todayISO())
      setCategoryId('')
      setDescription('')
      setPlanned(false)
    }
    setError(null)
  }, [editing, open, initialType])

  const visibleCats = categories.filter((c) => c.kind === type)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!family || !userId) return
    setError(null)
    const amt = rublesToKopecks(parseFloat(amount.replace(',', '.')))
    if (!amt || amt <= 0) {
      setError('Введите сумму больше нуля')
      return
    }
    setSaving(true)
    try {
      const payload = {
        family_id: family.id,
        type,
        amount_kopecks: amt,
        operation_date: date,
        category_id: categoryId || null,
        description: description.trim(),
        planned,
      }
      if (editing) {
        const { error: err } = await supabase.from('transactions').update(payload).eq('id', editing.id)
        if (err) throw err
      } else {
        const { error: err } = await supabase.from('transactions').insert({ ...payload, created_by: userId })
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
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${type === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
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
        <div>
          <label className="label">Категория</label>
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Без категории</option>
            {visibleCats.map((c) => (
              <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
            ))}
          </select>
        </div>
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
