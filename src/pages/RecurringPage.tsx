import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { googleSheets } from '../lib/googleSheets'
import { ensureSupplementalCategories } from '../lib/categories'
import type { RecurringPayment, Category, Account, FamilyMember, Profile } from '../lib/types'
import { formatRubles, parseRublesToKopecks } from '../lib/money'
import { formatDate, todayISO } from '../lib/dates'
import Modal from '../components/Modal'
import { Plus, Check, Pause, Play, Trash2, Repeat } from 'lucide-react'

const FREQ_LABELS: Record<string, string> = { daily: 'Ежедневно', weekly: 'Еженедельно', monthly: 'Ежемесячно', yearly: 'Ежегодно', custom: 'По интервалу' }

export default function RecurringPage() {
  const { family, session, members, memberProfiles } = useAuth()
  const [items, setItems] = useState<RecurringPayment[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [confirming, setConfirming] = useState<RecurringPayment | null>(null)

  const load = async () => {
    if (!family) return
    setLoading(true); setError(null)
    try {
      const categoryMigration = ensureSupplementalCategories(family.id)
      const [, rRes, cRes, aRes] = await Promise.all([
        categoryMigration,
        googleSheets.from('recurring_payments').select('*').eq('family_id', family.id).order('next_due_date', { ascending: true }),
        googleSheets.from('categories').select('*').eq('family_id', family.id),
        googleSheets.from('accounts').select('*').eq('family_id', family.id),
      ])
      if (rRes.error) throw rRes.error; if (cRes.error) throw cRes.error; if (aRes.error) throw aRes.error
      setItems(rRes.data as RecurringPayment[]); setCategories(cRes.data as Category[]); setAccounts(aRes.data as Account[])
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка загрузки') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [family?.id])
  useEffect(() => {
    if (!family) return
    const ch = googleSheets.channel('rec-page').on('table_changes', { event: '*', schema: 'public', table: 'recurring_payments', filter: `family_id=eq.${family.id}` }, () => load()).subscribe()
    return () => { googleSheets.removeChannel(ch) }
  }, [family?.id])

  const catMap = new Map(categories.map((c) => [c.id, c]))
  const accountMap = new Map(accounts.map((a) => [a.id, a.name]))

  const confirmPayment = async () => {
    if (!confirming || !family || !session?.user) return
    setError(null)
    try {
      const { error: confirmError } = await googleSheets.rpc('confirm_recurring_payment', {
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

  const toggleActive = async (r: RecurringPayment) => { const { error: err } = await googleSheets.from('recurring_payments').update({ active: !r.active }).eq('id', r.id); if (err) setError(err.message); load() }
  const remove = async (r: RecurringPayment) => { const { error: err } = await googleSheets.from('recurring_payments').delete().eq('id', r.id); if (err) setError(err.message); load() }

  const overdue = items.filter((r) => r.active && r.next_due_date < todayISO())
  const upcoming = items.filter((r) => r.active && r.next_due_date >= todayISO())
  const paused = items.filter((r) => !r.active)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="page-title">Регулярные платежи</h1>
        <button onClick={() => setShowForm(true)} className="btn-primary"><Plus size={18} /> Добавить</button>
      </div>
      {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
      {overdue.length > 0 && <div className="card bg-warn-50 border-warn-100"><div className="text-sm font-medium text-warn-600">Просроченные платежи ({overdue.length})</div><div className="text-xs text-slate-500 mt-1">Подтвердите оплату, чтобы создать операцию и перенести дату.</div></div>}

      {loading ? <div className="text-sm text-slate-400">Загрузка…</div> : items.length === 0 ? (
        <div className="card text-center py-8 text-sm text-slate-500"><Repeat size={24} className="mx-auto mb-2 text-slate-300" />Регулярных платежей пока нет. Добавьте аренду, подписки и другие повторяющиеся расходы.</div>
      ) : (
        <div className="space-y-4">
          {overdue.length > 0 && <Section title="Просроченные" items={overdue} catMap={catMap} accountMap={accountMap} memberProfiles={memberProfiles} onConfirm={setConfirming} onToggle={toggleActive} onRemove={remove} highlight />}
          {upcoming.length > 0 && <Section title="Предстоящие" items={upcoming} catMap={catMap} accountMap={accountMap} memberProfiles={memberProfiles} onConfirm={setConfirming} onToggle={toggleActive} onRemove={remove} />}
          {paused.length > 0 && <Section title="Приостановленные" items={paused} catMap={catMap} accountMap={accountMap} memberProfiles={memberProfiles} onConfirm={setConfirming} onToggle={toggleActive} onRemove={remove} dim />}
        </div>
      )}
      <RecurringForm open={showForm} onClose={() => setShowForm(false)} onSaved={load} categories={categories} accounts={accounts} members={members} memberProfiles={memberProfiles} familyId={family?.id ?? null} userId={session?.user.id ?? null} />
      <Modal open={!!confirming} onClose={() => setConfirming(null)} title="Подтвердить платёж?">
        <p className="text-sm text-slate-600 mb-2">Будет создана операция на сумму <strong>{formatRubles(confirming?.amount_kopecks ?? 0)}</strong> за сегодня. Дата следующего платежа будет перенесена.</p>
        <p className="text-xs text-slate-400 mb-4">Платёж не дублируется автоматически — только ручное подтверждение.</p>
        <div className="flex gap-2"><button onClick={() => setConfirming(null)} className="btn-secondary flex-1">Отмена</button><button onClick={confirmPayment} className="btn-primary flex-1">Подтвердить</button></div>
      </Modal>
    </div>
  )
}

function Section({ title, items, catMap, accountMap, memberProfiles, onConfirm, onToggle, onRemove, highlight, dim }: {
  title: string; items: RecurringPayment[]; catMap: Map<string, Category>; accountMap: Map<string, string>; memberProfiles: Profile[]; onConfirm: (r: RecurringPayment) => void; onToggle: (r: RecurringPayment) => void; onRemove: (r: RecurringPayment) => void; highlight?: boolean; dim?: boolean
}) {
  return (
    <div>
      <h2 className="text-sm font-medium text-slate-500 mb-2">{title}</h2>
      <div className="space-y-2">
        {items.map((r) => {
          const cat = r.category_id ? catMap.get(r.category_id) : null
          const participant = memberProfiles.find((profile) => profile.id === (r.responsible_user_id || r.created_by))
          return (
            <div key={r.id} className={`card ${highlight ? 'border-warn-200 bg-warn-50/30' : ''} ${dim ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-3">
                <div className="text-xl w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">{cat?.icon ?? '🔄'}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900">{r.description}</div>
                  <div className="text-xs text-slate-400">{cat?.name ?? 'Без категории'} · {r.account_id ? (accountMap.get(r.account_id) ?? 'Счёт недоступен') : 'Без счёта'} · {FREQ_LABELS[r.frequency]} · до {formatDate(r.next_due_date)}{r.end_date ? ` · до ${formatDate(r.end_date)}` : ''}{participant ? ` · ${participant.display_name}` : ''}</div>
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

function RecurringForm({ open, onClose, onSaved, categories, accounts, members, memberProfiles, familyId, userId }: {
  open: boolean; onClose: () => void; onSaved: () => void; categories: Category[]; accounts: Account[]; members: FamilyMember[]; memberProfiles: Profile[]; familyId: string | null; userId: string | null
}) {
  const [type, setType] = useState<'expense' | 'income'>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [responsibleUserId, setResponsibleUserId] = useState(userId ?? '')
  const [description, setDescription] = useState('')
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'>('monthly')
  const [customDays, setCustomDays] = useState('30')
  const [startDate, setStartDate] = useState(todayISO())
  const [endDate, setEndDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (open) { setType('expense'); setAmount(''); setCategoryId(''); setAccountId(''); setResponsibleUserId(userId ?? ''); setDescription(''); setFrequency('monthly'); setCustomDays('30'); setStartDate(todayISO()); setEndDate(''); setError(null) } }, [open, userId])
  const visibleCats = categories.filter((c) => c.kind === type && (!c.archived || c.id === categoryId))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!familyId || !userId) return
    setError(null)
    const amt = parseRublesToKopecks(amount)
    if (amt === null || amt <= 0) { setError('Введите корректную сумму больше нуля с точностью до копейки'); return }
    if (frequency === 'custom' && (!Number.isSafeInteger(Number(customDays)) || Number(customDays) < 1)) { setError('Интервал должен быть целым числом дней от 1'); return }
    if (endDate && endDate < startDate) { setError('Дата окончания не может быть раньше даты начала'); return }
    setSaving(true)
    try {
      const { error: err } = await googleSheets.from('recurring_payments').insert({
        family_id: familyId, type, amount_kopecks: amt, category_id: categoryId || null, account_id: accountId || null, responsible_user_id: responsibleUserId || userId,
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
        <div><label className="label" htmlFor="recurring-description">Название</label><input id="recurring-description" className="input" required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Аренда, подписка…" autoFocus /></div>
        <div><label className="label" htmlFor="recurring-amount">Сумма, ₽</label><input id="recurring-amount" className="input" type="number" step="0.01" min="0" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" /></div>
        <div><label className="label" htmlFor="recurring-account">Счёт списания/зачисления</label><select id="recurring-account" className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Не выбран</option>{accounts.filter(a => !a.archived || a.id === accountId).map(a => <option key={a.id} value={a.id}>{a.name}{a.archived ? ' (архив)' : ''}</option>)}</select></div>
        <div><label className="label" htmlFor="recurring-category">Категория</label><select id="recurring-category" className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">Без категории</option>{visibleCats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</select></div>
        {members.length > 1 && <div><label className="label" htmlFor="recurring-responsible">Участник</label><select id="recurring-responsible" className="input" value={responsibleUserId} onChange={(e) => setResponsibleUserId(e.target.value)}>{members.map(member => { const profile = memberProfiles.find(item => item.id === member.user_id); const fallback = member.role === 'owner' ? 'Первый участник' : 'Второй участник'; return <option key={member.user_id} value={member.user_id}>{profile?.display_name || fallback}</option> })}</select></div>}
        <div><label className="label" htmlFor="recurring-frequency">Частота</label><select id="recurring-frequency" className="input" value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}><option value="daily">Ежедневно</option><option value="weekly">Еженедельно</option><option value="monthly">Ежемесячно</option><option value="yearly">Ежегодно</option><option value="custom">По интервалу</option></select></div>
        {frequency === 'custom' && <div><label className="label" htmlFor="recurring-custom-days">Интервал, дней</label><input id="recurring-custom-days" className="input" type="number" min="1" required value={customDays} onChange={(e) => setCustomDays(e.target.value)} /></div>}
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="recurring-start-date">Дата начала</label><input id="recurring-start-date" className="input" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
          <div><label className="label" htmlFor="recurring-end-date">Дата окончания</label><input id="recurring-end-date" className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
        </div>
        {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
        <div className="flex gap-2 pt-1"><button type="button" onClick={onClose} className="btn-secondary flex-1">Отмена</button><button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Сохранение…' : 'Сохранить'}</button></div>
      </form>
    </Modal>
  )
}
