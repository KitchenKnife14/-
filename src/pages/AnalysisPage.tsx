import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { googleSheets } from '../lib/googleSheets'
import type { Transaction, Category, Profile } from '../lib/types'
import { formatRubles } from '../lib/money'
import { monthRange, monthLabel, currentMoscowMonth } from '../lib/dates'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export default function AnalysisPage() {
  const { family, members } = useAuth()
  const [txs, setTxs] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(currentMoscowMonth)

  const range = useMemo(() => monthRange(cursor.year, cursor.month), [cursor])

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
      const ids = members.map((m) => m.user_id)
      if (ids.length > 0) { const { data: pRes } = await googleSheets.from('profiles').select('*').in('id', ids); setProfiles(pRes as Profile[] ?? []) }
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка загрузки') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [family?.id, range.start, range.end])
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const profMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles])

  const memberData = useMemo(() => {
    return members.map((m) => {
      const memberTxs = txs.filter((t) => t.created_by === m.user_id)
      const income = memberTxs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount_kopecks, 0)
      const expense = memberTxs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount_kopecks, 0)
      const byCat = new Map<string, number>()
      for (const t of memberTxs.filter((t) => t.type === 'expense' && t.category_id)) { byCat.set(t.category_id!, (byCat.get(t.category_id!) ?? 0) + t.amount_kopecks) }
      const topCats = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      return { member: m, name: profMap.get(m.user_id)?.display_name ?? 'Участник', income, expense, balance: income - expense, topCats }
    })
  }, [txs, members, profMap])

  const totalIncome = memberData.reduce((s, d) => s + d.income, 0)
  const totalExpense = memberData.reduce((s, d) => s + d.expense, 0)

  const prevMonth = () => setCursor((c) => ({ year: c.month === 0 ? c.year - 1 : c.year, month: c.month === 0 ? 11 : c.month - 1 }))
  const nextMonth = () => setCursor((c) => ({ year: c.month === 11 ? c.year + 1 : c.year, month: c.month === 11 ? 0 : c.month + 1 }))

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Анализ доходов по участникам</h1>
      {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className="btn-ghost px-2"><ChevronLeft size={18} /></button>
        <div className="font-medium text-slate-700">{monthLabel(cursor.year, cursor.month)}</div>
        <button onClick={nextMonth} className="btn-ghost px-2"><ChevronRight size={18} /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card"><div className="text-sm text-slate-500">Общие доходы</div><div className="text-xl font-semibold text-accent-600 mt-1">{formatRubles(totalIncome)}</div></div>
        <div className="card"><div className="text-sm text-slate-500">Общие расходы</div><div className="text-xl font-semibold text-slate-900 mt-1">{formatRubles(totalExpense)}</div></div>
        <div className="card"><div className="text-sm text-slate-500">Общий остаток</div><div className={`text-xl font-semibold mt-1 ${totalIncome - totalExpense >= 0 ? 'text-accent-600' : 'text-danger-600'}`}>{formatRubles(totalIncome - totalExpense)}</div></div>
      </div>
      {loading ? <div className="text-sm text-slate-400">Загрузка…</div> : (
        <div className="space-y-3">
          {memberData.map((d) => {
            const share = totalIncome > 0 ? (d.income / totalIncome) * 100 : 0
            return (
              <div key={d.member.user_id} className="card">
                <div className="flex items-center justify-between mb-2"><div className="font-medium text-slate-900">{d.name}</div><span className="text-xs text-slate-400">{Math.round(share)}% от доходов</span></div>
                <div className="grid grid-cols-3 gap-2 text-sm mb-3">
                  <div><div className="text-xs text-slate-400">Зарплата / доходы</div><div className="font-medium text-accent-600">{formatRubles(d.income)}</div></div>
                  <div><div className="text-xs text-slate-400">Расходы</div><div className="font-medium text-slate-900">{formatRubles(d.expense)}</div></div>
                  <div><div className="text-xs text-slate-400">Баланс</div><div className={`font-medium ${d.balance >= 0 ? 'text-accent-600' : 'text-danger-600'}`}>{formatRubles(d.balance)}</div></div>
                </div>
                {d.topCats.length > 0 && (<div><div className="text-xs text-slate-400 mb-1">Топ категорий расходов</div><div className="space-y-1">{d.topCats.map(([catId, sum]) => { const cat = catMap.get(catId); return <div key={catId} className="flex items-center justify-between text-xs"><span className="text-slate-600">{cat?.icon ?? '📦'} {cat?.name ?? 'Категория'}</span><span className="text-slate-500">{formatRubles(sum)}</span></div> })}</div></div>)}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
