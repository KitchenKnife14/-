const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/lib/safeUrl.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const moduleObject = { exports: {} }
vm.runInNewContext(compiled, { module: moduleObject, exports: moduleObject.exports, URL })
const { safeHttpUrl } = moduleObject.exports

test('safeHttpUrl keeps valid absolute HTTP and HTTPS links', () => {
  assert.equal(safeHttpUrl('https://example.com/item?q=1'), 'https://example.com/item?q=1')
  assert.equal(safeHttpUrl('http://example.com/item'), 'http://example.com/item')
  assert.equal(safeHttpUrl('  https://example.com  '), 'https://example.com/')
})

test('safeHttpUrl rejects script, data, relative, credentialed and malformed links', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,hello',
    '//evil.example/path',
    '/relative/path',
    'ftp://example.com/file',
    'https://user:pass@example.com',
    'https://example.com\\@evil.example',
    'https://example.com/path with space',
    'https://example.com/' + 'a'.repeat(2049),
    null,
    42,
  ]) assert.equal(safeHttpUrl(value), null, String(value))
})
