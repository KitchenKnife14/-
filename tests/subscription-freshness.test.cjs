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
    assert.match(source, /import \{ useCallback, useEffect, useMemo, useState \} from 'react'/)
    assert.match(source, /const load = useCallback\(async \(\) => \{/)
    assert.match(source, /useEffect\(\(\) => \{ void load\(\) \}, \[load\]\)/)
    assert.match(source, dependencies)
    assert.match(source, /\(\) => \{ void load\(\) \}/)
    assert.doesNotMatch(source, /\(\) => load\(\)/)
  })
}
