import { useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { usePeriodReport } from '../hooks/usePeriodReport'
import { getTransactionAttribution } from '../lib/transactionAttribution'
import { formatRubles } from '../lib/money'
import { monthRange, monthLabel, currentMoscowMonth } from '../lib/dates'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export default function AnalysisPage() {
  const { family, members } = useAuth()
  const [cursor, setCursor] = useState(currentMoscowMonth)

  const range = useMemo(() => monthRange(cursor.year, cursor.month), [cursor])

  const { txs, catMap, profMap, loading, error } = usePeriodReport(family?.id, members, range)

  const memberData = useMemo(() => {
    const summaries = members.map(member => ({
      member,
      name: profMap.get(member.user_id)?.display_name ?? 'Участник',
      income: 0,
      expense: 0,
      byCategory: new Map<string, number>(),
    }))
    const byUser = new Map(summaries.map(summary => [summary.member.user_id, summary]))
    for (const transaction of txs) {
      const { responsibleId } = getTransactionAttribution(transaction)
      if (!responsibleId) continue
      const summary = byUser.get(responsibleId)
      if (!summary) continue
      const { type, amount_kopecks: amount, category_id: categoryId } = transaction
      if (type === 'income') summary.income += amount
      if (type === 'expense') {
        summary.expense += amount
        if (categoryId) summary.byCategory.set(categoryId, (summary.byCategory.get(categoryId) ?? 0) + amount)
      }
    }
    return summaries.map(({ member, name, income, expense, byCategory }) => ({
      member, name, income, expense, balance: income - expense,
      topCats: [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    }))
  }, [txs, members, profMap])

  const totalIncome = memberData.reduce((s, d) => s + d.income, 0)
  const totalExpense = memberData.reduce((s, d) => s + d.expense, 0)

  const prevMonth = () => setCursor((c) => ({ year: c.month === 0 ? c.year - 1 : c.year, month: c.month === 0 ? 11 : c.month - 1 }))
  const nextMonth = () => setCursor((c) => ({ year: c.month === 11 ? c.year + 1 : c.year, month: c.month === 11 ? 0 : c.month + 1 }))

  return (
    <div className="space-y-4">
      <h1 className="page-title">Анализ доходов по участникам</h1>
      {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
      <div className="flex items-center justify-between">
        <button type="button" onClick={prevMonth} className="btn-ghost px-2" aria-label="Предыдущий месяц"><ChevronLeft size={18} /></button>
        <div className="font-medium text-slate-700">{monthLabel(cursor.year, cursor.month)}</div>
        <button type="button" onClick={nextMonth} className="btn-ghost px-2" aria-label="Следующий месяц"><ChevronRight size={18} /></button>
      </div>
      {!loading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="card"><div className="text-sm text-slate-500">Общие доходы</div><div className="text-xl font-semibold text-accent-600 mt-1">{formatRubles(totalIncome)}</div></div>
          <div className="card"><div className="text-sm text-slate-500">Общие расходы</div><div className="text-xl font-semibold text-slate-900 mt-1">{formatRubles(totalExpense)}</div></div>
          <div className="card"><div className="text-sm text-slate-500">Общий остаток</div><div className="text-xl font-semibold text-slate-900 mt-1">{formatRubles(totalIncome - totalExpense)}</div></div>
        </div>
      )}
      {loading ? <div className="text-sm text-slate-400">Загрузка…</div> : error ? null : txs.length === 0 ? (
        <div className="card text-center py-8 text-sm text-slate-500">Операций за выбранный месяц нет.</div>
      ) : (
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
