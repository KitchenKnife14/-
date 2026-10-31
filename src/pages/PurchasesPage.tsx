import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { googleSheets } from '../lib/googleSheets'
import type { PlannedPurchase, Category, Goal } from '../lib/types'
import { formatRubles } from '../lib/money'
import { formatDate, todayISO } from '../lib/dates'
import Modal from '../components/Modal'
import { Plus, Pencil, Trash2, ShoppingCart, Check, ExternalLink } from 'lucide-react'

const PRIORITY_LABELS: Record<number, string> = { 1: 'Критически необходимое', 2: 'Необходимое', 3: 'Важное', 4: 'Желательное', 5: 'Необязательное' }
const STATUS_LABELS: Record<string, string> = { planned: 'Запланировано', saving: 'Накопление', ready: 'Готово к покупке', bought: 'Куплено', postponed: 'Отложено', cancelled: 'Отменено' }
const STATUS_COLORS: Record<string, string> = { planned: 'bg-slate-100 text-slate-600', saving: 'bg-primary-50 text-primary-600', ready: 'bg-accent-50 text-accent-600', bought: 'bg-accent-100 text-accent-700', postponed: 'bg-warn-50 text-warn-600', cancelled: 'bg-danger-50 text-danger-600' }

type SortBy = 'date' | 'cost' | 'priority' | 'category'

