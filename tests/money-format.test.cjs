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


test('ruble input parsing converts decimal text exactly without rounding', async () => {
  const { parseRublesToKopecks } = await loadMoneyModule()
  assert.equal(parseRublesToKopecks('45'), 4500)
  assert.equal(parseRublesToKopecks('45,1'), 4510)
  assert.equal(parseRublesToKopecks('45.10'), 4510)
  assert.equal(parseRublesToKopecks('0,01'), 1)
  assert.equal(parseRublesToKopecks('00045,09'), 4509)
  assert.equal(parseRublesToKopecks(' 12,5 '), 1250)
})

test('signed ruble parsing is opt-in and preserves negative kopecks exactly', async () => {
  const { parseRublesToKopecks } = await loadMoneyModule()
  assert.equal(parseRublesToKopecks('-45,12'), null)
  assert.equal(parseRublesToKopecks('-45,12', { allowNegative: true }), -4512)
  assert.equal(parseRublesToKopecks('-0,01', { allowNegative: true }), -1)
  assert.equal(parseRublesToKopecks('45,12', { allowNegative: true }), 4512)
  assert.equal(parseRublesToKopecks('-45,123', { allowNegative: true }), null)
})

test('ruble input parsing rejects malformed, over-precise and unsafe values', async () => {
  const { parseRublesToKopecks } = await loadMoneyModule()
  for (const value of ['', ' ', '45,123', '45.001', '45rub', '1,2,3', '-1', '+1', '1e2', 'NaN', 'Infinity', '90071992547410']) {
    assert.equal(parseRublesToKopecks(value), null, value)
  }
  assert.equal(parseRublesToKopecks('0'), 0)
  assert.equal(parseRublesToKopecks('0,00'), 0)
})
