const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const path = require('node:path')

const port = 4173
const origin = 'http://127.0.0.1:' + port
const child = spawn(process.execPath, [path.join(process.cwd(), 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
child.stdout.on('data', chunk => { output += chunk.toString() })
child.stderr.on('data', chunk => { output += chunk.toString() })

async function waitForPreview() {
  const deadline = Date.now() + 15000
  let lastError
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Vite preview exited early: ' + output)
    try {
      const response = await fetch(origin)
      if (response.ok) return response
      lastError = new Error('Preview returned HTTP ' + response.status)
    } catch (error) { lastError = error }
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error('Vite preview did not become ready: ' + (lastError && lastError.message || 'timeout') + '\n' + output)
}

async function main() {
  try {
    const response = await waitForPreview()
    const html = await response.text()
    assert.ok(html.includes('<div id="root"></div>'), 'production index.html must contain the React root')
    const scriptMatch = html.match(/src="([^"]+\.js)"/)
    assert.ok(scriptMatch, 'built index.html must reference a production JavaScript bundle')
    const scriptResponse = await fetch(new URL(scriptMatch[1], origin))
    assert.equal(scriptResponse.status, 200)
    assert.match(scriptResponse.headers.get('content-type') || '', /javascript/)
    const script = await scriptResponse.text()
    assert.ok(script.length > 1000, 'production JavaScript bundle must not be empty')
    // BrowserRouter uses history URLs: every registered page must be directly
    // reachable after refresh, not only after client-side navigation from "/".
    // Derive the route list from the actual React route declarations so the
    // smoke test cannot silently miss a page added to App.tsx later.
    const fs = require('node:fs')
    const appSource = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8')
    const routes = [...appSource.matchAll(/<Route\\s+path="([^"]+)"/g)]
      .map(match => match[1])
      .filter(route => route !== '*')
      .map(route => '/' + route.replace(/^\\//, ''))
    assert.ok(routes.length >= 10, 'expected to discover all registered application routes')
    assert.ok(routes.includes('/transactions'), 'transactions route must be covered')
    assert.equal(new Set(routes).size, routes.length, 'route declarations must be unique')
    for (const route of routes) {
      const routeResponse = await fetch(new URL(route, origin))
      assert.equal(routeResponse.status, 200, route + ' must resolve to the SPA shell')
      assert.ok((routeResponse.headers.get('content-type') || '').includes('text/html'), route + ' must return HTML')
      const routeHtml = await routeResponse.text()
      assert.ok(routeHtml.includes('<div id="root"></div>'), route + ' must serve the React root')
      assert.ok(routeHtml.includes(scriptMatch[1]), route + ' must reference the production app bundle')
    }
    console.log('Vite preview smoke test passed')
  } finally { child.kill('SIGTERM') }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
