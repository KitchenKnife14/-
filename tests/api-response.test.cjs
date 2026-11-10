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

test('HTTP 4xx and 5xx responses require and preserve a valid error envelope', async () => {
  const { parseApiResponse } = await loadApiResponseModule()
  for (const status of [400, 401, 403, 404, 409, 429, 500, 502, 503]) {
    const message = `Ошибка HTTP ${status}`
    const parsed = parseApiResponse(JSON.stringify({ error: { message } }), status, false)
    assert.equal(parsed.error.message, message, `HTTP ${status}`)
    assert.throws(() => parseApiResponse('{"data":[]}', status, false), new RegExp(`HTTP ${status}`))
    for (const body of ['', '<!doctype html><html>login</html>', '{']) {
      assert.throws(() => parseApiResponse(body, status, false), `HTTP ${status}: ${body || 'empty body'}`)
    }
  }
})
