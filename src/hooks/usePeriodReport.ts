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
          throw new Error('Сервер вернул неполные данные отчёта')
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
