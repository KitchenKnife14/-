import { useEffect, useMemo, useState } from 'react'
import { googleSheets } from '../lib/googleSheets'
import { ensureSupplementalCategories } from '../lib/categories'
import type { Transaction, Category, Profile, FamilyMember } from '../lib/types'

const emptyReport = {
  txs: [] as Transaction[],
  categories: [] as Category[],
  profiles: [] as Profile[],
}

export function usePeriodReport(familyId: string | undefined, members: FamilyMember[], range: { start: string; end: string }) {
  const selection = useMemo(() => ({
    familyId, start: range.start, end: range.end, memberIds: members.map(member => member.user_id),
  }), [familyId, range.start, range.end, members])
  const [report, setReport] = useState<{
    selection: typeof selection
    data: typeof emptyReport
    error: string | null
  } | null>(null)

  useEffect(() => {
    const { familyId, start, end, memberIds } = selection
    if (!familyId) return
    let active = true
    const load = async () => {
      try {
        const [, transactions, categories, profiles] = await Promise.all([
          ensureSupplementalCategories(familyId),
          googleSheets.from('transactions').select('*').eq('family_id', familyId).eq('planned', false).gte('operation_date', start).lte('operation_date', end).order('operation_date', { ascending: true }),
          googleSheets.from('categories').select('*').eq('family_id', familyId),
          memberIds.length ? googleSheets.from('profiles').select('*').in('id', memberIds) : Promise.resolve({ data: [], error: null }),
        ])
        if (!active) return
        if (transactions.error) throw transactions.error
        if (categories.error) throw categories.error
        if (profiles.error) throw profiles.error
        if (!Array.isArray(transactions.data) || !Array.isArray(categories.data) || !Array.isArray(profiles.data)) {
          googleSheets.invalidateReadCache()
          throw new Error('Сервер вернул неполные данные отчёта')
        }
        // Enforce family isolation again before rendering totals or exporting CSV.
        // Profiles do not have family_id, so restrict them to the requested member IDs.
        const requestedMemberIds = new Set(memberIds)
        if (transactions.data.some((row: Transaction) => row.family_id !== familyId)
          || categories.data.some((row: Category) => row.family_id !== familyId)
          || profiles.data.some((row: Profile) => !requestedMemberIds.has(row.id))) {
          googleSheets.invalidateReadCache()
          throw new Error('Ответ сервера содержит записи другой семьи')
        }
        // Do not trust a response that ignores the requested period or planned=false filter.
        // This also protects the CSV export, which consumes the same report data.
        if (transactions.data.some((row: Transaction) =>
          typeof row.operation_date !== 'string'
          || row.operation_date < start
          || row.operation_date > end
          || row.planned === true)) {
          googleSheets.invalidateReadCache()
          throw new Error('Ответ сервера содержит операции, не соответствующие фильтрам отчёта')
        }
        // Duplicate transaction IDs would double-count report totals and duplicate CSV rows.
        const transactionIds = new Set<string>()
        if (transactions.data.some((row: Transaction) => {
          if (typeof row.id !== 'string' || !row.id || transactionIds.has(row.id)) return true
          transactionIds.add(row.id)
          return false
        })) {
          googleSheets.invalidateReadCache()
          throw new Error('Ответ сервера содержит повторяющиеся операции')
        }
        // Monetary totals and CSV must never consume malformed amounts.
        // Backend validates writes; this guard catches corrupted or mismatched read responses.
        if (transactions.data.some((row: Transaction) =>
          !Number.isSafeInteger(row.amount_kopecks) || row.amount_kopecks <= 0
          || (row.type !== 'income' && row.type !== 'expense' && row.type !== 'transfer'))) {
          googleSheets.invalidateReadCache()
          throw new Error('Ответ сервера содержит некорректные финансовые операции')
        }
        setReport({
          selection,
          error: null,
          data: { txs: transactions.data, categories: categories.data, profiles: profiles.data },
        })
      } catch (cause) {
        if (active) setReport({ selection, data: emptyReport, error: cause instanceof Error ? cause.message : 'Ошибка загрузки' })
      }
    }
    void load()
    return () => { active = false }
  }, [selection])

  const current = report?.selection === selection ? report : null
  const loading = !current
  const error = current?.error
  const { txs, categories, profiles } = current?.data ?? emptyReport
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const profMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles])
  return { txs, catMap, profMap, loading, error }
}
