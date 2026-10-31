import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { googleSheets } from '../lib/googleSheets'
import type { Transaction, Category, Profile } from '../lib/types'
import { formatRubles, kopecksToRubles } from '../lib/money'
import { monthRange, currentMoscowDate } from '../lib/dates'
import { Download } from 'lucide-react'

type Period = 'current' | 'prev' | '3m' | '6m' | 'year' | 'custom'

export default function ReportsPage() {
  const { family, members } = useAuth()
  const [txs, setTxs] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>('current')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [memberFilter, setMemberFilter] = useState<string>('all')

  const range = useMemo(() => {
    const now = currentMoscowDate()
    if (period === 'current') return monthRange(now.getFullYear(), now.getMonth())
    if (period === 'prev') { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); return monthRange(d.getFullYear(), d.getMonth()) }
    if (period === '3m') { const d = new Date(now.getFullYear(), now.getMonth() - 2, 1); return { start: monthRange(d.getFullYear(), d.getMonth()).start, end: monthRange(now.getFullYear(), now.getMonth()).end } }
    if (period === '6m') { const d = new Date(now.getFullYear(), now.getMonth() - 5, 1); return { start: monthRange(d.getFullYear(), d.getMonth()).start, end: monthRange(now.getFullYear(), now.getMonth()).end } }
    if (period === 'year') return { start: `${now.getFullYear()}-01-01`, end: `${now.getFullYear()}-12-31` }
    return { start: customStart || `${now.getFullYear()}-01-01`, end: customEnd || `${now.getFullYear()}-12-31` }
  }, [period, customStart, customEnd])

  const load = async () => {
    if (!family) return
    setLoading(true); setError(null)
    try {
      const [tRes, cRes] = await Promise.all([
        googleSheets.from('transactions').select('*').eq('family_id', family.id).eq('planned', false).gte('operation_date', range.start).lte('operation_date', range.end).order('operation_date', { ascending: true }),
        googleSheets.from('categories').select('*').eq('family_id', family.id).eq('archived', false),
      ])
      if (tRes.error) throw tRes.error; if (cRes.error) throw cRes.error
      setTxs(tRes.data as Transaction[]); setCategories(cRes.data as Category[])
      const memberIds = members.map((m) => m.user_id)
      if (memberIds.length > 0) { const { data: pRes } = await googleSheets.from('profiles').select('*').in('id', memberIds); setProfiles(pRes as Profile[] ?? []) }
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка загрузки') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [family?.id, range.start, range.end])

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const profMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles])

  const filteredTxs = txs.filter((t) => memberFilter === 'all' || t.created_by === memberFilter)
  const income = filteredTxs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount_kopecks, 0)
  const expense = filteredTxs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount_kopecks, 0)

  const byCategory = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of filteredTxs.filter((t) => t.type === 'expense' && t.category_id)) { m.set(t.category_id!, (m.get(t.category_id!) ?? 0) + t.amount_kopecks) }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [filteredTxs])

  const byMember = useMemo(() => {
    const m = new Map<string, { income: number; expense: number }>()
    for (const t of filteredTxs) {
      const key = t.created_by ?? 'unknown'
      if (!m.has(key)) m.set(key, { income: 0, expense: 0 })
      const e = m.get(key)!
      if (t.type === 'income') e.income += t.amount_kopecks
      if (t.type === 'expense') e.expense += t.amount_kopecks
    }
    return [...m.entries()]
  }, [filteredTxs])

  const exportCSV = () => {
    const rows = [['Дата', 'Тип', 'Сумма (₽)', 'Категория', 'Описание', 'Автор']]
    for (const t of filteredTxs) {
      rows.push([t.operation_date, t.type === 'income' ? 'Доход' : t.type === 'expense' ? 'Расход' : 'Перевод', String(kopecksToRubles(t.amount_kopecks)), t.category_id ? catMap.get(t.category_id)?.name ?? '' : '', t.description, t.created_by ? profMap.get(t.created_by)?.display_name ?? '' : ''])
    }
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `report_${range.start}_${range.end}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const maxCat = byCategory.length > 0 ? byCategory[0][1] : 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Отчёты</h1>
        <button onClick={exportCSV} disabled={filteredTxs.length === 0} className="btn-secondary"><Download size={16} /> Экспорт CSV</button>
      </div>
      {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
      <div className="flex flex-wrap gap-2">
        <select className="input w-auto" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
          <option value="current">Текущий месяц</option><option value="prev">Предыдущий месяц</option><option value="3m">3 месяца</option><option value="6m">6 месяцев</option><option value="year">Год</option><option value="custom">Произвольный</option>
        </select>
        {period === 'custom' && (<><input className="input w-auto" type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} /><input className="input w-auto" type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} /></>)}
        <select className="input w-auto" value={memberFilter} onChange={(e) => setMemberFilter(e.target.value)}>
          <option value="all">Все участники</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{profMap.get(m.user_id)?.display_name ?? 'Участник'}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card"><div className="text-sm text-slate-500">Доходы</div><div className="text-xl font-semibold text-accent-600 mt-1">{formatRubles(income)}</div></div>
        <div className="card"><div className="text-sm text-slate-500">Расходы</div><div className="text-xl font-semibold text-slate-900 mt-1">{formatRubles(expense)}</div></div>
        <div className="card"><div className="text-sm text-slate-500">Разница</div><div className={`text-xl font-semibold mt-1 ${income - expense >= 0 ? 'text-accent-600' : 'text-danger-600'}`}>{formatRubles(income - expense)}</div></div>
      </div>
      <div className="card">
        <h2 className="text-sm font-medium text-slate-700 mb-3">Расходы по категориям</h2>
        {byCategory.length === 0 ? <p className="text-sm text-slate-500">Нет данных за период.</p> : (
          <div className="space-y-2">
            {byCategory.map(([catId, sum]) => {
              const cat = catMap.get(catId)
              const pct = expense > 0 ? (sum / expense) * 100 : 0
              return (<div key={catId}><div className="flex items-center justify-between text-sm mb-1"><span className="text-slate-700">{cat?.icon ?? '📦'} {cat?.name ?? 'Категория'}</span><span className="text-slate-500">{formatRubles(sum)} · {Math.round(pct)}%</span></div><div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full bg-primary-500" style={{ width: `${maxCat > 0 ? (sum / maxCat) * 100 : 0}%` }} /></div></div>)
            })}
          </div>
        )}
      </div>
      <div className="card">
        <h2 className="text-sm font-medium text-slate-700 mb-3">Распределение по участникам</h2>
        {byMember.length === 0 ? <p className="text-sm text-slate-500">Нет данных за период.</p> : (
          <div className="space-y-2">
            {byMember.map(([uid, vals]) => (<div key={uid} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0"><span className="text-sm text-slate-700">{profMap.get(uid)?.display_name ?? 'Участник'}</span><div className="text-right"><div className="text-sm text-accent-600">Доходы: {formatRubles(vals.income)}</div><div className="text-sm text-slate-700">Расходы: {formatRubles(vals.expense)}</div></div></div>))}
          </div>
        )}
      </div>
      {loading && <div className="text-sm text-slate-400">Загрузка…</div>}
    </div>
  )
}
