import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { createRequestSequence } from '../lib/requestSequence'
import { googleSheets } from '../lib/googleSheets'
import type { AppNotification } from '../lib/types'
import { formatDateInMoscow } from '../lib/dates'
import { Check, Trash2, Bell } from 'lucide-react'

export default function NotificationsPage() {
  const { family } = useAuth()
  const familyId = family?.id
  const [items, setItems] = useState<AppNotification[]>([])
  const loadSequence = useRef(createRequestSequence())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set())
  const pendingIdsRef = useRef(new Set<string>())
  const [markingAllRead, setMarkingAllRead] = useState(false)
  const markingAllReadRef = useRef(false)

  const beginItemAction = (id: string) => {
    if (markingAllReadRef.current || pendingIdsRef.current.has(id)) return false
    pendingIdsRef.current.add(id)
    setPendingIds(new Set(pendingIdsRef.current))
    return true
  }
  const finishItemAction = (id: string) => {
    pendingIdsRef.current.delete(id)
    setPendingIds(new Set(pendingIdsRef.current))
  }

  const load = useCallback(async () => {
    if (!familyId) return
    const requestId = loadSequence.current.begin()
    setLoading(true); setError(null)
    try {
      const q = googleSheets.from('notifications').select('*').eq('family_id', familyId).order('created_at', { ascending: false })
      const { data, error: err } = filter === 'unread' ? await q.eq('read', false) : await q
      if (!loadSequence.current.isCurrent(requestId)) return
      if (err) throw err
      setItems(data as AppNotification[])
    } catch (e) { if (loadSequence.current.isCurrent(requestId)) setError(e instanceof Error ? e.message : 'Ошибка загрузки') }
    finally { if (loadSequence.current.isCurrent(requestId)) setLoading(false) }
  }, [familyId, filter])

  useEffect(() => {
    void load()
    return () => { loadSequence.current.invalidate() }
  }, [load])
  useEffect(() => {
    if (!familyId) return
    const channel = googleSheets
      .channel('notif-page')
      .on('table_changes', { event: '*', schema: 'public', table: 'notifications', filter: `family_id=eq.${familyId}` }, () => { void load() })
      .subscribe()
    return () => { googleSheets.removeChannel(channel) }
  }, [familyId, load])


  const markRead = async (n: AppNotification) => {
    if (n.read || !beginItemAction(n.id)) return
    try {
      const { error: err } = await googleSheets.from('notifications').update({ read: true }).eq('id', n.id).expect(n as unknown as Record<string, unknown>)
      if (err) setError(err.message)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось обновить уведомление')
    } finally {
      finishItemAction(n.id)
    }
  }
  const markAllRead = async () => {
    if (!family || markingAllReadRef.current || pendingIdsRef.current.size > 0) return
    const unread = items.filter((n) => !n.read)
    if (unread.length === 0) return
    markingAllReadRef.current = true
    setMarkingAllRead(true)
    try {
      const results = await Promise.all(unread.map((n) => googleSheets.from('notifications').update({ read: true }).eq('id', n.id).expect(n as unknown as Record<string, unknown>)))
      const conflicts = results.filter((result) => result.error)
      if (conflicts.length) setError(`${conflicts.length} уведомлений изменились одновременно. Обновите список и повторите действие.`)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось обновить уведомления')
    } finally {
      markingAllReadRef.current = false
      setMarkingAllRead(false)
    }
  }
  const remove = async (n: AppNotification) => {
    if (!beginItemAction(n.id)) return
    try {
      const { error: err } = await googleSheets.from('notifications').delete().eq('id', n.id).expect(n as unknown as Record<string, unknown>)
      if (err) setError(err.message)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить уведомление')
    } finally {
      finishItemAction(n.id)
    }
  }

  const KIND_LABELS: Record<string, string> = {
    budget_warning: 'Предупреждение о бюджете', goal_progress: 'Прогресс цели', recurring_due: 'Повторяющийся платёж',
    planning_reminder: 'Напоминание о планировании', purchase_status: 'Статус покупки', system: 'Система',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="page-title">Уведомления</h1>
        {items.some((n) => !n.read) && <button type="button" onClick={markAllRead} disabled={markingAllRead || pendingIds.size > 0} aria-busy={markingAllRead} className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"><Check size={16} /> Отметить все прочитанными</button>}
      </div>
      {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        {(['all', 'unread'] as const).map((f) => (
          <button type="button" key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${filter === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{f === 'all' ? 'Все' : 'Непрочитанные'}</button>
        ))}
      </div>
      {loading ? <div className="text-sm text-slate-400">Загрузка…</div> : error ? null : items.length === 0 ? (
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
                  <div className="text-xs text-slate-400 mt-1">{formatDateInMoscow(n.created_at)}</div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {!n.read && <button type="button" onClick={() => markRead(n)} disabled={markingAllRead || pendingIds.has(n.id)} aria-busy={pendingIds.has(n.id)} className="btn-ghost px-2 disabled:opacity-50 disabled:cursor-not-allowed" aria-label={`Отметить уведомление «${n.title}» прочитанным`} title="Прочитано"><Check size={16} /></button>}
                  <button type="button" onClick={() => remove(n)} disabled={markingAllRead || pendingIds.has(n.id)} aria-busy={pendingIds.has(n.id)} className="btn-ghost px-2 text-danger-600 disabled:opacity-50 disabled:cursor-not-allowed" aria-label={`Удалить уведомление «${n.title}»`} title="Удалить"><Trash2 size={16} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
