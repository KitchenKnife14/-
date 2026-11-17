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
    assert.equal(shortPasswordState.minLength, 8)
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


    // Exercise the real React auth and Telegram screens against an isolated API fixture.
    // No real Apps Script, user account, Telegram bot, or spreadsheet is contacted.
    const authPage = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    let telegramStatusReads = 0
    await authPage.route('https://test-gas.invalid/exec', async route => {
      const payload = route.request().postDataJSON()
      const resolveRequest = request => {
        if (request.action === 'signin') {
          assert.equal(request.email, 'browser-test@example.com')
          assert.equal(request.password, 'correct-test-password')
          return {
            token: 'synthetic-browser-session-token',
            user: { id: 'browser-test-user', email: 'browser-test@example.com' },
          }
        }
        if (request.action === 'rpc' && request.name === 'get_my_context') {
          return {
            profile: { id: 'browser-test-user', display_name: 'Тестовый участник', family_id: 'browser-test-family' },
            family: { id: 'browser-test-family', name: 'Тестовая семья', invite_code: 'TEST-INVITE' },
            members: [],
            member_profiles: [{ id: 'browser-test-user', display_name: 'Тестовый участник' }],
          }
        }
        if (request.action === 'rpc' && request.name === 'ensure_supplemental_categories') return { added: 0 }
        if (request.action === 'rpc' && request.name === 'get_table_revision') return '1'
        if (request.action === 'rpc' && request.name === 'get_telegram_link_status') {
          telegramStatusReads += 1
          return { linked: telegramStatusReads > 1, linked_at: '2026-11-17T10:00:00.000Z' }
        }
        if (request.action === 'rpc' && request.name === 'create_telegram_link_code') {
          return { code: 'a1b2c3d4e5f6', expires_at: '2026-11-17T10:15:00.000Z' }
        }
        if (request.action === 'query' && ['transactions', 'categories', 'accounts'].includes(request.table)) return []
        if (request.action === 'signout') return {}
        throw new Error('Unexpected browser E2E API request: ' + JSON.stringify(request))
      }
      const data = payload.action === 'batch'
        ? payload.requests.map(request => ({ data: resolveRequest(request), error: null }))
        : resolveRequest(payload)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ data, error: null }),
      })
    })

    await authPage.goto(baseUrl, { waitUntil: 'networkidle' })
    await authPage.getByLabel('Email').fill('browser-test@example.com')
    await authPage.getByLabel('Пароль').fill('correct-test-password')
    await authPage.getByRole('button', { name: 'Войти' }).click()
    await authPage.getByText('Тестовый участник', { exact: true }).waitFor()
    await authPage.getByRole('link', { name: 'Telegram' }).click()
    await authPage.getByRole('heading', { name: 'Telegram' }).waitFor()
    await authPage.getByRole('button', { name: 'Создать код привязки' }).click()
    await authPage.getByText('a1b2c3d4e5f6', { exact: true }).waitFor()
    await authPage.getByRole('button', { name: 'Проверить подключение' }).click()
    await authPage.getByText('Telegram привязан', { exact: true }).waitFor()
    assert.equal(telegramStatusReads, 2)

    // Exercise authenticated history navigation and direct SPA deep links.
    await authPage.getByRole('link', { name: 'Главная' }).click()
    await authPage.waitForURL('http://127.0.0.1:4173/')
    await authPage.goBack()
    await authPage.waitForURL('http://127.0.0.1:4173/telegram')
    await authPage.getByRole('heading', { name: 'Telegram' }).waitFor()
    await authPage.goForward()
    await authPage.waitForURL('http://127.0.0.1:4173/')
    await authPage.goto(baseUrl + '/telegram', { waitUntil: 'networkidle' })
    await authPage.getByRole('heading', { name: 'Telegram' }).waitFor()
    await authPage.reload({ waitUntil: 'networkidle' })
    await authPage.getByRole('heading', { name: 'Telegram' }).waitFor()
    await authPage.goto(baseUrl + '/not-a-real-section', { waitUntil: 'networkidle' })
    await authPage.waitForURL('http://127.0.0.1:4173/')
    await authPage.goto(baseUrl + '/%5c%5cevil.example', { waitUntil: 'networkidle' })
    await authPage.waitForURL('http://127.0.0.1:4173/')
    assert.equal(new URL(authPage.url()).origin, baseUrl, 'hostile backslash path must remain on the app origin')

    // Exercise the mobile More menu, invite code, Telegram destination, and logout.
    await authPage.setViewportSize({ width: 390, height: 844 })
    await authPage.goto(baseUrl, { waitUntil: 'networkidle' })
    await authPage.getByRole('button', { name: 'Открыть дополнительные разделы' }).click()
    await authPage.locator('aside').getByText('TEST-INVITE', { exact: true }).waitFor()
    const moreLinks = authPage.getByRole('navigation', { name: 'Дополнительная навигация' }).getByRole('link')
    assert.equal(await moreLinks.count(), 10, 'mobile More menu must expose all ten secondary sections')
    for (const label of ['Календарь', 'Регулярные платежи', 'Цели', 'Планируемые покупки', 'Планирование', 'Отчёты', 'Анализ по участникам', 'Уведомления', 'Категории', 'Telegram']) {
      assert.equal(await authPage.getByRole('navigation', { name: 'Дополнительная навигация' }).getByRole('link', { name: label }).count(), 1, 'missing mobile menu item: ' + label)
    }
    await authPage.getByRole('navigation', { name: 'Дополнительная навигация' }).getByRole('link', { name: 'Telegram' }).click()
    await authPage.getByRole('heading', { name: 'Telegram' }).waitFor()
    assert.equal(await authPage.getByRole('button', { name: 'Открыть дополнительные разделы' }).count(), 1, 'More menu should close after selecting a route')
    const mobileMenuWidths = await authPage.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }))
    assert.ok(mobileMenuWidths.document <= mobileMenuWidths.viewport + 1, `Mobile menu horizontal overflow: ${JSON.stringify(mobileMenuWidths)}`)
    assert.ok(mobileMenuWidths.body <= mobileMenuWidths.viewport + 1, `Mobile menu body overflow: ${JSON.stringify(mobileMenuWidths)}`)
    await authPage.getByRole('button', { name: 'Открыть дополнительные разделы' }).click()
    await authPage.getByRole('button', { name: 'Выйти' }).click()
    await authPage.getByRole('heading', { name: 'Бюджет для двоих' }).waitFor()

    await authPage.close()

    process.stdout.write(JSON.stringify({
      result: 'PASS',
      checks: [
        'unauthenticated login page renders',
        'labels and controls are associated',
        'signup password minimum is enforced by the browser',
        'login/signup mode switch works',
        'mobile viewport has no horizontal overflow',
        'desktop viewport has no horizontal overflow',
        'browser login creates a session and loads the family context',
        'Telegram linking code is created and linked status refreshes',
        'authenticated back/forward navigation preserves the correct route',
        'authenticated deep links survive direct navigation and reload',
        'unknown SPA paths return to the internal home route',
        'hostile backslash paths cannot navigate away from the app origin',
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
