const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '../src/context/AuthContext.tsx'), 'utf8')
const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')
const layout = fs.readFileSync(path.join(__dirname, '../src/components/Layout.tsx'), 'utf8')
const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'))

test('auth context ignores stale async session loads before writing state', () => {
  assert.match(source, /const loadSequence = useRef\(0\)/)
  assert.match(source, /sequence = \+\+loadSequence\.current/)
  assert.match(source, /if \(sequence !== loadSequence\.current\) return/)
  assert.match(source, /if \(sequence === loadSequence\.current\) setLoading\(false\)/)
  assert.match(source, /loadSequence\.current\+\+/)
  const contextStart = source.indexOf('const c = data as')
  const guard = source.indexOf('if (sequence !== loadSequence.current) return', contextStart)
  const firstWrite = source.indexOf('setProfile(c.profile)', contextStart)
  assert.ok(contextStart >= 0 && guard > contextStart && firstWrite > guard, 'stale response must be discarded before any profile state write')
})

test('initial session lookup cannot overwrite a newer auth event', () => {
  assert.match(source, /const initialSequence = \+\+loadSequence\.current/)
  assert.match(source, /onAuthStateChange/)
  assert.match(source, /if \(initialSequence === loadSequence\.current\) void load/)
  assert.ok(source.indexOf('onAuthStateChange') < source.indexOf('googleSheets.auth.getSession()'))
})

test('manual session refresh is invalidated by newer auth events', () => {
  assert.match(source, /const sequence = \+\+loadSequence\.current\n    setLoading\(true\)/)
  assert.match(source, /if \(sequence !== loadSequence\.current\) return\n      await load/)
})

test('router defines auth, onboarding and unknown-path behavior', () => {
  assert.ok(app.includes('if (!session) return <Routes><Route path="*" element={<AuthPage />} /></Routes>'))
  assert.ok(app.includes('if (!family) return <Routes><Route path="*" element={<OnboardingPage />} /></Routes>'))
  assert.ok(app.includes('<Route path="*" element={<Navigate to="/" replace />} />'))
  assert.ok(app.includes('<Route path="transactions" element={<TransactionsPage />} />'))
})

test('Vercel rewrites direct SPA paths to index.html', () => {
  assert.deepEqual(vercel.rewrites, [{ source: '/(.*)', destination: '/index.html' }])
})

test('every navigation destination has a matching authenticated route', () => {
  const destinations = [...layout.matchAll(/to: '(\/[^']*)'/g)].map(match => match[1])
  const routePaths = new Set(['/', ...[...app.matchAll(/<Route path="([^"]+)"/g)].map(match => '/' + match[1])])
  assert.equal(destinations.length, 14, 'expected all 14 navigation entries')
  for (const destination of destinations) {
    assert.ok(routePaths.has(destination), `missing route for navigation destination: ${destination}`)
  }
  assert.match(layout, /await googleSheets\.auth\.signOut\(\)/)
  assert.match(layout, /navigate\('/', \{ replace: true \}\)/)
})


test('mobile navigation exposes four primary routes and all remaining routes in More menu', () => {
  assert.match(layout, /const mobilePrimary = \['\/', '\/transactions', '\/accounts', '\/budgets'\]/)
  assert.match(layout, /const mobileMoreItems = navItems\.filter\(item => !mobilePrimary\.includes\(item\.to\)\)/)
  assert.match(layout, /aria-label="Нижняя навигация"/)
  assert.match(layout, /aria-label="Дополнительная навигация"/)
  assert.match(layout, /aria-expanded=\{moreOpen\}/)
  assert.match(layout, /pb-\[env\(safe-area-inset-bottom\)\]/)
  assert.match(layout, /pb-28/)
  assert.doesNotMatch(layout, /overflow-x-auto px-4 pb-3/)
})

test('mobile navigation has an explicit active state for routes placed in More', () => {
  assert.match(layout, /const moreActive = mobileMoreItems\.some/)
  assert.match(layout, /moreOpen \|\| moreActive \? 'text-primary-800'/)
})
