const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { chromium, webkit } = require('playwright')

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

async function checkMobileRoutes(browser) {
  // Smoke every authenticated page with empty, well-formed test data at narrow iPhone widths.
  const routesPage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const routePageErrors = []
  routesPage.on('pageerror', error => routePageErrors.push(error.message))
  await routesPage.route('https://test-gas.invalid/exec', async route => {
    const payload = route.request().postDataJSON()
    const resolveRequest = request => {
      if (request.action === 'signin') return {
        token: 'synthetic-route-smoke-session',
        user: { id: 'route-smoke-user', email: 'route-smoke@example.com' },
      }
      if (request.action === 'rpc' && request.name === 'get_my_context') return {
        profile: { id: 'route-smoke-user', display_name: 'Проверка экранов' },
        family: { id: 'route-smoke-family', name: 'Тестовая семья', invite_code: 'ROUTE-SMOKE' },
        members: [],
        member_profiles: [{ id: 'route-smoke-user', display_name: 'Проверка экранов' }],
      }
      if (request.action === 'rpc' && request.name === 'get_table_revision') return '1'
      if (request.action === 'rpc' && request.name === 'get_telegram_link_status') return { linked: false }
      if (request.action === 'rpc') return {}
      if (request.action === 'query') return []
      if (request.action === 'signout') return {}
      throw new Error('Unexpected route smoke API request: ' + JSON.stringify(request))
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
  await routesPage.goto(baseUrl, { waitUntil: 'networkidle' })
  await routesPage.getByLabel('Email').fill('route-smoke@example.com')
  await routesPage.getByLabel('Пароль').fill('correct-test-password')
  await routesPage.getByRole('button', { name: 'Войти' }).click()
  await routesPage.locator('main h1').first().waitFor({ state: 'visible' })
  const authenticatedRoutes = [
    ['/', 'Деньги дома. Спокойно, вместе.'],
    ['/transactions', 'Операции'],
    ['/accounts', 'Счета'],
    ['/calendar', 'Финансовый календарь'],
    ['/recurring', 'Регулярные платежи'],
    ['/budgets', 'Бюджеты'],
    ['/goals', 'Финансовые цели'],
    ['/purchases', 'Планируемые покупки'],
    ['/planning', 'Месячное планирование'],
    ['/reports', 'Отчёты'],
    ['/analysis', 'Анализ доходов по участникам'],
    ['/notifications', 'Уведомления'],
    ['/categories', 'Категории'],
    ['/telegram', 'Telegram'],
  ]
  for (const [routePath, heading] of authenticatedRoutes) {
    await routesPage.goto(baseUrl + routePath, { waitUntil: 'networkidle' })
    await routesPage.getByRole('heading', { name: heading, level: 1 }).waitFor({ state: 'visible' })
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
      await routesPage.setViewportSize(viewport)
      const widths = await routesPage.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }))
      assert.equal(widths.viewport, viewport.width, `Unexpected CSS viewport on ${routePath}`)
      assert.ok(widths.document <= widths.viewport + 1, `Horizontal overflow on ${routePath} at ${viewport.width}px: ${JSON.stringify(widths)}`)
      assert.ok(widths.body <= widths.viewport + 1, `Body overflow on ${routePath} at ${viewport.width}px: ${JSON.stringify(widths)}`)
    }
  }
  await routesPage.goto(baseUrl + '/transactions', { waitUntil: 'networkidle' })
  await routesPage.getByRole('button', { name: 'Добавить', exact: true }).tap()
  const entryDialog = routesPage.getByRole('dialog')
  await entryDialog.getByLabel('Сумма, ₽').fill('1.37')
  await entryDialog.getByRole('button', { name: 'Отмена', exact: true }).tap()
  await entryDialog.waitFor({ state: 'hidden' })
  assert.deepEqual(routePageErrors, [], 'authenticated pages must render without uncaught browser errors')
  await routesPage.close()
}

