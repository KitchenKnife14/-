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
    // BrowserRouter uses history URLs: production hosting must return the app shell
    // for direct navigation to nested routes, not a server-side 404.
    const nestedResponse = await fetch(new URL('/transactions', origin))
    assert.equal(nestedResponse.status, 200, 'nested transaction route must resolve to the SPA shell')
    assert.match(nestedResponse.headers.get('content-type') || '', /text\\/html/)
    const nestedHtml = await nestedResponse.text()
    assert.ok(nestedHtml.includes('<div id="root"></div>'), 'nested route must serve the React root')
    assert.ok(nestedHtml.includes(scriptMatch[1]), 'nested route must reference the production app bundle')
    console.log('Vite preview smoke test passed')
  } finally { child.kill('SIGTERM') }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
