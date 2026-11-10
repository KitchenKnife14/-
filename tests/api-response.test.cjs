const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

async function loadApiResponseModule() {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/apiResponse.ts'), 'utf8')
  const javascript = ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 })
  return import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'))
}

test('Apps Script response parser accepts valid data and error envelopes', async () => {
  const { parseApiResponse } = await loadApiResponseModule()
  assert.deepEqual(parseApiResponse('{"data":[1,2],"error":null}', 200, true).data, [1, 2])
  assert.equal(parseApiResponse('{"error":{"message":"Нет доступа"}}', 200, true).error.message, 'Нет доступа')
  assert.equal(parseApiResponse('{"error":{"message":"Временная ошибка"}}', 502, false).error.message, 'Временная ошибка')
})

test('Apps Script response parser rejects malformed JSON and invalid envelopes', async () => {
  const { parseApiResponse } = await loadApiResponseModule()
  for (const text of ['<html>login</html>', '{', 'null', '[]', '{}', '{"data":1,"error":{"message":4}}']) {
    assert.throws(() => parseApiResponse(text, 200, true))
  }
  assert.throws(() => parseApiResponse('{"data":1}', 502, false), /HTTP 502/)
})