async function main() {
  const server = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
    stdio: 'ignore',
    env: process.env,
  })
  let browser
  try {
    await waitForServer(baseUrl, server)
    if (process.argv.includes('--webkit-mobile')) {
      browser = await webkit.launch({ headless: true })
      await checkMobileRoutes(browser)
      process.stdout.write('PASS: WebKit mobile login, 14 routes at 320 and 390 CSS pixels, and transaction entry dialog\n')
      return
    }
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

    // The muted text token must meet WCAG AA for normal text on the app's light surfaces.
    const mutedTextAudit = await authPage.locator('.text-muted').evaluateAll(elements => {
      const luminance = hex => {
        const channels = hex.match(/[a-f0-9]{2}/gi).map(value => parseInt(value, 16) / 255)
        const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
      }
      const foreground = getComputedStyle(elements.find(element => element.getClientRects().length)).color
      const channels = foreground.match(/[0-9.]+/g).slice(0, 3).map(Number)
      const foregroundLuminance = (() => {
        const linear = channels.map(value => {
          const normalized = value / 255
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
      })()
      const backgrounds = ['#ffffff', '#f5f6f1', '#f1f5ef', '#e4ece1', '#dce9de']
      const ratios = backgrounds.map(background => {
        const backgroundLuminance = luminance(background)
        return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
          (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
      })
      return {
        visibleCount: elements.filter(element => element.getClientRects().length > 0).length,
        foreground,
        ratios,
      }
    })
    assert.ok(mutedTextAudit.visibleCount > 0, 'the authenticated UI must expose muted text for contrast testing')
    assert.equal(mutedTextAudit.foreground, 'rgb(89, 101, 89)', 'muted text must use the verified darker token')
    assert.ok(mutedTextAudit.ratios.every(ratio => ratio >= 4.5), `Muted text contrast must meet 4.5:1 on light app surfaces: ${JSON.stringify(mutedTextAudit)}`)
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

    // Exercise the transaction dialog at common iPhone widths; it must remain inside the visual viewport.
    await authPage.setViewportSize({ width: 390, height: 844 })
    await authPage.goto(baseUrl, { waitUntil: 'networkidle' })
    const bottomNav = authPage.getByRole('navigation', { name: 'Нижняя навигация' })
    const navLayout = await bottomNav.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return { position: getComputedStyle(element).position, bottom: rect.bottom, viewportHeight: window.innerHeight }
    })
    assert.equal(navLayout.position, 'relative', 'the inner nav row should remain in normal flow inside the fixed bottom bar')
    const bottomBar = await bottomNav.evaluate(element => {
      const bar = element.parentElement
      const rect = bar.getBoundingClientRect()
      return { position: getComputedStyle(bar).position, bottom: rect.bottom, viewportHeight: window.innerHeight }
    })
    assert.equal(bottomBar.position, 'fixed', 'mobile navigation bar must be fixed to the bottom of the viewport')
    assert.ok(bottomBar.bottom >= bottomBar.viewportHeight - 1, 'mobile navigation bar must sit at the bottom edge')
    await authPage.getByRole('button', { name: 'Добавить операцию' }).click()
    const transactionDialog = authPage.getByRole('dialog', { name: 'Новая операция' })
    await transactionDialog.waitFor()
    assert.equal(await transactionDialog.evaluate(element => getComputedStyle(element).overflowY), 'auto', 'dialog content must scroll internally when it exceeds the viewport')

    // Transaction type controls expose their selected state, and the dialog traps keyboard focus in both directions.
    const typeGroup = transactionDialog.getByRole('group', { name: 'Тип операции' })
    const expenseType = typeGroup.getByRole('button', { name: 'Расход' })
    const incomeType = typeGroup.getByRole('button', { name: 'Доход' })
    assert.equal(await expenseType.getAttribute('aria-pressed'), 'true', 'expense must be announced as the selected operation type')
    assert.equal(await incomeType.getAttribute('aria-pressed'), 'false')
    await incomeType.focus()
    await authPage.keyboard.press('Enter')
    assert.equal(await incomeType.getAttribute('aria-pressed'), 'true', 'keyboard activation must update the selected operation type')
    await expenseType.focus()
    await authPage.keyboard.press('Space')
    assert.equal(await expenseType.getAttribute('aria-pressed'), 'true')

    const dialogCloseButton = transactionDialog.getByRole('button', { name: 'Закрыть' })
    const dialogSaveButton = transactionDialog.getByRole('button', { name: 'Сохранить' })
    await dialogCloseButton.focus()
    await authPage.keyboard.press('Shift+Tab')
    assert.equal(await dialogSaveButton.evaluate(element => element === document.activeElement), true, 'Shift+Tab from the first control must wrap to the last dialog control')
    await authPage.keyboard.press('Tab')
    assert.equal(await dialogCloseButton.evaluate(element => element === document.activeElement), true, 'Tab from the last control must wrap to the first dialog control')
    for (const width of [390, 320]) {
      await authPage.setViewportSize({ width, height: 640 })
      const dialogBounds = await transactionDialog.evaluate(element => {
        const rect = element.getBoundingClientRect()
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          viewportWidth: document.documentElement.clientWidth,
          viewportHeight: document.documentElement.clientHeight,
          contentWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        }
      })
      assert.ok(dialogBounds.left >= -1, `Dialog extends beyond left viewport edge: ${JSON.stringify(dialogBounds)}`)
      assert.ok(dialogBounds.right <= dialogBounds.viewportWidth + 1, `Dialog extends beyond right viewport edge: ${JSON.stringify(dialogBounds)}`)
      assert.ok(dialogBounds.top >= -1, `Dialog extends beyond top viewport edge: ${JSON.stringify(dialogBounds)}`)
      assert.ok(dialogBounds.bottom <= dialogBounds.viewportHeight + 1, `Dialog extends beyond bottom viewport edge: ${JSON.stringify(dialogBounds)}`)
      assert.ok(dialogBounds.contentWidth <= dialogBounds.clientWidth + 1, `Dialog content causes horizontal overflow: ${JSON.stringify(dialogBounds)}`)
    }
    await authPage.getByRole('button', { name: 'Закрыть' }).click()
    await authPage.setViewportSize({ width: 390, height: 844 })

    // The mobile More disclosure supports keyboard opening, initial focus, Escape, and focus return.
    await authPage.goto(baseUrl, { waitUntil: 'networkidle' })
    const moreTrigger = authPage.getByRole('button', { name: 'Открыть дополнительные разделы' })
    await moreTrigger.focus()
    await moreTrigger.press('Enter')
    const keyboardMoreLinks = authPage.getByRole('navigation', { name: 'Дополнительная навигация' }).getByRole('link')
    await keyboardMoreLinks.first().waitFor()
    assert.equal(await keyboardMoreLinks.first().evaluate(element => element === document.activeElement), true, 'opening the More menu must move focus to its first link')
    await authPage.keyboard.press('Escape')
    assert.equal(await authPage.getByRole('navigation', { name: 'Дополнительная навигация' }).count(), 0, 'Escape must close the More menu')
    assert.equal(await moreTrigger.evaluate(element => element === document.activeElement), true, 'closing the More menu must restore focus to its trigger')

    // Exercise the mobile More menu, invite code, Telegram destination, and logout.
    await authPage.goto(baseUrl, { waitUntil: 'networkidle' })
    await authPage.getByRole('button', { name: 'Открыть дополнительные разделы' }).click()
    await authPage.getByText('TEST-INVITE', { exact: true }).last().waitFor()
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

    await authPage.setViewportSize({ width: 1280, height: 900 })

    // A browser may deny localStorage access (privacy settings, sandbox or security policy).
    // Login should still work in memory for this tab, without persisting the bearer token.
    const blockedStorageErrors = []
    authPage.on('pageerror', error => blockedStorageErrors.push(error.message))
    await authPage.evaluate(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { throw new DOMException('Storage access denied', 'SecurityError') },
      })
    })
    assert.equal(await authPage.evaluate(() => {
      try { localStorage.getItem('budget_google_session_v1'); return false } catch { return true }
    }), true, 'localStorage must actually be inaccessible during this scenario')
    await authPage.getByLabel('Email').fill('browser-test@example.com')
    await authPage.getByLabel('Пароль').fill('correct-test-password')
    await authPage.getByRole('button', { name: 'Войти' }).click()
    await authPage.getByText('Тестовый участник', { exact: true }).waitFor()
    await authPage.getByRole('link', { name: 'Telegram' }).click()
    await authPage.getByRole('heading', { name: 'Telegram' }).waitFor()
    await authPage.reload({ waitUntil: 'networkidle' })
    await authPage.getByRole('heading', { name: 'Бюджет для двоих' }).waitFor()
    assert.deepEqual(blockedStorageErrors, [], 'blocked storage must not cause uncaught browser errors')

    await authPage.close()

    // Malformed dashboard row payloads must become a visible load error, not a render crash.
    const invalidDataPage = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const pageErrors = []
    invalidDataPage.on('pageerror', error => pageErrors.push(error.message))
    await invalidDataPage.route('https://test-gas.invalid/exec', async route => {
      const payload = route.request().postDataJSON()
      const resolveRequest = request => {
        if (request.action === 'signin') return {
          token: 'synthetic-invalid-data-session',
          user: { id: 'invalid-data-user', email: 'invalid-data@example.com' },
        }
        if (request.action === 'rpc' && request.name === 'get_my_context') return {
          profile: { id: 'invalid-data-user', display_name: 'Проверка данных' },
          family: { id: 'invalid-data-family', name: 'Тестовая семья', invite_code: 'INVALID-DATA' },
          members: [],
          member_profiles: [{ id: 'invalid-data-user', display_name: 'Проверка данных' }],
        }
        if (request.action === 'rpc' && request.name === 'ensure_supplemental_categories') return { added: 0 }
        if (request.action === 'rpc' && request.name === 'get_table_revision') return '1'
        if (request.action === 'query' && request.table === 'transactions') return null
        if (request.action === 'query' && ['categories', 'accounts'].includes(request.table)) return []
        if (request.action === 'signout') return {}
        throw new Error('Unexpected invalid-data E2E API request: ' + JSON.stringify(request))
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
    await invalidDataPage.goto(baseUrl, { waitUntil: 'networkidle' })
    await invalidDataPage.getByLabel('Email').fill('invalid-data@example.com')
    await invalidDataPage.getByLabel('Пароль').fill('correct-test-password')
    await invalidDataPage.getByRole('button', { name: 'Войти' }).click()
    await invalidDataPage.getByRole('alert').getByText('Операции: сервер вернул некорректный список', { exact: true }).waitFor()
    assert.deepEqual(pageErrors, [], 'malformed dashboard payload must not cause an uncaught render error')
    await invalidDataPage.close()

    await checkMobileRoutes(browser)

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
