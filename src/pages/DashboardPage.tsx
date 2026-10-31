import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { googleSheets } from '../lib/googleSheets'
import type { Transaction, Category, Account } from '../lib/types'
import { formatRubles, formatRublesShort } from '../lib/money'
import { formatDateShort, monthRange, monthLabel, currentMoscowDate } from '../lib/dates'
import { Plus, TrendingUp, TrendingDown, Wallet, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import TransactionForm from '../components/TransactionForm'

export default function DashboardPage() {
  const { family, session } = useAuth()
  const [txs, setTxs] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [now] = useState(currentMoscowDate)
  const [showAdd, setShowAdd] = useState(false)
  const [newTransactionType, setNewTransactionType] = useState<'expense' | 'income' | 'transfer'>('expense')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const year = now.getFullYear()
  const month = now.getMonth()
  const range = useMemo(() => monthRange(year, month), [year, month])

  const load = async () => {
    if (!family) return
    setLoading(true)
    setError(null)
    try {
      const [txRes, catRes, accountRes] = await Promise.all([
        googleSheets
          .from('transactions')
          .select('*')
          .eq('family_id', family.id)
          .gte('operation_date', range.start)
          .lte('operation_date', range.end)
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

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family?.id, range.start, range.end])

  // Polling: refresh when the adapter detects a changed transaction snapshot.
  useEffect(() => {
    if (!family) return
    const channel = googleSheets
      .channel('dashboard-tx')
      .on('table_changes', { event: '*', schema: 'public', table: 'transactions', filter: `family_id=eq.${family.id}` }, () => load())
      .subscribe()
    return () => { googleSheets.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family?.id])

  const realized = txs.filter((t) => !t.planned)
  const income = realized.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount_kopecks, 0)
  const expense = realized.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount_kopecks, 0)
  const planned = txs.filter((t) => t.planned)
  const plannedExpense = planned.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount_kopecks, 0)

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts])
  const recent = realized.slice(0, 6)

  const quickActions = [
    { label: 'Добавить расход', icon: TrendingDown, color: 'text-danger-600', action: () => { setNewTransactionType('expense'); setShowAdd(true) } },
    { label: 'Добавить доход', icon: TrendingUp, color: 'text-accent-600', action: () => { setNewTransactionType('income'); setShowAdd(true) } },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{monthLabel(year, month)}</h1>
          <p className="text-sm text-slate-500">Обзор семейного бюджета</p>
        </div>
        <button onClick={() => { setNewTransactionType('expense'); setShowAdd(true) }} className="btn-primary">
          <Plus size={18} /> Операция
        </button>
      </div>

      {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <TrendingUp size={16} className="text-accent-600" /> Доходы
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{formatRubles(income)}</div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <TrendingDown size={16} className="text-danger-600" /> Расходы
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{formatRubles(expense)}</div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Wallet size={16} className="text-primary-600" /> Разница за месяц
          </div>
          <div className={`mt-1 text-2xl font-semibold ${income - expense >= 0 ? 'text-slate-900' : 'text-danger-600'}`}>
            {formatRubles(income - expense)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {quickActions.map((a) => (
          <button key={a.label} onClick={a.action} className="card text-left hover:bg-slate-50 transition-colors">
            <a.icon size={18} className={a.color} />
            <div className="mt-2 text-sm font-medium text-slate-700">{a.label}</div>
          </button>
        ))}
        <Link to="/transactions" className="card hover:bg-slate-50 transition-colors">
          <ArrowRight size={18} className="text-slate-400" />
          <div className="mt-2 text-sm font-medium text-slate-700">Все операции</div>
        </Link>
        <Link to="/categories" className="card hover:bg-slate-50 transition-colors">
          <ArrowRight size={18} className="text-slate-400" />
          <div className="mt-2 text-sm font-medium text-slate-700">Категории</div>
        </Link>
      </div>

      {plannedExpense > 0 && (
        <div className="card bg-warn-50 border-warn-100">
          <div className="text-sm text-warn-600 font-medium">Запланированные платежи на месяц</div>
          <div className="text-lg font-semibold text-slate-900 mt-1">{formatRubles(plannedExpense)}</div>
          <p className="text-xs text-slate-500 mt-1">Это плановые суммы. Они учитываются как расход только после подтверждения оплаты.</p>
        </div>
      )}

      <div>
        <h2 className="font-medium text-slate-700 mb-3">Последние операции</h2>
        {loading ? (
          <div className="text-sm text-slate-400">Загрузка…</div>
        ) : recent.length === 0 ? (
          <div className="card text-center py-8">
            <p className="text-sm text-slate-500 mb-3">Пока нет ни одной операции.</p>
            <button onClick={() => { setNewTransactionType('expense'); setShowAdd(true) }} className="btn-primary">
              <Plus size={18} /> Добавить первую запись
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {recent.map((t) => {
              const cat = t.category_id ? catMap.get(t.category_id) : null
              const isIncome = t.type === 'income'
              const isTransfer = t.type === 'transfer'
              const operationLabel = isTransfer
                ? `${accountMap.get(t.account_id ?? '') ?? 'Счёт'} → ${accountMap.get(t.to_account_id ?? '') ?? 'Счёт'}`
                : `${formatDateShort(t.operation_date)} · ${cat?.name ?? 'Без категории'}`
              return (
                <div key={t.id} className="card flex items-center gap-3 py-3">
                  <div className="text-xl w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center">{cat?.icon ?? '📝'}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">{t.description || cat?.name || 'Операция'}</div>
                    <div className="text-xs text-slate-400">{operationLabel}</div>
                  </div>
                  <div className={`text-sm font-semibold ${isIncome ? 'text-accent-600' : isTransfer ? 'text-primary-600' : 'text-slate-900'}`}>
                    {isTransfer ? '⇄' : isIncome ? '+' : '−'} {formatRublesShort(t.amount_kopecks)}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <TransactionForm open={showAdd} onClose={() => setShowAdd(false)} onSaved={load} categories={categories} userId={session?.user.id ?? null} initialType={newTransactionType} />
    </div>
  )
}
