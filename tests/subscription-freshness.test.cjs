const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const cases = [
  ['TransactionsPage.tsx', /\[familyId, dateFrom, dateTo, range\.start, range\.end\]/],
  ['DashboardPage.tsx', /\[familyId, range\.start, range\.end\]/],
  ['CalendarPage.tsx', /\[familyId, range\.start, range\.end\]/],
  ['NotificationsPage.tsx', /\[familyId, filter\]/],
  ['PlanningPage.tsx', /\[familyId, monthDate, range\.start, range\.end\]/],
]

for (const [file, dependencies] of cases) {
  test(`${file} subscription refresh uses the latest load callback`, () => {
    const source = fs.readFileSync(path.join(root, 'src/pages', file), 'utf8')
    assert.match(source, /import \{ useCallback, useEffect, (?:useMemo, )?(?:useRef, )?useState \} from 'react'/)
    assert.match(source, /const load = useCallback\(async \(\) => \{/)
    assert.match(source, /useEffect\(\(\) => \{\s*void load\(\)\s*return \(\) => \{ loadSequence\.current\.invalidate\(\) \}\s*\}, \[load\]\)/)
    assert.match(source, dependencies)
    assert.match(source, /\.on\([^\n]*, (?:load|\(\) => \{ void load\(\) \})\)/)
    assert.doesNotMatch(source, /\(\) => load\(\)/)
  })
}

test('goal section headings follow the filtered visible order', () => {
  const source = fs.readFileSync(path.join(root, 'src/pages', 'GoalsPage.tsx'), 'utf8')
  assert.match(source, /const visibleSortedGoals = useMemo\(\(\) => filterAndSortGoals\(goals, \{/)
  assert.ok(source.includes('visibleSortedGoals.map((g, index) => {'))
  assert.ok(source.includes('getGoalSectionLabel(visibleSortedGoals, index)'))
  assert.ok(source.includes('filterAndSortGoals, getGoalSectionLabel'))
})

for (const file of ['TransactionsPage.tsx', 'DashboardPage.tsx', 'CalendarPage.tsx', 'NotificationsPage.tsx', 'PlanningPage.tsx']) {
  test(`${file} ignores stale asynchronous list responses`, () => {
    const source = fs.readFileSync(path.join(root, 'src/pages', file), 'utf8')
    assert.match(source, /const loadSequence = useRef\(createRequestSequence\(\)\)/)
    assert.match(source, /const requestId = loadSequence\.current\.begin\(\)/)
    assert.match(source, /if \(!loadSequence\.current\.isCurrent\(requestId\)\) return/)
    assert.match(source, /if \(loadSequence\.current\.isCurrent\(requestId\)\) setError/)
    assert.match(source, /if \(loadSequence\.current\.isCurrent\(requestId\)\) setLoading\(false\)/)
    assert.match(source, /return \(\) => \{ loadSequence\.current\.invalidate\(\) \}/)
  })
}
