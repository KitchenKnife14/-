import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { googleSheets } from '../lib/googleSheets'
import type { Transaction, Category, Account } from '../lib/types'
import { formatRubles, formatRublesShort } from '../lib/money'
import { formatDate, monthRange, monthLabel, currentMoscowMonth } from '../lib/dates'
import { Plus, Search, Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import TransactionForm, { type TransactionDraft } from '../components/TransactionForm'
import Modal from '../components/Modal'
import { ensureSupplementalCategories } from '../lib/categories'
import { getTransactionAttribution, matchesTransactionAttribution } from '../lib/transactionAttribution'

export default function TransactionsPage() {
  const { family, session, memberProfiles } = useAuth()
  const [txs, setTxs] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(currentMoscowMonth)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense' | 'transfer'>('all')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [authorFilter, setAuthorFilter] = useState('')
  const [responsibleFilter, setResponsibleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'planned' | 'actual'>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<TransactionDraft | null>(null)
  const [deleting, setDeleting] = useState<Transaction | null>(null)

  const range = useMemo(() => monthRange(cursor.year, cursor.month), [cursor])

  const load = async () => {
    if (!family) return
    setLoading(true)
    setError(null)
    try {
      const [, txRes, catRes, accountRes] = await Promise.all([
        ensureSupplementalCategories(family.id),
        googleSheets
          .from('transactions')
          .select('*')
          .eq('family_id', family.id)
          .gte('operation_date', dateFrom || range.start)
          .lte('operation_date', dateTo || range.end)
          .order('operation_date', { ascending: false })
          .order('created_at', { ascending: false }),
        googleSheets.from('categories').select('*').eq('family_id', family.id),
        googleSheets.from('accounts').select('*').eq('family_id', family.id),
      ])
      if (txRes.error) throw txRes.error
      if (catRes.error) throw catRes.error
      if (accountRes.error) throw accountRes.error
      setTxs(txRes.data as Transaction[])
      setCategories(catRes.data as Category[])
      setAccounts(accountRes.data as Account[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [family?.id, range.start, range.end, dateFrom, dateTo])
  useEffect(() => {
    if (!family) return
    const ch = googleSheets.channel('tx-page').on('table_changes', { event: '*', schema: 'public', table: 'transactions', filter: `family_id=eq.${family.id}` }, () => load()).subscribe()
    return () => { googleSheets.removeChannel(ch) }
  }, [family?.id])

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts])

  const filtered = txs.filter((t) => {
    if (typeFilter !== 'all' && t.type !== typeFilter) return false
    if (categoryFilter && t.category_id !== categoryFilter) return false
    if (!matchesTransactionAttribution(t, authorFilter, responsibleFilter)) return false
    if (statusFilter === 'planned' && !t.planned) return false
    if (statusFilter === 'actual' && t.planned) return false
    const amount = t.amount_kopecks / 100
    if (minAmount !== '' && amount < Number(minAmount.replace(',', '.'))) return false
    if (maxAmount !== '' && amount > Number(maxAmount.replace(',', '.'))) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const cat = t.category_id ? catMap.get(t.category_id)?.name.toLowerCase() ?? '' : ''
      if (!t.description.toLowerCase().includes(q) && !cat.includes(q)) return false
    }
    return true
  })
  const hasFilters = !!(search || categoryFilter || authorFilter || responsibleFilter || statusFilter !== 'all' || dateFrom || dateTo || minAmount || maxAmount || typeFilter !== 'all')
  const clearFilters = () => { setSearch(''); setTypeFilter('all'); setCategoryFilter(''); setAuthorFilter(''); setResponsibleFilter(''); setStatusFilter('all'); setDateFrom(''); setDateTo(''); setMinAmount(''); setMaxAmount('') }

  const income = filtered.filter((t) => t.type === 'income' && !t.planned).reduce((s, t) => s + t.amount_kopecks, 0)
  const expense = filtered.filter((t) => t.type === 'expense' && !t.planned).reduce((s, t) => s + t.amount_kopecks, 0)

  const prevMonth = () => setCursor((c) => ({ year: c.month === 0 ? c.year - 1 : c.year, month: c.month === 0 ? 11 : c.month - 1 }))
  const nextMonth = () => setCursor((c) => ({ year: c.month === 11 ? c.year + 1 : c.year, month: c.month === 11 ? 0 : c.month + 1 }))

  const confirmDelete = async () => {
    if (!deleting) return
    const { error: err } = await googleSheets.from('transactions').delete().eq('id', deleting.id)
    if (err) setError(err.message)
    setDeleting(null)
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="page-title">Операции</h1>
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
        <select className="input w-auto min-w-[150px]" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}><option value="">Все категории</option>{categories.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select aria-label="Фильтр по автору записи" className="input w-auto min-w-[145px]" value={authorFilter} onChange={(e) => setAuthorFilter(e.target.value)}><option value="">Все авторы</option>{memberProfiles.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</select>
        <select aria-label="Фильтр по ответственному участнику" className="input w-auto min-w-[165px]" value={responsibleFilter} onChange={(e) => setResponsibleFilter(e.target.value)}><option value="">Все ответственные</option>{memberProfiles.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</select>
        <select className="input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}><option value="all">Все статусы</option><option value="actual">Фактические</option><option value="planned">Плановые</option></select>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="text-xs text-slate-500">С даты<input className="input mt-1" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
        <label className="text-xs text-slate-500">По дату<input className="input mt-1" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
        <label className="text-xs text-slate-500">Сумма от, ₽<input className="input mt-1" type="number" min="0" step="0.01" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} placeholder="Любая" /></label>
        <label className="text-xs text-slate-500">Сумма до, ₽<input className="input mt-1" type="number" min="0" step="0.01" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="Любая" /></label>
      </div>
      {hasFilters && <button type="button" onClick={clearFilters} className="text-xs text-primary-700 hover:underline">Сбросить фильтры</button>}

      <div className="flex gap-3 text-sm">
        <div className="text-accent-600">Доходы: {formatRubles(income)}</div>
        <div className="text-slate-700">Расходы: {formatRubles(expense)}</div>
        <div className={income - expense >= 0 ? 'text-slate-500' : 'text-danger-600'}>Разница за период: {formatRubles(income - expense)}</div>
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
            const attribution = getTransactionAttribution(t)
            const author = memberProfiles.find((profile) => profile.id === attribution.authorId)
            const responsible = memberProfiles.find((profile) => profile.id === attribution.responsibleId)
            const isIncome = t.type === 'income'
            return (
              <div key={t.id} className="card flex items-center gap-3 py-3">
                <div className="text-xl w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center">{cat?.icon ?? '📝'}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate">
                    {t.description || cat?.name || 'Операция'}
                    {t.planned && <span className="ml-2 badge bg-warn-100 text-warn-600">план</span>}
                  </div>
                  <div className="text-xs text-slate-400">{formatDate(t.operation_date)} · {t.type === 'transfer' ? `${accountMap.get(t.account_id ?? '') ?? 'Счёт'} → ${accountMap.get(t.to_account_id ?? '') ?? 'Счёт'}` : `${cat?.name ?? 'Без категории'} · ${accountMap.get(t.account_id ?? '') ?? 'Без счёта'}`} · Автор: {author?.display_name ?? 'не указан'} · Ответственный: {responsible?.display_name ?? 'не указан'}</div>
                </div>
                <div className={`text-sm font-semibold ${isIncome ? 'text-accent-600' : 'text-slate-900'}`}>
                  {t.type === 'transfer' ? '⇄' : isIncome ? '+' : '−'} {formatRublesShort(t.amount_kopecks)}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { setEditing({ id: t.id, type: t.type, amount_kopecks: t.amount_kopecks, operation_date: t.operation_date, category_id: t.category_id, account_id: t.account_id, to_account_id: t.to_account_id, description: t.description, planned: t.planned, responsible_user_id: t.responsible_user_id, created_by: t.created_by }); setShowAdd(true) }} className="btn-ghost px-2" aria-label="Изменить">
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

      <TransactionForm open={showAdd} onClose={() => { setShowAdd(false); setEditing(null) }} onSaved={load} categories={categories} accounts={accounts} userId={session?.user.id ?? null} editing={editing} />

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
