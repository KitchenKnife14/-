const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

async function loadCsvModule() {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/csv.ts'), 'utf8')
  const javascript = ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 })
  return import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'))
}

test('CSV cells neutralize spreadsheet formula prefixes including leading whitespace', async () => {
  const { csvCell } = await loadCsvModule()
  assert.equal(csvCell('=1+1'), '"\'=1+1"')
  assert.equal(csvCell('+SUM(A1:A2)'), '"\'+SUM(A1:A2)"')
  assert.equal(csvCell('-3'), '"\'-3"')
  assert.equal(csvCell('@SUM(A1)'), '"\'@SUM(A1)"')
  assert.equal(csvCell('  =HYPERLINK("https://example.com")'), '"\'  =HYPERLINK(""https://example.com"")"')
  assert.equal(csvCell('\t@cmd'), '"\'\t@cmd"')
  assert.equal(csvCell('Обычный текст'), '"Обычный текст"')
})

test('CSV encoder preserves delimiters, quotes and line breaks while quoting every cell', async () => {
  const { toCsv } = await loadCsvModule()
  const csv = toCsv([
    ['Дата', 'Описание', 'Сумма'],
    ['2026-11-10', 'Покупка; "тест"\nпродолжение', 45.1],
    [null, undefined, '=2+2'],
  ])
  assert.equal(csv, [
    '"Дата";"Описание";"Сумма"',
    '"2026-11-10";"Покупка; ""тест""\nпродолжение";"45.1"',
    '"";"";"\'=2+2"',
  ].join('\r\n'))
})
