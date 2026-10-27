import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import type { Transaction, Category, RecurringPayment } from '../lib/types'
import { formatRubles, formatRublesShort } from '../lib/money'
import { formatDate, formatDateShort, formatDateLong, monthRange, monthLabel, todayISO } from '../lib/dates'
import { ChevronLeft, ChevronRight, Calendar as CalIcon } from 'lucide-react'
import { ru } from 'date-fns/locale'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, addDays, parseISO } from 'date-fns'

type View = 'month' | 'week' | 'day' | 'list'
type TxFilter = 'all' | 'income' | 'expense'

export default function CalendarPage() {
  const { family } = useAuth()
  const [txs, setTxs] = useState<Transaction[]>([])
  const [recurring, setRecurring] = useState<RecurringPayment[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('month')
  const [filter, setFilter] = useState<TxFilter>('all')
  const [cursor, setCursor] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState<Date>(new Date())

  const range = useMemo(() => monthRange(cursor.getFullYear(), cursor.getMonth()), [cursor])

  const load = async () => {
    if (!family) return
    setLoading(true); setError(null)
    try {
      const [tRes, rRes, cRes] = await Promise.all([
        supabase.from('transactions').select('*').eq('family_id', family.id).gte('operation_date', range.start).lte('operation_date', range.end).order('operation_date', { ascending: true }),
        supabase.from('recurring_payments').select('*').eq('family_id', family.id).eq('active', true),
        supabase.from('categories').select('*').eq('family_id', family.id).eq('archived', false),
      ])
      if (tRes.error) throw tRes.error; if (rRes.error) throw rRes.error; if (cRes.error) throw cRes.error
      setTxs(tRes.data as Transaction[]); setRecurring(rRes.data as RecurringPayment[]); setCategories(cRes.data as Category[])
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка загрузки') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [family?.id, range.start, range.end])
  useEffect(() => {
    if (!family) return
    const ch = supabase.channel('cal-page').on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `family_id=eq.${family.id}` }, () => load()).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [family?.id])

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const filteredTxs = txs.filter((t) => {
    if (filter === 'all') return true
    if (filter === 'income') return t.type === 'income'
    return t.type === 'expense'
  })

  const txsByDate = useMemo(() => {
    const m = new Map<string, Transaction[]>()
    for (const t of filteredTxs) {
      const key = t.operation_date
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(t)
    }
    return m
  }, [filteredTxs])

  const recurringByDate = useMemo(() => {
    const m = new Map<string, RecurringPayment[]>()
    for (const r of recurring) {
      const start = parseISO(range.start)
      const end = parseISO(range.end)
      let d = parseISO(r.next_due_date)
      if (d < start) d = start
      while (d <= end) {
        const key = format(d, 'yyyy-MM-dd')
        if (!m.has(key)) m.set(key, [])
        m.get(key)!.push(r)
        if (r.frequency === 'daily') d = addDays(d, 1)
        else if (r.frequency === 'weekly') d = addDays(d, 7)
        else if (r.frequency === 'monthly') d = new Date(d.getFullYear(), d.getMonth() + 1, d.getDate())
        else if (r.frequency === 'yearly') d = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate())
        else if (r.frequency === 'custom') d = addDays(d, r.custom_interval_days ?? 30)
        else break
      }
    }
    return m
  }, [recurring, range])

  const daySum = (date: string) => {
    const dayTxs = txsByDate.get(date) ?? []
    const income = dayTxs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount_kopecks, 0)
    const expense = dayTxs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount_kopecks, 0)
    return { income, expense, net: income - expense }
  }

  const prev = () => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
  const next = () => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 })
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 })
    return eachDayOfInterval({ start, end })
  }, [cursor])

  const weekDays = useMemo(() => {
    const start = startOfWeek(cursor, { weekStartsOn: 1 })
    const end = endOfWeek(cursor, { weekStartsOn: 1 })
    return eachDayOfInterval({ start, end })
  }, [cursor])

  const selectedDayTxs = txsByDate.get(format(selectedDay, 'yyyy-MM-dd')) ?? []
  const selectedDayRecurring = recurringByDate.get(format(selectedDay, 'yyyy-MM-dd')) ?? []
  const selectedDaySum = daySum(format(selectedDay, 'yyyy-MM-dd'))

  const listDays = useMemo(() => {
    const days: { date: string; txs: Transaction[]; recurring: RecurringPayment[] }[] = []
    for (const t of filteredTxs) {
      const existing = days.find((d) => d.date === t.operation_date)
      if (existing) existing.txs.push(t)
      else days.push({ date: t.operation_date, txs: [t], recurring: recurringByDate.get(t.operation_date) ?? [] })
    }
    for (const [date, recs] of recurringByDate) {
      if (!days.find((d) => d.date === date)) days.push({ date, txs: [], recurring: recs })
    }
    return days.sort((a, b) => b.date.localeCompare(a.date))
  }, [filteredTxs, recurringByDate])

  const renderDayCell = (day: Date) => {
    const dateStr = format(day, 'yyyy-MM-dd')
    const dayTxs = txsByDate.get(dateStr) ?? []
    const dayRecs = recurringByDate.get(dateStr) ?? []
    const sum = daySum(dateStr)
    const inMonth = isSameMonth(day, cursor)
    const isToday = isSameDay(day, new Date())
    return (
      <button key={dateStr} onClick={() => { setSelectedDay(day); setView('day') }}
        className={`min-h-[72px] p-1.5 rounded-lg border text-left transition-colors ${isToday ? 'border-primary-400 bg-primary-50/50' : 'border-slate-100 hover:bg-slate-50'} ${!inMonth ? 'opacity-40' : ''}`}>
        <div className="text-xs font-medium text-slate-600">{format(day, 'd')}</div>
        {sum.net !== 0 && <div className={`text-[10px] font-medium ${sum.net > 0 ? 'text-accent-600' : 'text-danger-600'}`}>{formatRublesShort(sum.net)}</div>}
        {dayTxs.length > 0 && <div className="flex gap-0.5 mt-0.5">{dayTxs.slice(0, 3).map((t) => <span key={t.id} className={`w-1.5 h-1.5 rounded-full ${t.type === 'income' ? 'bg-accent-500' : 'bg-danger-500'}`} />)}</div>}
        {dayRecs.length > 0 && <div className="text-[10px] text-warn-500 mt-0.5">⟳</div>}
      </button>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Финансовый календарь</h1>
        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
          {(['month', 'week', 'day', 'list'] as View[]).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{v === 'month' ? 'Месяц' : v === 'week' ? 'Неделя' : v === 'day' ? 'День' : 'Список'}</button>
          ))}
        </div>
      </div>
      {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
      <div className="flex items-center justify-between">
        <button onClick={prev} className="btn-ghost px-2"><ChevronLeft size={18} /></button>
        <div className="font-medium text-slate-700">{monthLabel(cursor.getFullYear(), cursor.getMonth())}</div>
        <button onClick={next} className="btn-ghost px-2"><ChevronRight size={18} /></button>
      </div>
      <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        {(['all', 'income', 'expense'] as TxFilter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${filter === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{f === 'all' ? 'Все' : f === 'income' ? 'Доходы' : 'Расходы'}</button>
        ))}
      </div>

      {loading ? <div className="text-sm text-slate-400">Загрузка…</div> : (
        <>
          {view === 'month' && (
            <div className="grid grid-cols-7 gap-1">
              {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => <div key={d} className="text-center text-xs font-medium text-slate-400 py-1">{d}</div>)}
              {monthDays.map(renderDayCell)}
            </div>
          )}
          {view === 'week' && (
            <div className="grid grid-cols-7 gap-1">
              {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => <div key={d} className="text-center text-xs font-medium text-slate-400 py-1">{d}</div>)}
              {weekDays.map(renderDayCell)}
            </div>
          )}
          {view === 'day' && (
            <div className="space-y-3">
              <div className="card">
                <div className="text-sm font-medium text-slate-700">{formatDateLong(format(selectedDay, 'yyyy-MM-dd'))}</div>
                <div className="grid grid-cols-3 gap-2 mt-2 text-sm">
                  <div><div className="text-xs text-slate-400">Доходы</div><div className="font-medium text-accent-600">{formatRubles(selectedDaySum.income)}</div></div>
                  <div><div className="text-xs text-slate-400">Расходы</div><div className="font-medium text-danger-600">{formatRubles(selectedDaySum.expense)}</div></div>
                  <div><div className="text-xs text-slate-400">Итог</div><div className={`font-medium ${selectedDaySum.net >= 0 ? 'text-accent-600' : 'text-danger-600'}`}>{formatRubles(selectedDaySum.net)}</div></div>
                </div>
              </div>
              {selectedDayRecurring.length > 0 && (
                <div className="card">
                  <div className="text-sm font-medium text-slate-700 mb-2">Регулярные платежи</div>
                  {selectedDayRecurring.map((r) => (
                    <div key={r.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                      <div className="text-sm text-slate-600">⟳ {r.description}</div>
                      <div className="text-sm font-medium text-slate-900">{formatRubles(r.amount_kopecks)}</div>
                    </div>
                  ))}
                </div>
              )}
              {selectedDayTxs.length === 0 && selectedDayRecurring.length === 0 ? (
                <div className="card text-center py-8 text-sm text-slate-500"><CalIcon size={20} className="mx-auto mb-2 text-slate-300" />Нет операций в этот день.</div>
              ) : (
                <div className="space-y-2">
                  {selectedDayTxs.map((t) => {
                    const cat = t.category_id ? catMap.get(t.category_id) : null
                    const isIncome = t.type === 'income'
                    return (
                      <div key={t.id} className="card flex items-center gap-3 py-3">
                        <div className="text-xl w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center">{cat?.icon ?? '📝'}</div>
                        <div className="flex-1 min-w-0"><div className="text-sm font-medium text-slate-900 truncate">{t.description || cat?.name || 'Операция'}</div><div className="text-xs text-slate-400">{cat?.name ?? 'Без категории'}</div></div>
                        <div className={`text-sm font-semibold ${isIncome ? 'text-accent-600' : 'text-slate-900'}`}>{isIncome ? '+' : '−'} {formatRublesShort(t.amount_kopecks)}</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          {view === 'list' && (
            <div className="space-y-3">
              {listDays.length === 0 ? <div className="card text-center py-8 text-sm text-slate-500">Нет операций за месяц.</div> : listDays.map((d) => {
                const sum = daySum(d.date)
                return (
                  <div key={d.date}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-sm font-medium text-slate-700">{formatDate(d.date)}</div>
                      <div className={`text-xs font-medium ${sum.net >= 0 ? 'text-accent-600' : 'text-danger-600'}`}>{formatRublesShort(sum.net)}</div>
                    </div>
                    <div className="space-y-1">
                      {d.recurring.map((r) => <div key={r.id} className="card flex items-center justify-between py-2 bg-warn-50/50"><div className="text-sm text-slate-600">⟳ {r.description}</div><div className="text-sm font-medium text-slate-900">{formatRubles(r.amount_kopecks)}</div></div>)}
                      {d.txs.map((t) => {
                        const cat = t.category_id ? catMap.get(t.category_id) : null
                        const isIncome = t.type === 'income'
                        return <div key={t.id} className="card flex items-center gap-3 py-2"><div className="text-lg w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">{cat?.icon ?? '📝'}</div><div className="flex-1 min-w-0"><div className="text-sm text-slate-900 truncate">{t.description || cat?.name || 'Операция'}</div></div><div className={`text-sm font-medium ${isIncome ? 'text-accent-600' : 'text-slate-900'}`}>{isIncome ? '+' : '−'} {formatRublesShort(t.amount_kopecks)}</div></div>
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
