import type { Goal } from './types'

export function sortGoalsForDisplay(goals: Goal[]): Goal[] {
  return [...goals].sort((a, b) => {
    const group = (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)
    if (group) return group
    const priority = Number(a.priority || 3) - Number(b.priority || 3)
    if (priority) return priority
    const date = String(a.target_date || '9999-12-31').localeCompare(String(b.target_date || '9999-12-31'))
    return date || String(a.created_at || '').localeCompare(String(b.created_at || ''))
  })
}

export function getGoalSectionLabel(goals: Goal[], index: number): string | null {
  const current = goals[index]
  if (!current) return null
  if (index === 0) return current.status === 'active' ? 'Активные цели' : 'Неактивные цели'
  if (current.status !== 'active' && goals[index - 1]?.status === 'active') return 'Неактивные цели'
  return null
}
