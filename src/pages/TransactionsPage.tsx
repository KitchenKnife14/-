import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import type { Transaction, Category } from '../lib/types'
import { formatRubles, formatRublesShort } from '../lib/money'
import { formatDate, monthRange, monthLabel } from '../lib/dates'
import { Plus, Search, Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import TransactionForm, { type TransactionDraft } from '../components/TransactionForm'
import Modal from '../components/Modal'

export default function TransactionsPage() {
  const { family, session } = useAuth()
  const [txs, setTxs] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() })
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense' | 'transfer'>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<TransactionDraft | null>(null)
  const [deleting, setDeleting] = useState<Transaction | null>(null)

  const range = useMemo(() => monthRange(cursor.year, cursor.month), [cursor])

  const load = async () => {
    if (!family) return
    setLoading(true)
    setError(null)
    try {
      const [txRes, catRes] = await Promise.all([
        supabase
          .from('transactions')
          .select('*')
          .eq('family_id', family.id)
          .gte('operation_date', range.start)
          .lte('operation_date', range.end)
          .order('operation_date', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase.from('categories').select('*').eq('family_id', family.id).eq('archived', false),
      ])
      if (txRes.error) throw txRes.error
      if (catRes.error) throw catRes.error
      setTxs(txRes.data as Transaction[])
      setCategories(catRes.data as Category[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [family?.id, range.start, range.end])
  useEffect(() => {
    if (!family) return
    const ch = supabase.channel('tx-page').on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `family_id=eq.${family.id}` }, () => load()).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [family?.id])

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const filtered = txs.filter((t) => {
    if (typeFilter !== 'all' && t.type !== typeFilter) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const cat = t.category_id ? catMap.get(t.category_id)?.name.toLowerCase() ?? '' : ''
      if (!t.description.toLowerCase().includes(q) && !cat.includes(q)) return false
    }
    return true
  })

  const income = filtered.filter((t) => t.type === 'income' && !t.planned).reduce((s, t) => s + t.amount_kopecks, 0)
  const expense = filtered.filter((t) => t.type === 'expense' && !t.planned).reduce((s, t) => s + t.amount_kopecks, 0)

  const prevMonth = () => setCursor((c) => ({ year: c.month === 0 ? c.year - 1 : c.year, month: c.month === 0 ? 11 : c.month - 1 }))
  const nextMonth = () => setCursor((c) => ({ year: c.month === 11 ? c.year + 1 : c.year, month: c.month === 11 ? 0 : c.month + 1 }))

  const confirmDelete = async () => {
    if (!deleting) return
    const { error: err } = await supabase.from('transactions').delete().eq('id', deleting.id)
    if (err) setError(err.message)
    setDeleting(null)
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Операции</h1>
        <button onClick={() => { setEditing(null); setShowAdd(true) }} className="btn-primary">
          <Plus size={18} /> Добавить
        </button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <button onClick={prevMonth} className="btn-ghost px-2"><ChevronLeft size={18} /></button>
        <div className="font-medium text-slate-700">{monthLabel(cursor.year, cursor.month)}</div>
        <button onClick={nextMonth} className="btn-ghost px-2"><ChevronRight size={18} /></button>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Поиск по описанию или категории" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input w-auto" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
          <option value="all">Все типы</option>
          <option value="income">Доходы</option>
          <option value="expense">Расходы</option>
          <option value="transfer">Переводы</option>
        </select>
      </div>

      <div className="flex gap-3 text-sm">
        <div className="text-accent-600">Доходы: {formatRubles(income)}</div>
        <div className="text-slate-700">Расходы: {formatRubles(expense)}</div>
        <div className={income - expense >= 0 ? 'text-slate-500' : 'text-danger-600'}>Остаток: {formatRubles(income - expense)}</div>
      </div>

      {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}

      {loading ? (
        <div className="text-sm text-slate-400">Загрузка…</div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-8 text-sm text-slate-500">Операций за этот месяц нет.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => {
            const cat = t.category_id ? catMap.get(t.category_id) : null
            const isIncome = t.type === 'income'
            return (
              <div key={t.id} className="card flex items-center gap-3 py-3">
                <div className="text-xl w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center">{cat?.icon ?? '📝'}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate">
                    {t.description || cat?.name || 'Операция'}
                    {t.planned && <span className="ml-2 badge bg-warn-100 text-warn-600">план</span>}
                  </div>
                  <div className="text-xs text-slate-400">{formatDate(t.operation_date)} · {cat?.name ?? 'Без категории'}</div>
                </div>
                <div className={`text-sm font-semibold ${isIncome ? 'text-accent-600' : 'text-slate-900'}`}>
                  {isIncome ? '+' : '−'} {formatRublesShort(t.amount_kopecks)}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { setEditing({ id: t.id, type: t.type, amount_kopecks: t.amount_kopecks, operation_date: t.operation_date, category_id: t.category_id, description: t.description, planned: t.planned }); setShowAdd(true) }} className="btn-ghost px-2" aria-label="Изменить">
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => setDeleting(t)} className="btn-ghost px-2 text-danger-600" aria-label="Удалить">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <TransactionForm open={showAdd} onClose={() => { setShowAdd(false); setEditing(null) }} onSaved={load} categories={categories} userId={session?.user.id ?? null} editing={editing} />

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Удалить операцию?">
        <p className="text-sm text-slate-600 mb-4">Это действие нельзя отменить. Операция будет удалена безвозвратно.</p>
        <div className="flex gap-2">
          <button onClick={() => setDeleting(null)} className="btn-secondary flex-1">Отмена</button>
          <button onClick={confirmDelete} className="btn-danger flex-1">Удалить</button>
        </div>
      </Modal>
    </div>
  )
}
