const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

test('mobile layout includes viewport-fit and all iOS safe-area insets', () => {
  const html = read('index.html')
  const css = read('src/index.css')
  assert.match(html, /viewport-fit=cover/)
  for (const inset of ['top', 'right', 'bottom', 'left']) {
    assert.match(css, new RegExp('safe-area-inset-' + inset))
  }
})

test('mobile app shell uses dynamic viewport and prevents Safari input focus zoom', () => {
  const css = read('src/index.css')
  const layout = read('src/components/Layout.tsx')
  assert.match(layout, /app-shell/)
  assert.match(css, /@supports\s*\(min-height:\s*100dvh\)/)
  assert.match(css, /input\.input,\s*select\.input,\s*textarea\.input\s*\{\s*font-size:\s*16px/)
})

test('global keyboard focus indicator is present', () => {
  const css = read('src/index.css')
  assert.match(css, /:focus-visible\s*\{\s*outline:/)
})
