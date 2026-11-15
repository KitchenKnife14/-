const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/lib/requestSequence.ts'), 'utf8')
const javascript = ts.transpile(source, {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
})
const loadedModule = { exports: {} }
vm.runInNewContext(javascript, { module: loadedModule, exports: loadedModule.exports })
const { createRequestSequence } = loadedModule.exports

test('only the newest overlapping request remains current', () => {
  const sequence = createRequestSequence()
  const first = sequence.begin()
  const second = sequence.begin()
  assert.equal(sequence.isCurrent(first), false)
  assert.equal(sequence.isCurrent(second), true)
})

test('cleanup invalidates pending requests before a component remount or dependency change', () => {
  const sequence = createRequestSequence()
  const pending = sequence.begin()
  sequence.invalidate()
  assert.equal(sequence.isCurrent(pending), false)
  const next = sequence.begin()
  assert.ok(next > pending)
  assert.equal(sequence.isCurrent(next), true)
})

test('a failed or completed request cannot become current again', () => {
  const sequence = createRequestSequence()
  const first = sequence.begin()
  const second = sequence.begin()
  const third = sequence.begin()
  assert.equal(sequence.isCurrent(first), false)
  assert.equal(sequence.isCurrent(second), false)
  assert.equal(sequence.isCurrent(third), true)
})
