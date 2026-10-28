import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import type { RecurringPayment, Category } from '../lib/types'
import { formatRubles } from '../lib/money'
import { formatDate, todayISO } from '../lib/dates'
import Modal from '../components/Modal'
import { Plus, Check, Pause, Play, Trash2, Repeat } from 'lucide-react'

const FREQ_LABELS: Record<string, string> = { daily: 'Ежедневно', weekly: 'Еженедельно', monthly: 'Ежемесячно', yearly: 'Ежегодно', custom: 'По интервалу' }

export default function RecurringPage() {
  const { family, session } = useAuth()
  const [items, setItems] = useState<RecurringPayment[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [confirming, setConfirming] = useState<RecurringPayment | null>(null)

  const load = async () => {
    if (!family) return
    setLoading(true); setError(null)
    try {
      const [rRes, cRes] = await Promise.all([
        supabase.from('recurring_payments').select('*').eq('family_id', family.id).order('next_due_date', { ascending: true }),
        supabase.from('categories').select('*').eq('family_id', family.id).eq('archived', false),
      ])
      if (rRes.error) throw rRes.error; if (cRes.error) throw cRes.error
      setItems(rRes.data as RecurringPayment[]); setCategories(cRes.data as Category[])
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка загрузки') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [family?.id])
  useEffect(() => {
    if (!family) return
    const ch = supabase.channel('rec-page').on('postgres_changes', { event: '*', schema: 'public', table: 'recurring_payments', filter: `family_id=eq.${family.id}` }, () => load()).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [family?.id])

  const catMap = new Map(categories.map((c) => [c.id, c]))

  const confirmPayment = async () => {
    if (!confirming || !family || !session?.user) return
    setError(null)
    try {
      const { error: confirmError } = await supabase.rpc('confirm_recurring_payment', {
        p_recurring_id: confirming.id,
        p_expected_due_date: confirming.next_due_date,
        p_operation_date: todayISO(),
      })
      if (confirmError) throw confirmError
      setConfirming(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось подтвердить платёж')
    }
  }

  const toggleActive = async (r: RecurringPayment) => { const { error: err } = await supabase.from('recurring_payments').update({ active: !r.active }).eq('id', r.id); if (err) setError(err.message); load() }
  const remove = async (r: RecurringPayment) => { const { error: err } = await supabase.from('recurring_payments').delete().eq('id', r.id); if (err) setError(err.message); load() }

  const overdue = items.filter((r) => r.active && r.next_due_date < todayISO())
  const upcoming = items.filter((r) => r.active && r.next_due_date >= todayISO())
  const paused = items.filter((r) => !r.active)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Регулярные платежи</h1>
        <button onClick={() => setShowForm(true)} className="btn-primary"><Plus size={18} /> Добавить</button>
      </div>
      {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
      {overdue.length > 0 && <div className="card bg-warn-50 border-warn-100"><div className="text-sm font-medium text-warn-600">Просроченные платежи ({overdue.length})</div><div className="text-xs text-slate-500 mt-1">Подтвердите оплату, чтобы создать операцию и перенести дату.</div></div>}

      {loading ? <div className="text-sm text-slate-400">Загрузка…</div> : items.length === 0 ? (
        <div className="card text-center py-8 text-sm text-slate-500"><Repeat size={24} className="mx-auto mb-2 text-slate-300" />Регулярных платежей пока нет. Добавьте аренду, подписки и другие повторяющиеся расходы.</div>
      ) : (
        <div className="space-y-4">
          {overdue.length > 0 && <Section title="Просроченные" items={overdue} catMap={catMap} onConfirm={setConfirming} onToggle={toggleActive} onRemove={remove} highlight />}
          {upcoming.length > 0 && <Section title="Предстоящие" items={upcoming} catMap={catMap} onConfirm={setConfirming} onToggle={toggleActive} onRemove={remove} />}
          {paused.length > 0 && <Section title="Приостановленные" items={paused} catMap={catMap} onConfirm={setConfirming} onToggle={toggleActive} onRemove={remove} dim />}
        </div>
      )}
      <RecurringForm open={showForm} onClose={() => setShowForm(false)} onSaved={load} categories={categories} familyId={family?.id ?? null} userId={session?.user.id ?? null} />
      <Modal open={!!confirming} onClose={() => setConfirming(null)} title="Подтвердить платёж?">
        <p className="text-sm text-slate-600 mb-2">Будет создана операция на сумму <strong>{formatRubles(confirming?.amount_kopecks ?? 0)}</strong> за сегодня. Дата следующего платежа будет перенесена.</p>
        <p className="text-xs text-slate-400 mb-4">Платёж не дублируется автоматически — только ручное подтверждение.</p>
        <div className="flex gap-2"><button onClick={() => setConfirming(null)} className="btn-secondary flex-1">Отмена</button><button onClick={confirmPayment} className="btn-primary flex-1">Подтвердить</button></div>
      </Modal>
    </div>
  )
}

function Section({ title, items, catMap, onConfirm, onToggle, onRemove, highlight, dim }: {
  title: string; items: RecurringPayment[]; catMap: Map<string, Category>; onConfirm: (r: RecurringPayment) => void; onToggle: (r: RecurringPayment) => void; onRemove: (r: RecurringPayment) => void; highlight?: boolean; dim?: boolean
}) {
  return (
    <div>
      <h2 className="text-sm font-medium text-slate-500 mb-2">{title}</h2>
      <div className="space-y-2">
        {items.map((r) => {
          const cat = r.category_id ? catMap.get(r.category_id) : null
          return (
            <div key={r.id} className={`card ${highlight ? 'border-warn-200 bg-warn-50/30' : ''} ${dim ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-3">
                <div className="text-xl w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">{cat?.icon ?? '🔄'}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900">{r.description}</div>
                  <div className="text-xs text-slate-400">{cat?.name ?? 'Без категории'} · {FREQ_LABELS[r.frequency]} · до {formatDate(r.next_due_date)}{r.end_date ? ` · до ${formatDate(r.end_date)}` : ''}</div>
                </div>
                <div className="text-sm font-semibold text-slate-900 flex-shrink-0">{formatRubles(r.amount_kopecks)}</div>
                <div className="flex gap-1 flex-shrink-0">
                  {r.active && <button onClick={() => onConfirm(r)} className="btn-ghost px-2 text-accent-600" title="Подтвердить оплату"><Check size={16} /></button>}
                  <button onClick={() => onToggle(r)} className="btn-ghost px-2" title={r.active ? 'Пауза' : 'Возобновить'}>{r.active ? <Pause size={16} /> : <Play size={16} />}</button>
                  <button onClick={() => onRemove(r)} className="btn-ghost px-2 text-danger-600" title="Удалить"><Trash2 size={16} /></button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RecurringForm({ open, onClose, onSaved, categories, familyId, userId }: {
  open: boolean; onClose: () => void; onSaved: () => void; categories: Category[]; familyId: string | null; userId: string | null
}) {
  const [type, setType] = useState<'expense' | 'income'>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'>('monthly')
  const [customDays, setCustomDays] = useState('30')
  const [startDate, setStartDate] = useState(todayISO())
  const [endDate, setEndDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (open) { setType('expense'); setAmount(''); setCategoryId(''); setDescription(''); setFrequency('monthly'); setCustomDays('30'); setStartDate(todayISO()); setEndDate(''); setError(null) } }, [open])
  const visibleCats = categories.filter((c) => c.kind === type)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!familyId || !userId) return
    setError(null)
    const amt = Math.round(parseFloat(amount.replace(',', '.')) * 100)
    if (!amt || amt <= 0) { setError('Введите сумму больше нуля'); return }
    setSaving(true)
    try {
      const { error: err } = await supabase.from('recurring_payments').insert({
        family_id: familyId, type, amount_kopecks: amt, category_id: categoryId || null,
        description: description.trim(), start_date: startDate, end_date: endDate || null,
        frequency, custom_interval_days: frequency === 'custom' ? parseInt(customDays) : null,
        next_due_date: startDate, remind: true, active: true, created_by: userId,
      })
      if (err) throw err
      onSaved(); onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка сохранения') }
    finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Новый регулярный платёж">
      <form onSubmit={submit} className="space-y-3">
        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
          {(['expense', 'income'] as const).map((t) => <button key={t} type="button" onClick={() => setType(t)} className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${type === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{t === 'expense' ? 'Расход' : 'Доход'}</button>)}
        </div>
        <div><label className="label">Название</label><input className="input" required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Аренда, подписка…" autoFocus /></div>
        <div><label className="label">Сумма, ₽</label><input className="input" type="number" step="0.01" min="0" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" /></div>
        <div><label className="label">Категория</label><select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">Без категории</option>{visibleCats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</select></div>
        <div><label className="label">Частота</label><select className="input" value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}><option value="daily">Ежедневно</option><option value="weekly">Еженедельно</option><option value="monthly">Ежемесячно</option><option value="yearly">Ежегодно</option><option value="custom">По интервалу</option></select></div>
        {frequency === 'custom' && <div><label className="label">Интервал, дней</label><input className="input" type="number" min="1" required value={customDays} onChange={(e) => setCustomDays(e.target.value)} /></div>}
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Дата начала</label><input className="input" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
          <div><label className="label">Дата окончания</label><input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
        </div>
        {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
        <div className="flex gap-2 pt-1"><button type="button" onClick={onClose} className="btn-secondary flex-1">Отмена</button><button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Сохранение…' : 'Сохранить'}</button></div>
      </form>
    </Modal>
  )
}
