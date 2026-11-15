const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('category letter navigation creates one unique anchor per first letter', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/pages/CategoriesPage.tsx'), 'utf8')
  assert.match(source, /roots\.map\(\(root, rootIndex\) => \{/)
  assert.match(source, /const isFirstForLetter = roots\.findIndex\([\s\S]*?\) === rootIndex/)
  assert.match(source, /id=\{isFirstForLetter \? `category-letter-\$\{letter\}` : undefined\}/)
  assert.match(source, /getElementById\(`category-letter-\$\{letter\}`\)/)
})