export default function PurchasesPage() {
  const { family, session } = useAuth()
  const [items, setItems] = useState<PlannedPurchase[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<PlannedPurchase | null>(null)
  const [sortBy, setSortBy] = useState<SortBy>('date')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [buying, setBuying] = useState<PlannedPurchase | null>(null)

  const load = async () => {
    if (!family) return
    setLoading(true); setError(null)
    try {
      const [pRes, cRes, gRes] = await Promise.all([
        googleSheets.from('planned_purchases').select('*').eq('family_id', family.id).order('created_at', { ascending: false }),
        googleSheets.from('categories').select('*').eq('family_id', family.id).eq('archived', false),
        googleSheets.from('goals').select('*').eq('family_id', family.id),
      ])
      if (pRes.error) throw pRes.error; if (cRes.error) throw cRes.error; if (gRes.error) throw gRes.error
      setItems(pRes.data as PlannedPurchase[]); setCategories(cRes.data as Category[]); setGoals(gRes.data as Goal[])
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка загрузки') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [family?.id])
  useEffect(() => {
    if (!family) return
    const ch = googleSheets.channel('pp-page').on('postgres_changes', { event: '*', schema: 'public', table: 'planned_purchases', filter: `family_id=eq.${family.id}` }, () => load()).subscribe()
    return () => { googleSheets.removeChannel(ch) }
  }, [family?.id])

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const goalMap = useMemo(() => new Map(goals.map((g) => [g.id, g])), [goals])

  const filtered = items.filter((p) => statusFilter === 'all' || p.status === statusFilter)
  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'cost': return b.estimated_kopecks - a.estimated_kopecks
      case 'priority': return a.priority - b.priority
      case 'category': return (catMap.get(a.category_id ?? '')?.name ?? '').localeCompare(catMap.get(b.category_id ?? '')?.name ?? '')
      default: return (a.desired_date ?? a.desired_month ?? '9999').localeCompare(b.desired_date ?? b.desired_month ?? '9999')
    }
  })

  const totalEstimated = filtered.filter((p) => p.status !== 'bought' && p.status !== 'cancelled').reduce((s, p) => s + p.estimated_kopecks, 0)
  const remove = async (p: PlannedPurchase) => { const { error: err } = await googleSheets.from('planned_purchases').delete().eq('id', p.id); if (err) setError(err.message); load() }

  const confirmBuy = async () => {
    if (!buying || !family || !session?.user) return
    setError(null)
    try {
      const { error: buyError } = await googleSheets.rpc('confirm_planned_purchase', {
        p_purchase_id: buying.id,
        p_operation_date: todayISO(),
      })
      if (buyError) throw buyError
      setBuying(null)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка подтверждения покупки') }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Будущие покупки</h1>
        <button onClick={() => { setEditing(null); setShowForm(true) }} className="btn-primary"><Plus size={18} /> Добавить</button>
      </div>
      {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
      <div className="flex flex-wrap gap-2">
        <select className="input w-auto" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
          <option value="date">По сроку</option><option value="cost">По стоимости</option><option value="priority">По приоритету</option><option value="category">По категории</option>
        </select>
        <select className="input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">Все статусы</option>{Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {filtered.length > 0 && (
        <div className="card bg-primary-50 border-primary-100"><div className="text-sm text-primary-700">Общая стоимость запланированных покупок</div><div className="text-lg font-semibold text-slate-900 mt-1">{formatRubles(totalEstimated)}</div></div>
      )}
      {loading ? <div className="text-sm text-slate-400">Загрузка…</div> : sorted.length === 0 ? (
        <div className="card text-center py-8 text-sm text-slate-500">Покупок пока нет. Добавьте товары, которые планируете купить.</div>
      ) : (
        <div className="space-y-2">
          {sorted.map((p) => {
            const cat = p.category_id ? catMap.get(p.category_id) : null
            const goal = p.goal_id ? goalMap.get(p.goal_id) : null
            return (
              <div key={p.id} className={`card ${p.status === 'bought' || p.status === 'cancelled' ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className="text-xl w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0"><ShoppingCart size={16} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-900">{p.name}</span>
                      <span className={`badge ${STATUS_COLORS[p.status] ?? 'bg-slate-100 text-slate-600'}`}>{STATUS_LABELS[p.status] ?? p.status}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {cat?.name ?? 'Без категории'} · {PRIORITY_LABELS[p.priority] ?? `Приоритет ${p.priority}`}
                      {p.desired_date && ` · ${formatDate(p.desired_date)}`}
                      {p.desired_month && !p.desired_date && ` · ${formatDate(p.desired_month)}`}
                      {goal && ` · цель: ${goal.name}`}
                    </div>
                    {p.comment && <div className="text-xs text-slate-500 mt-1">{p.comment}</div>}
                    {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-600 inline-flex items-center gap-1 mt-1"><ExternalLink size={12} /> Ссылка на товар</a>}
                  </div>
                  <div className="text-sm font-semibold text-slate-900 flex-shrink-0">{formatRubles(p.estimated_kopecks)}</div>
                  <div className="flex gap-1 flex-shrink-0">
                    {p.status !== 'bought' && <button onClick={() => setBuying(p)} className="btn-ghost px-2 text-accent-600" title="Отметить купленным"><Check size={16} /></button>}
                    <button onClick={() => { setEditing(p); setShowForm(true) }} className="btn-ghost px-2" title="Изменить"><Pencil size={16} /></button>
                    <button onClick={() => remove(p)} className="btn-ghost px-2 text-danger-600" title="Удалить"><Trash2 size={16} /></button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <PurchaseForm open={showForm} onClose={() => { setShowForm(false); setEditing(null) }} onSaved={load} categories={categories} goals={goals} familyId={family?.id ?? null} userId={session?.user.id ?? null} editing={editing} />
      <Modal open={!!buying} onClose={() => setBuying(null)} title="Отметить как купленное?">
        <p className="text-sm text-slate-600 mb-2">Будет создан фактический расход на сумму <strong>{formatRubles(buying?.estimated_kopecks ?? 0)}</strong>. Покупка получит статус «Куплено».</p>
        <p className="text-xs text-slate-400 mb-4">Расход не будет учтён дважды — он заменит плановую стоимость, а не добавится поверх.</p>
        <div className="flex gap-2"><button onClick={() => setBuying(null)} className="btn-secondary flex-1">Отмена</button><button onClick={confirmBuy} className="btn-primary flex-1">Подтвердить покупку</button></div>
      </Modal>
    </div>
  )
}

function PurchaseForm({ open, onClose, onSaved, categories, goals, familyId, userId, editing }: {
  open: boolean; onClose: () => void; onSaved: () => void; categories: Category[]; goals: Goal[]; familyId: string | null; userId: string | null; editing: PlannedPurchase | null
}) {
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [estimated, setEstimated] = useState('')
  const [priority, setPriority] = useState('4')
  const [desiredMonth, setDesiredMonth] = useState('')
  const [desiredDate, setDesiredDate] = useState('')
  const [url, setUrl] = useState('')
  const [comment, setComment] = useState('')
  const [status, setStatus] = useState('planned')
  const [goalId, setGoalId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (editing) { setName(editing.name); setCategoryId(editing.category_id ?? ''); setEstimated((editing.estimated_kopecks / 100).toString()); setPriority(String(editing.priority)); setDesiredMonth(editing.desired_month ? editing.desired_month.slice(0, 7) : ''); setDesiredDate(editing.desired_date ?? ''); setUrl(editing.url); setComment(editing.comment); setStatus(editing.status); setGoalId(editing.goal_id ?? '') }
    else { setName(''); setCategoryId(''); setEstimated(''); setPriority('4'); setDesiredMonth(''); setDesiredDate(''); setUrl(''); setComment(''); setStatus('planned'); setGoalId('') }
    setError(null)
  }, [editing, open])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!familyId || !userId) return
    setError(null)
    const estK = Math.round(parseFloat(estimated.replace(',', '.')) * 100)
    if (!estK || estK <= 0) { setError('Введите стоимость больше нуля'); return }
    setSaving(true)
    try {
      const payload = {
        name: name.trim(), category_id: categoryId || null, estimated_kopecks: estK, priority: parseInt(priority),
        desired_month: desiredMonth ? desiredMonth + '-01' : null,
        desired_date: desiredDate || null, url: url.trim(), comment: comment.trim(), status, goal_id: goalId || null,
      }
      if (editing) {
        const { error: err } = await googleSheets.from('planned_purchases').update(payload).eq('id', editing.id)
        if (err) throw err
      } else {
        const { error: err } = await googleSheets.from('planned_purchases').insert({ ...payload, family_id: familyId, created_by: userId })
        if (err) throw err
      }
      onSaved(); onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка сохранения') }
    finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Редактировать покупку' : 'Новая покупка'}>
      <form onSubmit={submit} className="space-y-3">
        <div><label className="label">Название</label><input className="input" required value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
        <div><label className="label">Категория</label><select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">Без категории</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</select></div>
        <div><label className="label">Ориентировочная стоимость, ₽</label><input className="input" type="number" step="0.01" min="0" required value={estimated} onChange={(e) => setEstimated(e.target.value)} placeholder="5000" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Приоритет</label><select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="1">1 — Критически необходимое</option><option value="2">2 — Необходимое</option><option value="3">3 — Важное</option><option value="4">4 — Желательное</option><option value="5">5 — Необязательное</option></select></div>
          <div><label className="label">Статус</label><select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Желаемый месяц</label><input className="input" type="month" value={desiredMonth} onChange={(e) => setDesiredMonth(e.target.value)} /></div>
          <div><label className="label">Желаемая дата</label><input className="input" type="date" value={desiredDate} onChange={(e) => setDesiredDate(e.target.value)} /></div>
        </div>
        <div><label className="label">Ссылка на товар</label><input className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></div>
        <div><label className="label">Связанная финансовая цель</label><select className="input" value={goalId} onChange={(e) => setGoalId(e.target.value)}><option value="">Нет</option>{goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
        <div><label className="label">Комментарий</label><textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></div>
        {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
        <div className="flex gap-2 pt-1"><button type="button" onClick={onClose} className="btn-secondary flex-1">Отмена</button><button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Сохранение…' : 'Сохранить'}</button></div>
      </form>
    </Modal>
  )
}
