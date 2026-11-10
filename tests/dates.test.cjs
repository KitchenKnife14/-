const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const script = String.raw`
  const fs = require('node:fs')
  const path = require('node:path')
  const Module = require('node:module')
  const ts = require('typescript')
  const file = path.join(process.cwd(), 'src/lib/dates.ts')
  const mod = new Module(file, module)
  mod.filename = file
  mod.paths = Module._nodeModulePaths(path.dirname(file))
  const source = fs.readFileSync(file, 'utf8')
  mod._compile(ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }), file)
  const dates = mod.exports
  console.log(JSON.stringify({
    date: dates.formatDate('2026-11-01'),
    shortDate: dates.formatDateShort('2026-11-01'),
    longDate: dates.formatDateLong('2026-11-01'),
    timestamp: dates.formatDateInMoscow('2026-10-31T21:30:00.000Z'),
    months: dates.monthsUntilDate('2026-12-01', '2026-11-01'),
    invalid: dates.monthsUntilDate('2026-02-30', '2026-11-01')
  }))
`

function runInTimezone(timezone) {
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, TZ: timezone },
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout.trim())
}

test('calendar dates and Moscow timestamps are stable across device timezones', () => {
  const utc = runInTimezone('UTC')
  const losAngeles = runInTimezone('America/Los_Angeles')
  const amsterdam = runInTimezone('Europe/Amsterdam')
  assert.deepEqual(losAngeles, utc)
  assert.deepEqual(amsterdam, utc)
  assert.equal(utc.date, '1 нояб. 2026')
  assert.equal(utc.timestamp, '1 нояб. 2026')
  assert.equal(utc.months, 1)
  assert.equal(utc.invalid, null)
})
