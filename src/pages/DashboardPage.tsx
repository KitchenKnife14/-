import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { googleSheets } from '../lib/googleSheets'
import type { Transaction, Category, Account } from '../lib/types'
import { formatRubles, formatRublesShort } from '../lib/money'
import { formatDateShort, monthRange, monthLabel, currentMoscowDate } from '../lib/dates'
import { Plus, TrendingUp, TrendingDown, Wallet, ArrowRight, CalendarDays } from 'lucide-react'
import { Link } from 'react-router-dom'
import TransactionForm from '../components/TransactionForm'
import { ensureSupplementalCategories } from '../lib/categories'

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
      await ensureSupplementalCategories(family.id)
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

  // Refresh the dashboard when the shared transaction snapshot changes.
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

  const openForm = (type: 'expense' | 'income' | 'transfer') => {
    setNewTransactionType(type)
    setShowAdd(true)
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-800">
            <CalendarDays size={14} />
            Ваш бюджет · {monthLabel(year, month)}
          </div>
          <h1 className="page-title">Деньги дома. Спокойно, вместе.</h1>
          <p className="page-subtitle">Общая картина доходов, расходов и планов семьи.</p>
        </div>
        <button onClick={() => openForm('expense')} className="btn-primary">
          <Plus size={17} /> Добавить операцию
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          {error}
        </div>
      )}

      <section aria-label="Итоги месяца" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-50 text-accent-700"><TrendingUp size={18} /></span>
              Доходы
            </div>
            <span className="rounded-full bg-accent-50 px-2.5 py-1 text-[11px] font-medium text-accent-700">За месяц</span>
          </div>
          <div className="mt-4 text-2xl font-semibold tracking-tight text-ink">{formatRubles(income)}</div>
          <div className="mt-1 text-xs text-muted">Поступления семьи</div>
        </div>
        <div className="card">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-danger-50 text-danger-600"><TrendingDown size={18} /></span>
              Расходы
            </div>
            <span className="rounded-full bg-danger-50 px-2.5 py-1 text-[11px] font-medium text-danger-600">За месяц</span>
          </div>
          <div className="mt-4 text-2xl font-semibold tracking-tight text-ink">{formatRubles(expense)}</div>
          <div className="mt-1 text-xs text-muted">Подтверждённые траты</div>
        </div>
        <div className="card border-primary-100 bg-primary-50/60">
          <div className="flex items-center gap-2 text-sm font-medium text-muted">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-primary-700"><Wallet size={18} /></span>
            Остаток за месяц
          </div>
          <div className={`mt-4 text-2xl font-semibold tracking-tight ${income - expense >= 0 ? 'text-primary-800' : 'text-danger-600'}`}>
            {formatRubles(income - expense)}
          </div>
          <div className="mt-1 text-xs text-muted">Доходы минус расходы</div>
        </div>
      </section>

      <section aria-label="Быстрые действия">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">Быстрые действия</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <button onClick={() => openForm('expense')} className="group rounded-2xl border border-line bg-surface p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-soft">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-danger-50 text-danger-600"><TrendingDown size={19} /></span>
            <span className="mt-3 block text-sm font-semibold text-ink">Добавить расход</span>
            <span className="mt-1 block text-xs text-muted">Записать покупку или платёж</span>
          </button>
          <button onClick={() => openForm('income')} className="group rounded-2xl border border-line bg-surface p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-soft">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-50 text-accent-700"><TrendingUp size={19} /></span>
            <span className="mt-3 block text-sm font-semibold text-ink">Добавить доход</span>
            <span className="mt-1 block text-xs text-muted">Зарплата и поступления</span>
          </button>
          <Link to="/calendar" className="group rounded-2xl border border-line bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-soft">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><CalendarDays size={19} /></span>
            <span className="mt-3 block text-sm font-semibold text-ink">Календарь</span>
            <span className="mt-1 block text-xs text-muted">Платежи и планы по датам</span>
          </Link>
          <Link to="/goals" className="group rounded-2xl border border-line bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-soft">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><Wallet size={19} /></span>
            <span className="mt-3 block text-sm font-semibold text-ink">Общие цели</span>
            <span className="mt-1 block text-xs text-muted">То, к чему идёте вместе</span>
          </Link>
        </div>
      </section>

      {plannedExpense > 0 && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warn-100 bg-warn-50 px-4 py-4 sm:px-5">
          <div>
            <div className="text-sm font-semibold text-ink">Запланированные платежи</div>
            <p className="mt-1 text-xs text-muted">Плановые суммы не попадут в расходы, пока вы не подтвердите оплату.</p>
          </div>
          <div className="text-xl font-semibold tracking-tight text-ink">{formatRubles(plannedExpense)}</div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="section-title">Последние операции</h2>
            <p className="mt-1 text-xs text-muted">Недавние движения семейного бюджета</p>
          </div>
          <Link to="/transactions" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium text-primary-800 transition-colors hover:bg-primary-50">
            Все операции <ArrowRight size={15} />
          </Link>
        </div>
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          {loading ? (
            <div className="px-4 py-10 text-center text-sm text-muted">Загружаем операции…</div>
          ) : recent.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-700"><Wallet size={22} /></div>
              <p className="mt-3 text-sm font-medium text-ink">Пока нет операций за этот месяц</p>
              <p className="mt-1 text-xs text-muted">Добавьте первую запись — и общая картина появится здесь.</p>
              <button onClick={() => openForm('expense')} className="btn-primary mt-4"><Plus size={16} /> Добавить расход</button>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {recent.map((t) => {
                const cat = t.category_id ? catMap.get(t.category_id) : null
                const isIncome = t.type === 'income'
                const isTransfer = t.type === 'transfer'
                const operationLabel = isTransfer
                  ? `${accountMap.get(t.account_id ?? '') ?? 'Счёт'} → ${accountMap.get(t.to_account_id ?? '') ?? 'Счёт'}`
                  : `${formatDateShort(t.operation_date)} · ${cat?.name ?? 'Без категории'}`
                return (
                  <div key={t.id} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-canvas/70 sm:px-5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-canvas text-lg">{cat?.icon ?? '•'}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{t.description || cat?.name || 'Операция'}</div>
                      <div className="mt-0.5 truncate text-xs text-muted">{operationLabel}</div>
                    </div>
                    <div className={`shrink-0 text-sm font-semibold tabular-nums ${isIncome ? 'text-accent-700' : isTransfer ? 'text-primary-700' : 'text-ink'}`}>
                      {isTransfer ? '⇄' : isIncome ? '+' : '−'} {formatRublesShort(t.amount_kopecks)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <TransactionForm open={showAdd} onClose={() => setShowAdd(false)} onSaved={load} categories={categories} accounts={accounts} userId={session?.user.id ?? null} initialType={newTransactionType} />
    </div>
  )
}
