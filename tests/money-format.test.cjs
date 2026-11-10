const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

async function loadMoneyModule() {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/money.ts'), 'utf8')
  const javascript = ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 })
  return import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'))
}

test('compact ruble formatting preserves kopecks instead of rounding to whole rubles', async () => {
  const { formatRublesShort } = await loadMoneyModule()
  assert.equal(formatRublesShort(1), '0,01 ₽')
  assert.equal(formatRublesShort(10), '0,1 ₽')
  assert.equal(formatRublesShort(1050), '10,5 ₽')
  assert.equal(formatRublesShort(1001), '10,01 ₽')
  assert.equal(formatRublesShort(100), '1 ₽')
  assert.equal(formatRublesShort(-1), '-0,01 ₽')
})
