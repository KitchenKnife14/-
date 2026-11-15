const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/lib/goalSorting.ts'), 'utf8')
const javascript = ts.transpile(source, {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
})
const loadedModule = { exports: {} }
vm.runInNewContext(javascript, { module: loadedModule, exports: loadedModule.exports }, { filename: 'goalSorting.ts' })
const { sortGoalsForDisplay, getGoalSectionLabel } = loadedModule.exports

function goal(id, overrides = {}) {
  return {
    id,
    family_id: 'family',
    name: id,
    description: '',
    target_kopecks: 10000,
    saved_kopecks: 0,
    target_date: null,
    priority: 3,
    status: 'active',
    responsible_user_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

test('goal display order keeps active goals first, then priority and target date', () => {
  const input = [
    goal('inactive-high', { status: 'paused', priority: 1 }),
    goal('active-low', { priority: 4 }),
    goal('active-later', { priority: 1, target_date: '2027-06-01' }),
    goal('active-sooner', { priority: 1, target_date: '2027-01-01' }),
    goal('inactive-low', { status: 'done', priority: 5 }),
  ]
  const sorted = sortGoalsForDisplay(input)
  assert.deepEqual(sorted.map(item => item.id), [
    'active-sooner',
    'active-later',
    'active-low',
    'inactive-high',
    'inactive-low',
  ])
  assert.deepEqual(input.map(item => item.id), [
    'inactive-high', 'active-low', 'active-later', 'active-sooner', 'inactive-low',
  ], 'sorting must not mutate the source array')
})

test('goal section labels are based on the visible filtered list', () => {
  const visible = [
    goal('paused-a', { status: 'paused' }),
    goal('done-b', { status: 'done' }),
    goal('cancelled-c', { status: 'cancelled' }),
  ]
  assert.equal(getGoalSectionLabel(visible, 0), 'Неактивные цели')
  assert.equal(getGoalSectionLabel(visible, 1), null)
  assert.equal(getGoalSectionLabel(visible, 2), null)
})

test('goal section label appears exactly once when active and inactive goals are visible', () => {
  const visible = [
    goal('active', { status: 'active' }),
    goal('paused', { status: 'paused' }),
    goal('done', { status: 'done' }),
  ]
  assert.deepEqual(visible.map((_, index) => getGoalSectionLabel(visible, index)), [
    'Активные цели',
    'Неактивные цели',
    null,
  ])
})

test('empty and out-of-range goal section positions have no heading', () => {
  assert.equal(getGoalSectionLabel([], 0), null)
  assert.equal(getGoalSectionLabel([goal('active')], 1), null)
})
