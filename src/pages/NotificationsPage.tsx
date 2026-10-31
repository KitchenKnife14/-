import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { googleSheets } from '../lib/googleSheets'
import type { AppNotification } from '../lib/types'
import { formatDate } from '../lib/dates'
import { Check, Trash2, Bell } from 'lucide-react'

export default function NotificationsPage() {
  const { family } = useAuth()
  const [items, setItems] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const load = async () => {
    if (!family) return
    setLoading(true); setError(null)
    try {
      const q = googleSheets.from('notifications').select('*').eq('family_id', family.id).order('created_at', { ascending: false })
      const { data, error: err } = filter === 'unread' ? await q.eq('read', false) : await q
      if (err) throw err
      setItems(data as AppNotification[])
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка загрузки') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [family?.id, filter])
  useEffect(() => {
    if (!family) return
    const ch = googleSheets.channel('notif-page').on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `family_id=eq.${family.id}` }, () => load()).subscribe()
    return () => { googleSheets.removeChannel(ch) }
  }, [family?.id])

  const markRead = async (n: AppNotification) => { const { error: err } = await googleSheets.from('notifications').update({ read: true }).eq('id', n.id); if (err) setError(err.message); load() }
  const markAllRead = async () => {
    if (!family) return
    const { error: err } = await googleSheets.from('notifications').update({ read: true }).eq('family_id', family.id).eq('read', false)
    if (err) setError(err.message); load()
  }
  const remove = async (n: AppNotification) => { const { error: err } = await googleSheets.from('notifications').delete().eq('id', n.id); if (err) setError(err.message); load() }

  const KIND_LABELS: Record<string, string> = {
    budget_warning: 'Предупреждение о бюджете', goal_progress: 'Прогресс цели', recurring_due: 'Повторяющийся платёж',
    planning_reminder: 'Напоминание о планировании', purchase_status: 'Статус покупки', system: 'Система',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Уведомления</h1>
        {items.some((n) => !n.read) && <button onClick={markAllRead} className="btn-secondary"><Check size={16} /> Отметить все прочитанными</button>}
      </div>
      {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        {(['all', 'unread'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${filter === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{f === 'all' ? 'Все' : 'Непрочитанные'}</button>
        ))}
      </div>
      {loading ? <div className="text-sm text-slate-400">Загрузка…</div> : items.length === 0 ? (
        <div className="card text-center py-8 text-sm text-slate-500"><Bell size={24} className="mx-auto mb-2 text-slate-300" />Нет уведомлений.</div>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <div key={n.id} className={`card ${n.read ? 'opacity-70' : 'border-primary-200 bg-primary-50/30'}`}>
              <div className="flex items-start gap-3">
                <div className="text-lg w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">🔔</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-slate-900">{KIND_LABELS[n.kind] ?? n.kind}</span>
                    {!n.read && <span className="w-2 h-2 rounded-full bg-primary-500" />}
                  </div>
                  <div className="text-sm text-slate-600 mt-0.5">{n.title}</div>
                  {n.body && <div className="text-xs text-slate-400 mt-1">{n.body}</div>}
                  <div className="text-xs text-slate-400 mt-1">{formatDate(n.created_at)}</div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {!n.read && <button onClick={() => markRead(n)} className="btn-ghost px-2" title="Прочитано"><Check size={16} /></button>}
                  <button onClick={() => remove(n)} className="btn-ghost px-2 text-danger-600" title="Удалить"><Trash2 size={16} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
