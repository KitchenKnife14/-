const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { chromium } = require('playwright')

const baseUrl = 'http://127.0.0.1:4173'

async function waitForServer(url, child) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite preview exited early with code ${child.exitCode}`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('Vite preview did not become ready within 20 seconds')
}

async function main() {
  const server = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
    stdio: 'ignore',
    env: process.env,
  })
  let browser
  try {
    await waitForServer(baseUrl, server)
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Бюджет для двоих' }).waitFor()
    assert.equal(await page.getByLabel('Email').count(), 1)
    assert.equal(await page.getByLabel('Пароль').count(), 1)
    assert.equal(await page.getByRole('button', { name: 'Войти' }).count(), 1)

    await page.getByRole('button', { name: 'Регистрация' }).click()
    assert.equal(await page.getByLabel('Имя').count(), 1)
    const password = page.getByLabel('Пароль')
    await password.fill('short')
    const shortPasswordState = await password.evaluate(input => ({
      minLength: input.minLength,
      tooShort: input.validity.tooShort,
      formValid: input.form.checkValidity(),
    }))
    assert.equal(shortPasswordState.minLength, 15)
    assert.equal(shortPasswordState.tooShort, true)
    assert.equal(shortPasswordState.formValid, false)

    await password.fill('long-enough-pass')
    assert.equal(await password.evaluate(input => input.validity.tooShort), false)
    await page.getByRole('button', { name: 'Вход' }).click()
    assert.equal(await page.getByLabel('Имя').count(), 0)
    assert.equal(await page.getByLabel('Email').count(), 1)

    const mobileWidths = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }))
    assert.ok(mobileWidths.document <= mobileWidths.viewport + 1, `Mobile horizontal overflow: ${JSON.stringify(mobileWidths)}`)
    assert.ok(mobileWidths.body <= mobileWidths.viewport + 1, `Mobile body overflow: ${JSON.stringify(mobileWidths)}`)

    await page.setViewportSize({ width: 1280, height: 900 })
    const desktopWidths = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }))
    assert.ok(desktopWidths.document <= desktopWidths.viewport + 1, `Desktop horizontal overflow: ${JSON.stringify(desktopWidths)}`)
    assert.ok(desktopWidths.body <= desktopWidths.viewport + 1, `Desktop body overflow: ${JSON.stringify(desktopWidths)}`)

    process.stdout.write(JSON.stringify({
      result: 'PASS',
      checks: [
        'unauthenticated login page renders',
        'labels and controls are associated',
        'signup password minimum is enforced by the browser',
        'login/signup mode switch works',
        'mobile viewport has no horizontal overflow',
        'desktop viewport has no horizontal overflow',
      ],
      mobileWidths,
      desktopWidths,
    }) + '\n')
  } finally {
    if (browser) await browser.close()
    server.kill('SIGTERM')
  }
}

main().catch(error => {
  process.stderr.write(String(error && error.stack || error) + '\n')
  process.exitCode = 1
})
