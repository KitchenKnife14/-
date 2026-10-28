import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/googleSheets'
import type { Budget, Category, Transaction } from '../lib/types'
import { formatRubles } from '../lib/money'
import { monthRange, monthLabel, firstDayOfMonth } from '../lib/dates'
import Modal from '../components/Modal'
import { Plus, ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react'

export default function BudgetsPage() {
  const { family } = useAuth()
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [txs, setTxs] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() })
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Budget | null>(null)

  const monthDate = firstDayOfMonth(cursor.year, cursor.month)
  const range = useMemo(() => monthRange(cursor.year, cursor.month), [cursor])

  const load = async () => {
    if (!family) return
    setLoading(true); setError(null)
    try {
      const [bRes, cRes, tRes] = await Promise.all([
        supabase.from('budgets').select('*').eq('family_id', family.id).eq('month_date', monthDate),
        supabase.from('categories').select('*').eq('family_id', family.id).eq('archived', false),
        supabase.from('transactions').select('*').eq('family_id', family.id).eq('planned', false).eq('type', 'expense').gte('operation_date', range.start).lte('operation_date', range.end),
      ])
      if (bRes.error) throw bRes.error; if (cRes.error) throw cRes.error; if (tRes.error) throw tRes.error
      setBudgets(bRes.data as Budget[]); setCategories(cRes.data as Category[]); setTxs(tRes.data as Transaction[])
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка загрузки') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [family?.id, monthDate])
  useEffect(() => {
    if (!family) return
    const ch = supabase.channel('bud-page').on('postgres_changes', { event: '*', schema: 'public', table: 'budgets', filter: `family_id=eq.${family.id}` }, () => load()).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [family?.id])

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const spentByCat = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of txs) { if (t.category_id) m.set(t.category_id, (m.get(t.category_id) ?? 0) + t.amount_kopecks) }
    return m
  }, [txs])

  const totalLimit = budgets.reduce((s, b) => s + b.limit_kopecks, 0)
  const totalSpent = budgets.reduce((s, b) => s + (spentByCat.get(b.category_id) ?? 0), 0)
  const totalPct = totalLimit > 0 ? (totalSpent / totalLimit) * 100 : 0

  const remove = async (b: Budget) => { const { error: err } = await supabase.from('budgets').delete().eq('id', b.id); if (err) setError(err.message); load() }
  const prevMonth = () => setCursor((c) => ({ year: c.month === 0 ? c.year - 1 : c.year, month: c.month === 0 ? 11 : c.month - 1 }))
  const nextMonth = () => setCursor((c) => ({ year: c.month === 11 ? c.year + 1 : c.year, month: c.month === 11 ? 0 : c.month + 1 }))

  const getBarColor = (pct: number) => pct >= 100 ? 'bg-danger-500' : pct >= 90 ? 'bg-warn-500' : pct >= 75 ? 'bg-warn-400' : 'bg-primary-500'
  const getTextColor = (pct: number) => pct >= 100 ? 'text-danger-600' : pct >= 90 ? 'text-warn-600' : pct >= 75 ? 'text-warn-600' : 'text-slate-700'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Бюджеты</h1>
        <button onClick={() => { setEditing(null); setShowForm(true) }} className="btn-primary"><Plus size={18} /> Бюджет</button>
      </div>
      {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className="btn-ghost px-2"><ChevronLeft size={18} /></button>
        <div className="font-medium text-slate-700">{monthLabel(cursor.year, cursor.month)}</div>
        <button onClick={nextMonth} className="btn-ghost px-2"><ChevronRight size={18} /></button>
      </div>

      {budgets.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium text-slate-700">Общий бюджет</div>
            <div className={`text-sm font-semibold ${getTextColor(totalPct)}`}>{formatRubles(totalSpent)} / {formatRubles(totalLimit)}</div>
          </div>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${getBarColor(totalPct)}`} style={{ width: `${Math.min(totalPct, 100)}%` }} /></div>
          <div className={`text-xs mt-1 ${getTextColor(totalPct)}`}>{Math.round(totalPct)}% использовано</div>
        </div>
      )}

      {loading ? <div className="text-sm text-slate-400">Загрузка…</div> : budgets.length === 0 ? (
        <div className="card text-center py-8 text-sm text-slate-500">Бюджетов пока нет. Установите лимиты по категориям на месяц.</div>
      ) : (
        <div className="space-y-2">
          {budgets.map((b) => {
            const cat = catMap.get(b.category_id)
            const spent = spentByCat.get(b.category_id) ?? 0
            const pct = b.limit_kopecks > 0 ? (spent / b.limit_kopecks) * 100 : 0
            return (
              <div key={b.id} className="card">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2"><span className="text-lg">{cat?.icon ?? '📦'}</span><span className="text-sm font-medium text-slate-900">{cat?.name ?? 'Категория'}</span></div>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${getTextColor(pct)}`}>{formatRubles(spent)} / {formatRubles(b.limit_kopecks)}</span>
                    <button onClick={() => { setEditing(b); setShowForm(true) }} className="btn-ghost px-2"><Pencil size={14} /></button>
                    <button onClick={() => remove(b)} className="btn-ghost px-2 text-danger-600"><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${getBarColor(pct)}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                <div className={`text-xs mt-1 ${getTextColor(pct)}`}>{Math.round(pct)}%{pct >= 100 ? ' — превышено!' : pct >= 90 ? ' — почти превышено' : pct >= 75 ? ' — близко к лимиту' : ''}</div>
              </div>
            )
          })}
        </div>
      )}
      <BudgetForm open={showForm} onClose={() => { setShowForm(false); setEditing(null) }} onSaved={load} categories={categories} familyId={family?.id ?? null} monthDate={monthDate} editing={editing} />
    </div>
  )
}

