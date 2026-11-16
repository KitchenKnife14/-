import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/googleSheets'
import type { Goal, GoalContribution } from '../lib/types'
import { formatRubles } from '../lib/money'
import { formatDate, todayISO } from '../lib/dates'
import Modal from '../components/Modal'
import { Plus, Pencil, Trash2, Target, History, Pause, Play, Check } from 'lucide-react'

const STATUS_LABELS: Record<string, string> = { active: 'Активная', paused: 'Пауза', done: 'Достигнута', cancelled: 'Отменена' }
const STATUS_COLORS: Record<string, string> = { active: 'bg-primary-50 text-primary-600', paused: 'bg-warn-50 text-warn-600', done: 'bg-accent-50 text-accent-600', cancelled: 'bg-danger-50 text-danger-600' }

export default function GoalsPage() {
  const { family } = useAuth()
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Goal | null>(null)
  const [contribGoal, setContribGoal] = useState<Goal | null>(null)
  const [historyGoal, setHistoryGoal] = useState<Goal | null>(null)
  const [contributions, setContributions] = useState<GoalContribution[]>([])

  const load = async () => {
    if (!family) return
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await supabase.from('goals').select('*').eq('family_id', family.id).order('created_at', { ascending: false })
      if (err) throw err
      setGoals(data as Goal[])
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка загрузки') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [family?.id])
  useEffect(() => {
    if (!family) return
    const ch = supabase.channel('goals-page').on('postgres_changes', { event: '*', schema: 'public', table: 'goals', filter: `family_id=eq.${family.id}` }, () => load()).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [family?.id])

  const remove = async (g: Goal) => { const { error: err } = await supabase.from('goals').delete().eq('id', g.id); if (err) setError(err.message); load() }
  const toggleStatus = async (g: Goal) => {
    const newStatus = g.status === 'active' ? 'paused' : g.status === 'paused' ? 'active' : g.status
    if (newStatus === g.status) return
    const { error: err } = await supabase.from('goals').update({ status: newStatus }).eq('id', g.id)
    if (err) setError(err.message); load()
  }
  const markDone = async (g: Goal) => { const { error: err } = await supabase.from('goals').update({ status: 'done' }).eq('id', g.id); if (err) setError(err.message); load() }

  const showHistory = async (g: Goal) => {
    setHistoryGoal(g)
    const { data, error: err } = await supabase.from('goal_contributions').select('*').eq('goal_id', g.id).order('contribution_date', { ascending: false })
    if (err) { setError(err.message); return }
    setContributions(data as GoalContribution[])
  }

  const totalTarget = goals.filter((g) => g.status === 'active').reduce((s, g) => s + g.target_kopecks, 0)
  const totalSaved = goals.filter((g) => g.status === 'active').reduce((s, g) => s + g.saved_kopecks, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Финансовые цели</h1>
        <button onClick={() => { setEditing(null); setShowForm(true) }} className="btn-primary"><Plus size={18} /> Цель</button>
      </div>
      {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
      {goals.filter((g) => g.status === 'active').length > 0 && (
        <div className="card bg-primary-50 border-primary-100">
          <div className="text-sm text-primary-700">Общий прогресс по активным целям</div>
          <div className="text-lg font-semibold text-slate-900 mt-1">{formatRubles(totalSaved)} / {formatRubles(totalTarget)}</div>
          <div className="h-2 bg-white/50 rounded-full overflow-hidden mt-2"><div className="h-full bg-primary-500 rounded-full" style={{ width: `${totalTarget > 0 ? Math.min((totalSaved / totalTarget) * 100, 100) : 0}%` }} /></div>
        </div>
      )}
      {loading ? <div className="text-sm text-slate-400">Загрузка…</div> : goals.length === 0 ? (
        <div className="card text-center py-8 text-sm text-slate-500"><Target size={24} className="mx-auto mb-2 text-slate-300" />Целей пока нет. Создайте первую — например, отпуск или накопление на покупку.</div>
      ) : (
        <div className="space-y-2">
          {goals.map((g) => {
            const pct = g.target_kopecks > 0 ? (g.saved_kopecks / g.target_kopecks) * 100 : 0
            const remaining = g.target_kopecks - g.saved_kopecks
            const monthsLeft = g.target_date ? Math.max(1, Math.round((new Date(g.target_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24 * 30))) : null
            const monthlyNeeded = monthsLeft && monthsLeft > 0 ? Math.round(remaining / monthsLeft) : null
            return (
              <div key={g.id} className={`card ${g.status === 'done' || g.status === 'cancelled' ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className="text-xl w-9 h-9 rounded-full bg-primary-50 flex items-center justify-center flex-shrink-0"><Target size={16} className="text-primary-600" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-900">{g.name}</span>
                      <span className={`badge ${STATUS_COLORS[g.status]}`}>{STATUS_LABELS[g.status]}</span>
                    </div>
                    {g.description && <div className="text-xs text-slate-400 mt-0.5">{g.description}</div>}
                    <div className="text-xs text-slate-400 mt-0.5">{formatRubles(g.saved_kopecks)} / {formatRubles(g.target_kopecks)}{g.target_date && ` · до ${formatDate(g.target_date)}`}</div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden mt-2"><div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-slate-500">{Math.round(pct)}%</span>
                      {monthlyNeeded && remaining > 0 && g.status === 'active' && <span className="text-xs text-slate-500">Нужно: {formatRubles(monthlyNeeded)}/мес</span>}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {g.status === 'active' && <button onClick={() => setContribGoal(g)} className="btn-ghost px-2 text-accent-600" title="Пополнить"><Plus size={16} /></button>}
                    <button onClick={() => showHistory(g)} className="btn-ghost px-2" title="История"><History size={16} /></button>
                    {g.status === 'active' && <button onClick={() => toggleStatus(g)} className="btn-ghost px-2" title="Пауза"><Pause size={16} /></button>}
                    {g.status === 'paused' && <button onClick={() => toggleStatus(g)} className="btn-ghost px-2" title="Возобновить"><Play size={16} /></button>}
                    {g.status !== 'done' && remaining <= 0 && <button onClick={() => markDone(g)} className="btn-ghost px-2 text-accent-600" title="Отметить достигнутой"><Check size={16} /></button>}
                    <button onClick={() => { setEditing(g); setShowForm(true) }} className="btn-ghost px-2" title="Изменить"><Pencil size={16} /></button>
                    <button onClick={() => remove(g)} className="btn-ghost px-2 text-danger-600" title="Удалить"><Trash2 size={16} /></button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <GoalForm open={showForm} onClose={() => { setShowForm(false); setEditing(null) }} onSaved={load} familyId={family?.id ?? null} editing={editing} />
      <ContributionModal goal={contribGoal} onClose={() => setContribGoal(null)} onSaved={load} />
      <HistoryModal goal={historyGoal} contributions={contributions} onClose={() => setHistoryGoal(null)} />
    </div>
  )
}

function GoalForm({ open, onClose, onSaved, familyId, editing }: {
  open: boolean; onClose: () => void; onSaved: () => void; familyId: string | null; editing: Goal | null
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [target, setTarget] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [priority, setPriority] = useState('3')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (editing) { setName(editing.name); setDescription(editing.description); setTarget((editing.target_kopecks / 100).toString()); setTargetDate(editing.target_date ?? ''); setPriority(String(editing.priority)) }
    else { setName(''); setDescription(''); setTarget(''); setTargetDate(''); setPriority('3') }
    setError(null)
  }, [editing, open])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!familyId) return
    setError(null)
    const targetK = Math.round(parseFloat(target.replace(',', '.')) * 100)
    if (!targetK || targetK <= 0) { setError('Введите сумму цели больше нуля'); return }
    setSaving(true)
    try {
      const payload = { name: name.trim(), description: description.trim(), target_kopecks: targetK, target_date: targetDate || null, priority: parseInt(priority) }
      if (editing) {
        const { error: err } = await supabase.from('goals').update(payload).eq('id', editing.id)
        if (err) throw err
      } else {
        const { error: err } = await supabase.from('goals').insert({ ...payload, family_id: familyId, saved_kopecks: 0, status: 'active' })
        if (err) throw err
      }
      onSaved(); onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка сохранения') }
    finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Редактировать цель' : 'Новая цель'}>
      <form onSubmit={submit} className="space-y-3">
        <div><label className="label">Название</label><input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Отпуск, машина…" autoFocus /></div>
        <div><label className="label">Описание</label><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div><label className="label">Сумма цели, ₽</label><input className="input" type="number" step="0.01" min="0" required value={target} onChange={(e) => setTarget(e.target.value)} placeholder="100000" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Целевая дата</label><input className="input" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} /></div>
          <div><label className="label">Приоритет</label><select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="1">1 — Высокий</option><option value="2">2</option><option value="3">3 — Средний</option><option value="4">4</option><option value="5">5 — Низкий</option></select></div>
        </div>
        {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
        <div className="flex gap-2 pt-1"><button type="button" onClick={onClose} className="btn-secondary flex-1">Отмена</button><button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Сохранение…' : 'Сохранить'}</button></div>
      </form>
    </Modal>
  )
}

function ContributionModal({ goal, onClose, onSaved }: { goal: Goal | null; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (goal) { setAmount(''); setDate(todayISO()); setNote(''); setError(null) } }, [goal])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!goal) return
    setError(null)
    const amt = Math.round(parseFloat(amount.replace(',', '.')) * 100)
    if (!amt || amt === 0) { setError('Введите сумму'); return }
    setSaving(true)
    try {
      const { data: prof } = await supabase.auth.getUser()
      const { error: err } = await supabase.from('goal_contributions').insert({
        goal_id: goal.id, amount_kopecks: amt, contribution_date: date, note: note.trim(), created_by: prof.user?.id ?? null,
      })
      if (err) throw err
      onSaved(); onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка сохранения') }
    finally { setSaving(false) }
  }

  return (
    <Modal open={!!goal} onClose={onClose} title={`Пополнить: ${goal?.name ?? ''}`}>
      <form onSubmit={submit} className="space-y-3">
        <div><label className="label">Сумма, ₽ (минус для снятия)</label><input className="input" type="number" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" autoFocus /></div>
        <div><label className="label">Дата</label><input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><label className="label">Комментарий</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
        <div className="flex gap-2 pt-1"><button type="button" onClick={onClose} className="btn-secondary flex-1">Отмена</button><button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Сохранение…' : 'Пополнить'}</button></div>
      </form>
    </Modal>
  )
}

function HistoryModal({ goal, contributions, onClose }: { goal: Goal | null; contributions: GoalContribution[]; onClose: () => void }) {
  return (
    <Modal open={!!goal} onClose={onClose} title={`История пополнений: ${goal?.name ?? ''}`}>
      {contributions.length === 0 ? <p className="text-sm text-slate-500">Пополнений пока нет.</p> : (
        <div className="space-y-2">
          {contributions.map((c) => (
            <div key={c.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
              <div><div className="text-sm text-slate-700">{formatDate(c.contribution_date)}</div>{c.note && <div className="text-xs text-slate-400">{c.note}</div>}</div>
              <div className={`text-sm font-medium ${c.amount_kopecks >= 0 ? 'text-accent-600' : 'text-danger-600'}`}>{c.amount_kopecks >= 0 ? '+' : '−'} {formatRubles(Math.abs(c.amount_kopecks))}</div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
