const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '../src/context/AuthContext.tsx'), 'utf8')
const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')
const layout = fs.readFileSync(path.join(__dirname, '../src/components/Layout.tsx'), 'utf8')
const onboarding = fs.readFileSync(path.join(__dirname, '../src/pages/OnboardingPage.tsx'), 'utf8')
const authPage = fs.readFileSync(path.join(__dirname, '../src/pages/AuthPage.tsx'), 'utf8')
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
  assert.match(layout, /navigate\('\/', \{ replace: true \}\)/)
})


test('mobile navigation exposes four primary routes and all remaining routes in More menu', () => {
  assert.match(layout, /const mobilePrimary = \['\/', '\/transactions', '\/accounts', '\/budgets'\]/)
  assert.match(layout, /const mobileMoreItems = navItems\.filter\(item => !mobilePrimary\.includes\(item\.to\)\)/)
  assert.match(layout, /aria-label="Нижняя навигация"/)
  assert.match(layout, /aria-label="Дополнительная навигация"/)
  assert.match(layout, /aria-expanded=\{moreOpen\}/)
  assert.match(layout, /pb-\[env\(safe-area-inset-bottom\)\]/)
  assert.match(layout, /pb-28/)
  assert.match(layout, /family\?\.invite_code \|\| 'Недоступен'/)
  assert.match(layout, /Выйти/)
  assert.doesNotMatch(layout, /overflow-x-auto px-4 pb-3/)
})

test('mobile navigation has an explicit active state for routes placed in More', () => {
  assert.match(layout, /const moreActive = mobileMoreItems\.some/)
  assert.match(layout, /moreOpen \|\| moreActive \? 'text-primary-800'/)
})


test('onboarding refreshes the authoritative auth context after a successful family RPC', () => {
  const create = onboarding.indexOf("googleSheets.rpc('create_family'")
  const join = onboarding.indexOf("googleSheets.rpc('join_family_by_invite'")
  const refresh = onboarding.indexOf('await refresh()')
  const navigate = onboarding.indexOf("navigate('/')", refresh)
  assert.ok(create >= 0 && join >= 0 && refresh > create && refresh > join && navigate > refresh)
  assert.doesNotMatch(onboarding, /googleSheets\.rpc\('get_my_context'/)
  assert.match(app, /if \(session && error\)/)
})


test('session adapter degrades safely when browser storage is unavailable', () => {
  const adapter = fs.readFileSync(path.join(__dirname, '../src/lib/googleSheets.ts'), 'utf8')
  assert.match(adapter, /let volatileSession: GoogleSession \| null = null/)
  assert.match(adapter, /catch \{\n    return volatileSession/)
  assert.match(adapter, /volatileSession = session/)
  assert.match(adapter, /try \{ localStorage\.setItem\(SESSION_KEY, JSON\.stringify\(session\)\) \} catch \{\}/)
  assert.match(adapter, /volatileSession = null\n    try \{ localStorage\.removeItem\(SESSION_KEY\) \} catch \{\}/)
})


test('authenticated context errors show retry instead of sending the user to onboarding', () => {
  const errorGate = app.indexOf('if (session && error)')
  const onboardingGate = app.indexOf('if (!family)')
  assert.ok(errorGate >= 0 && onboardingGate > errorGate, 'context loading errors must be handled before the no-family onboarding route')
  assert.match(app, /Не удалось загрузить семейное пространство/)
  assert.match(app, /onClick=\{\(\) => void refresh\(\)\}/)
})


test('auth and onboarding forms prevent mode/input changes during submission', () => {
  assert.match(authPage, /autoComplete=\{mode === 'signin' \? 'username' : 'email'\}/)
  assert.match(authPage, /autoComplete=\{mode === 'signin' \? 'current-password' : 'new-password'\}/)
  assert.match(authPage, /disabled=\{loading\}/)
  assert.match(onboarding, /onClick=\{\(\) => setMode\('create'\)\} className=/)
  assert.match(onboarding, /type="button" disabled=\{loading\}/)
  assert.match(onboarding, /autoComplete="name" disabled=\{loading\}/)
  assert.match(onboarding, /id="onboarding-invite-code" className="input" disabled=\{loading\}/)
})

test('React Router navigation targets are fixed internal paths, never user-controlled URLs', () => {
  const destinations = [...layout.matchAll(/to: '([^']+)'/g)].map(match => match[1])
  assert.equal(destinations.length, 14)
  for (const destination of destinations) {
    assert.equal(destination[0], '/')
    assert.equal(destination.startsWith('//'), false)
    assert.ok([...destination.slice(1)].every(char => /[a-z-]/.test(char)))
    assert.equal(/[\\\\:? #%]/.test(destination), false)
  }
  const routePaths = [...app.matchAll(/<Route path="([^"]+)"/g)].map(match => match[1])
  assert.ok(routePaths.length >= 14)
  for (const routePath of routePaths) assert.ok(routePath === '*' || [...routePath].every(char => /[a-z-]/.test(char)))
  assert.ok(app.includes('<Navigate to="/" replace />'))
  assert.ok(layout.includes("navigate('/', { replace: true })"))
  assert.ok(onboarding.includes("navigate('/')"))
  assert.equal(app.includes('navigate(`'), false)
  assert.equal(layout.includes('navigate(`'), false)
  assert.equal(onboarding.includes('navigate(`'), false)
})

test('React Router and Vite lockfile contain the patched dependency lines', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'))
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8'))
  const viteConfig = fs.readFileSync(path.join(__dirname, '../vite.config.ts'), 'utf8')
  assert.ok(packageJson.dependencies['react-router-dom'].startsWith('^7.'))
  assert.equal(lock.packages['node_modules/react-router-dom'].version, '7.18.5')
  assert.equal(lock.packages['node_modules/react-router'].version, '7.18.5')
  assert.equal(lock.packages['node_modules/vite'].version, '6.4.6')
  assert.ok(viteConfig.includes("host: '127.0.0.1'"))
})

test('React Router v7 sends hostile URL-shaped paths to the internal fallback route', async () => {
  const { matchRoutes } = await import('react-router-dom')
  const routes = [{
    path: '/',
    children: [
      { index: true },
      { path: 'transactions' },
      { path: 'accounts' },
      { path: 'calendar' },
      { path: 'recurring' },
      { path: 'budgets' },
      { path: 'goals' },
      { path: 'purchases' },
      { path: 'planning' },
      { path: 'reports' },
      { path: 'analysis' },
      { path: 'notifications' },
      { path: 'telegram' },
      { path: 'categories' },
      { path: '*' },
    ],
  }]
  const hostilePaths = ['//evil.example', '/\\\\evil.example', '/https://evil.example', '/%5c%5cevil.example']
  for (const pathname of hostilePaths) {
    const matches = matchRoutes(routes, pathname)
    assert.ok(matches, 'router should resolve fallback for ' + pathname)
    assert.equal(matches[matches.length - 1].route.path, '*', 'hostile path must not match a named internal route: ' + pathname)
  }
})
