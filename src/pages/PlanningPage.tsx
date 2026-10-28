import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/googleSheets'
import type { MonthlyPlan, Category, Transaction } from '../lib/types'
import { formatRubles } from '../lib/money'
import { monthRange, monthLabel, firstDayOfMonth } from '../lib/dates'
import Modal from '../components/Modal'
import { Plus, ChevronLeft, ChevronRight, Copy, Trash2 } from 'lucide-react'

const TYPE_LABELS: Record<string, string> = { income: 'Доход', expense: 'Расход', savings: 'Накопления' }

export default function PlanningPage() {
  const { family } = useAuth()
  const [plans, setPlans] = useState<MonthlyPlan[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [txs, setTxs] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() })
  const [showForm, setShowForm] = useState(false)

  const monthDate = firstDayOfMonth(cursor.year, cursor.month)
  const range = useMemo(() => monthRange(cursor.year, cursor.month), [cursor])
  const prevMonthDate = firstDayOfMonth(cursor.month === 0 ? cursor.year - 1 : cursor.year, cursor.month === 0 ? 11 : cursor.month - 1)

  const load = async () => {
    if (!family) return
    setLoading(true); setError(null)
    try {
      const [pRes, cRes, tRes] = await Promise.all([
        supabase.from('monthly_plans').select('*').eq('family_id', family.id).eq('month_date', monthDate),
        supabase.from('categories').select('*').eq('family_id', family.id).eq('archived', false),
        supabase.from('transactions').select('*').eq('family_id', family.id).eq('planned', false).gte('operation_date', range.start).lte('operation_date', range.end),
      ])
      if (pRes.error) throw pRes.error; if (cRes.error) throw cRes.error; if (tRes.error) throw tRes.error
      setPlans(pRes.data as MonthlyPlan[]); setCategories(cRes.data as Category[]); setTxs(tRes.data as Transaction[])
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка загрузки') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [family?.id, monthDate])
  useEffect(() => {
    if (!family) return
    const ch = supabase.channel('plan-page').on('postgres_changes', { event: '*', schema: 'public', table: 'monthly_plans', filter: `family_id=eq.${family.id}` }, () => load()).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [family?.id])

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const factByCatAndType = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of txs) {
      if (t.type === 'transfer' || !t.category_id) continue
      const key = `${t.type}:${t.category_id}`
      m.set(key, (m.get(key) ?? 0) + t.amount_kopecks)
    }
    return m
  }, [txs])

  const planIncome = plans.filter((p) => p.type === 'income').reduce((s, p) => s + p.planned_kopecks, 0)
  const planExpense = plans.filter((p) => p.type === 'expense').reduce((s, p) => s + p.planned_kopecks, 0)
  const planSavings = plans.filter((p) => p.type === 'savings').reduce((s, p) => s + p.planned_kopecks, 0)
  const factIncome = txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount_kopecks, 0)
  const factExpense = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount_kopecks, 0)

  const prevMonth = () => setCursor((c) => ({ year: c.month === 0 ? c.year - 1 : c.year, month: c.month === 0 ? 11 : c.month - 1 }))
  const nextMonth = () => setCursor((c) => ({ year: c.month === 11 ? c.year + 1 : c.year, month: c.month === 11 ? 0 : c.month + 1 }))

  const copyFromPrev = async () => {
    if (!family) return
    const { data: prevPlans, error } = await supabase.from('monthly_plans').select('*').eq('family_id', family.id).eq('month_date', prevMonthDate)
    if (error) { setError(error.message); return }
    if (!prevPlans || prevPlans.length === 0) { setError('В предыдущем месяце нет планов для копирования'); return }
    for (const p of prevPlans as MonthlyPlan[]) {
      const { error: copyError } = await supabase.from('monthly_plans').upsert({
        family_id: family.id, month_date: monthDate, category_id: p.category_id, type: p.type, planned_kopecks: p.planned_kopecks, note: p.note,
      }, { onConflict: 'family_id,month_date,category_id,type' })
      if (copyError) {
        setError(`Не удалось скопировать план «${TYPE_LABELS[p.type]}»: ${copyError.message}`)
        await load()
        return
      }
    }
    await load()
  }

  const removePlan = async (p: MonthlyPlan) => { const { error: err } = await supabase.from('monthly_plans').delete().eq('id', p.id); if (err) setError(err.message); load() }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Месячное планирование</h1>
        <div className="flex gap-2">
          <button onClick={copyFromPrev} className="btn-secondary"><Copy size={16} /> Из предыдущего</button>
          <button onClick={() => setShowForm(true)} className="btn-primary"><Plus size={18} /> План</button>
        </div>
      </div>
      {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className="btn-ghost px-2"><ChevronLeft size={18} /></button>
        <div className="font-medium text-slate-700">{monthLabel(cursor.year, cursor.month)}</div>
        <button onClick={nextMonth} className="btn-ghost px-2"><ChevronRight size={18} /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card"><div className="text-sm text-slate-500">Доходы: план / факт</div><div className="text-lg font-semibold text-slate-900 mt-1">{formatRubles(planIncome)}</div><div className="text-xs text-accent-600">{formatRubles(factIncome)}</div></div>
        <div className="card"><div className="text-sm text-slate-500">Расходы: план / факт</div><div className="text-lg font-semibold text-slate-900 mt-1">{formatRubles(planExpense)}</div><div className="text-xs text-danger-600">{formatRubles(factExpense)}</div></div>
        <div className="card"><div className="text-sm text-slate-500">Ожидаемый остаток</div><div className={`text-lg font-semibold mt-1 ${planIncome - planExpense - planSavings >= 0 ? 'text-slate-900' : 'text-danger-600'}`}>{formatRubles(planIncome - planExpense - planSavings)}</div><div className="text-xs text-slate-400">Плановые накопления: {formatRubles(planSavings)}</div></div>
      </div>
      <div className="card">
        <div className="text-sm font-medium text-slate-700 mb-3">Сравнение плана и факта по категориям</div>
        {plans.length === 0 ? <p className="text-sm text-slate-500">Планов на этот месяц нет. Добавьте плановые доходы и расходы.</p> : (
          <div className="space-y-2">
            {plans.map((p) => {
              const cat = p.category_id ? catMap.get(p.category_id) : null
              const fact = p.category_id && (p.type === 'income' || p.type === 'expense') ? factByCatAndType.get(`${p.type}:${p.category_id}`) ?? 0 : 0
              const dev = p.type === 'income' ? fact - p.planned_kopecks : p.planned_kopecks - fact
              return (
                <div key={p.id} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                  <div className="text-lg w-7">{cat?.icon ?? '📋'}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-900 truncate">{cat?.name ?? 'Без категории'} <span className="text-xs text-slate-400">({TYPE_LABELS[p.type]})</span></div>
                    {p.note && <div className="text-xs text-slate-400 truncate">{p.note}</div>}
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-slate-700">План: {formatRubles(p.planned_kopecks)}</div>
                    <div className="text-xs text-slate-500">Факт: {formatRubles(fact)}</div>
                    <div className={`text-xs ${dev >= 0 ? 'text-accent-600' : 'text-danger-600'}`}>Откл: {dev >= 0 ? '+' : '−'}{formatRubles(Math.abs(dev))}</div>
                  </div>
                  <button onClick={() => removePlan(p)} className="btn-ghost px-2 text-danger-600"><Trash2 size={14} /></button>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <PlanForm open={showForm} onClose={() => setShowForm(false)} onSaved={load} categories={categories} familyId={family?.id ?? null} monthDate={monthDate} />
    </div>
  )
}

function PlanForm({ open, onClose, onSaved, categories, familyId, monthDate }: {
  open: boolean; onClose: () => void; onSaved: () => void; categories: Category[]; familyId: string | null; monthDate: string
}) {
  const [type, setType] = useState<'income' | 'expense' | 'savings'>('expense')
  const [categoryId, setCategoryId] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (open) { setType('expense'); setCategoryId(''); setAmount(''); setNote(''); setError(null) } }, [open])
  const visibleCats = categories.filter((c) => !c.archived)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!familyId) return
    setError(null)
    const amtK = Math.round(parseFloat(amount.replace(',', '.')) * 100)
    if (!amtK || amtK <= 0) { setError('Введите сумму больше нуля'); return }
    setSaving(true)
    try {
      const { error: err } = await supabase.from('monthly_plans').upsert({
        family_id: familyId, month_date: monthDate, category_id: categoryId || null, type, planned_kopecks: amtK, note: note.trim(),
      }, { onConflict: 'family_id,month_date,category_id,type' })
      if (err) throw err
      onSaved(); onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка сохранения') }
    finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Новая плановая строка">
      <form onSubmit={submit} className="space-y-3">
        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
          {(['income', 'expense', 'savings'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setType(t)} className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${type === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{t === 'income' ? 'Доход' : t === 'expense' ? 'Расход' : 'Накопления'}</button>
          ))}
        </div>
        <div><label className="label">Категория</label><select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">Без категории</option>{visibleCats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</select></div>
        <div><label className="label">Плановая сумма, ₽</label><input className="input" type="number" step="0.01" min="0" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus /></div>
        <div><label className="label">Заметка</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
        <div className="flex gap-2 pt-1"><button type="button" onClick={onClose} className="btn-secondary flex-1">Отмена</button><button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Сохранение…' : 'Сохранить'}</button></div>
      </form>
    </Modal>
  )
}
