const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

test('mobile viewport and root layout account for iOS safe-area insets', () => {
  const html = fs.readFileSync('index.html', 'utf8')
  const css = fs.readFileSync('src/index.css', 'utf8')
  assert.match(html, /viewport-fit=cover/)
  assert.match(css, /padding-top:\s*env\(safe-area-inset-top/)
  assert.match(css, /padding-right:\s*env\(safe-area-inset-right/)
  assert.match(css, /padding-bottom:\s*env\(safe-area-inset-bottom/)
  assert.match(css, /padding-left:\s*env\(safe-area-inset-left/)
  assert.match(css, /@media\s*\(max-width:\s*767px\)/)
})