function BudgetForm({ open, onClose, onSaved, categories, familyId, monthDate, editing }: {
  open: boolean; onClose: () => void; onSaved: () => void; categories: Category[]; familyId: string | null; monthDate: string; editing: Budget | null
}) {
  const [categoryId, setCategoryId] = useState('')
  const [limit, setLimit] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (editing) { setCategoryId(editing.category_id); setLimit((editing.limit_kopecks / 100).toString()) }
    else { setCategoryId(''); setLimit('') }
    setError(null)
  }, [editing, open])

  const expenseCats = categories.filter((c) => c.kind === 'expense' && !c.parent_id)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!familyId) return
    setError(null)
    if (!categoryId) { setError('Выберите категорию'); return }
    const limK = Math.round(parseFloat(limit.replace(',', '.')) * 100)
    if (!limK || limK <= 0) { setError('Введите лимит больше нуля'); return }
    setSaving(true)
    try {
      const payload = { family_id: familyId, category_id: categoryId, month_date: monthDate, limit_kopecks: limK, warn_75: true, warn_90: true, warn_100: true }
      if (editing) {
        const { error: err } = await supabase.from('budgets').update(payload).eq('id', editing.id)
        if (err) throw err
      } else {
        const { error: err } = await supabase.from('budgets').insert(payload)
        if (err) throw err
      }
      onSaved(); onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка сохранения') }
    finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Редактировать бюджет' : 'Новый бюджет'}>
      <form onSubmit={submit} className="space-y-3">
        <div><label className="label">Категория</label><select className="input" required value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!!editing}><option value="">Выберите…</option>{expenseCats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</select></div>
        <div><label className="label">Лимит на месяц, ₽</label><input className="input" type="number" step="0.01" min="0" required value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="10000" autoFocus /></div>
        {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
        <div className="flex gap-2 pt-1"><button type="button" onClick={onClose} className="btn-secondary flex-1">Отмена</button><button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Сохранение…' : 'Сохранить'}</button></div>
      </form>
    </Modal>
  )
}
