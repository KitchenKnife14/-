const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { chromium } = require('playwright')

const baseUrl = 'http://127.0.0.1:4174'
const apiUrl = 'https://test-gas.invalid/exec'
const familyId = 'family-e2e'
const userId = 'user-e2e'

const state = {
  accounts: [
    { id: 'account-cash', family_id: familyId, name: 'Наличные', kind: 'cash', starting_balance_kopecks: 100000, archived: false, created_at: '2026-01-01T00:00:00.000Z' },
    { id: 'account-card', family_id: familyId, name: 'Основная карта', kind: 'bank', starting_balance_kopecks: 250000, archived: false, created_at: '2026-01-02T00:00:00.000Z' },
  ],
  categories: [
    { id: 'category-food', family_id: familyId, name: 'Продукты', kind: 'expense', icon: '🛒', archived: false, parent_id: null },
    { id: 'category-home', family_id: familyId, name: 'Дом', kind: 'expense', icon: '🏠', archived: false, parent_id: null },
    { id: 'category-salary', family_id: familyId, name: 'Зарплата', kind: 'income', icon: '💼', archived: false, parent_id: null },
  ],
  transactions: [],
  budgets: [],
  goals: [],
  goal_contributions: [],
  planned_purchases: [],
}
let sequence = 0

function matches(row, filters = []) {
  return filters.every(filter => {
    const actual = row[filter.column]
    const expected = filter.value
    switch (filter.op) {
      case 'eq': return actual === expected
      case 'neq': return actual !== expected
      case 'gt': return actual > expected
      case 'gte': return actual >= expected
      case 'lt': return actual < expected
      case 'lte': return actual <= expected
      case 'in': return (filter.values || []).includes(actual)
      case 'is': return actual === expected
      default: throw new Error('Unsupported filter in E2E fixture: ' + filter.op)
    }
  })
}

function query(payload) {
  const rows = state[payload.table]
  if (!Array.isArray(rows)) throw new Error('Unknown E2E table: ' + payload.table)
  const filters = payload.filters || []
  const selected = rows.filter(row => matches(row, filters))
  if (payload.mode === 'select') {
    let result = selected.slice()
    for (const order of [...(payload.orders || [])].reverse()) {
      result.sort((a, b) => {
        const av = a[order.column] ?? ''
        const bv = b[order.column] ?? ''
        const cmp = av < bv ? -1 : av > bv ? 1 : 0
        return order.ascending === false ? -cmp : cmp
      })
    }
    if (Number.isInteger(payload.limit)) result = result.slice(0, payload.limit)
    return result
  }
  if (payload.mode === 'insert' || payload.mode === 'upsert') {
    const values = Array.isArray(payload.values) ? payload.values : [payload.values]
    for (const value of values) {
      if (payload.mode === 'upsert') {
        const key = payload.onConflict || 'id'
        const existing = rows.find(row => row[key] === value[key])
        if (existing) Object.assign(existing, value)
        else rows.push({ ...value })
      } else {
        if (rows.some(row => row.id === value.id)) throw new Error('Duplicate id in E2E fixture')
        rows.push({ ...value })
      }
    }
    return payload.returning ? values : null
  }
  if (payload.mode === 'update') {
    const values = payload.values || {}
    for (const row of selected) Object.assign(row, values)
    return payload.returning ? selected : null
  }
  if (payload.mode === 'delete') {
    const ids = new Set(selected)
    state[payload.table] = rows.filter(row => !ids.has(row))
    return payload.returning ? selected : null
  }
  throw new Error('Unsupported query mode in E2E fixture: ' + payload.mode)
}

function rpc(name, params) {
  if (name === 'get_my_context') {
    return {
      profile: { id: userId, display_name: 'Тестовый пользователь', email: 'e2e@example.test' },
      family: { id: familyId, name: 'Тестовая семья' },
      members: [{ user_id: userId, role: 'owner' }],
      member_profiles: [{ id: userId, display_name: 'Тестовый пользователь' }],
    }
  }
  if (name === 'ensure_supplemental_categories') return { added: 0 }
  if (name === 'get_table_revision') return String(sequence)
  if (name === 'create_goal_with_purchase') {
    const goal = {
      id: 'goal-' + (++sequence),
      family_id: params.p_family_id,
      name: params.p_name,
      description: params.p_description,
      target_kopecks: params.p_target_kopecks,
      saved_kopecks: 0,
      target_date: params.p_target_date,
      priority: params.p_priority,
      status: 'active',
      created_at: new Date().toISOString(),
    }
    state.goals.push(goal)
    if (params.p_create_purchase) {
      state.planned_purchases.push({
        id: 'purchase-' + sequence,
        family_id: params.p_family_id,
        name: params.p_name,
        target_kopecks: params.p_target_kopecks,
        priority: params.p_priority,
        goal_id: goal.id,
      })
    }
    return goal
  }
  throw new Error('Unexpected RPC in financial E2E: ' + name)
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Vite preview exited early: ' + child.exitCode)
    try { const response = await fetch(url); if (response.ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('Vite preview did not become ready')
}

async function main() {
  const server = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], { stdio: 'ignore', env: process.env })
  let browser
  try {
    await waitForServer(baseUrl, server)
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), {
      key: 'budget_google_session_v1',
      session: {
        access_token: 'test-token',
        token_type: 'bearer',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: userId, email: 'e2e@example.test' },
      },
    })
    await context.route(apiUrl, async route => {
      try {
        const payload = JSON.parse(route.request().postData() || '{}')
        const result = payload.action === 'batch'
          ? (payload.requests || []).map(request => {
              try { return { data: request.action === 'rpc' ? rpc(request.name, request.params || {}) : query(request), error: null } }
              catch (error) { return { data: null, error: { message: String(error.message || error) } } }
            })
          : payload.action === 'rpc'
            ? rpc(payload.name, payload.params || {})
            : payload.action === 'query'
              ? query(payload)
              : null
        sequence++
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: result, error: null }) })
      } catch (error) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: null, error: { message: String(error.message || error) } }) })
      }
    })
    const page = await context.newPage()

    await page.goto(baseUrl + '/transactions', { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Операции' }).waitFor()
    const addTransactionButton = page.getByRole('button', { name: 'Добавить' })
    await addTransactionButton.click()
    const transactionDialog = page.getByRole('dialog')
    await transactionDialog.waitFor()
    assert.equal(await transactionDialog.locator('[data-modal-autofocus]').evaluate(element => element === document.activeElement), true, 'dialog must focus its designated initial field')
    const dialogFocusable = transactionDialog.locator('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')
    assert.ok(await dialogFocusable.count() >= 2, 'transaction dialog must expose keyboard-focusable controls')
    const firstDialogControl = dialogFocusable.first()
    const lastDialogControl = dialogFocusable.last()
    await lastDialogControl.focus()
    await page.keyboard.press('Tab')
    assert.equal(await firstDialogControl.evaluate(element => element === document.activeElement), true, 'Tab from the last dialog control must wrap to the first')
    await firstDialogControl.focus()
    await page.keyboard.press('Shift+Tab')
    assert.equal(await lastDialogControl.evaluate(element => element === document.activeElement), true, 'Shift+Tab from the first dialog control must wrap to the last')
    await page.keyboard.press('Escape')
    await transactionDialog.waitFor({ state: 'detached' })
    assert.equal(await addTransactionButton.evaluate(element => element === document.activeElement), true, 'closing the dialog must restore focus to its trigger')

    await addTransactionButton.click()
    await page.getByLabel('Сумма, ₽').fill('123.45')
    await page.getByLabel('Счёт (для расчёта остатка)').selectOption('account-cash')
    await page.getByLabel('Категория').selectOption('category-food')
    await page.getByRole('textbox', { name: 'Описание' }).fill('E2E расход')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('E2E расход', { exact: true }).waitFor()
    assert.equal(state.transactions.length, 1)
    assert.equal(state.transactions[0].amount_kopecks, 12345)
    assert.equal(state.transactions[0].type, 'expense')

    const expenseCard = page.locator('.card').filter({ hasText: 'E2E расход' }).first()
    await expenseCard.getByRole('button', { name: 'Изменить' }).click()
    await page.getByLabel('Сумма, ₽').fill('200.00')
    await page.getByRole('textbox', { name: 'Описание' }).fill('E2E расход изменён')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('E2E расход изменён', { exact: true }).waitFor()
    assert.equal(state.transactions[0].amount_kopecks, 20000)

    await page.getByRole('button', { name: 'Добавить' }).click()
    await page.getByRole('button', { name: 'Перевод' }).click()
    await page.getByLabel('Сумма, ₽').fill('50')
    await page.getByLabel('Со счёта').selectOption('account-cash')
    await page.getByLabel('На счёт').selectOption('account-card')
    await page.getByRole('textbox', { name: 'Описание' }).fill('E2E перевод')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('E2E перевод', { exact: true }).waitFor()
    assert.equal(state.transactions.length, 2)
    assert.equal(state.transactions[1].type, 'transfer')
    assert.equal(state.transactions[1].category_id, null)
    assert.equal(state.transactions[1].to_account_id, 'account-card')

    const transferCard = page.locator('.card').filter({ hasText: 'E2E перевод' }).first()
    await transferCard.getByRole('button', { name: 'Удалить' }).click()
    await page.getByRole('heading', { name: 'Удалить операцию?' }).waitFor()
    await page.locator('button.btn-danger').click()
    await page.getByText('E2E перевод', { exact: true }).waitFor({ state: 'detached' })
    assert.equal(state.transactions.length, 1)

    await page.goto(baseUrl + '/budgets', { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Бюджеты' }).waitFor()
    await page.getByRole('button', { name: 'Бюджет' }).click()
    await page.getByLabel('Категория').selectOption('category-food')
    await page.getByLabel('Лимит на месяц, ₽').fill('12000')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('Продукты', { exact: false }).first().waitFor()
    assert.equal(state.budgets.length, 1)
    assert.equal(state.budgets[0].limit_kopecks, 1200000)

    await page.goto(baseUrl + '/goals', { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Финансовые цели' }).waitFor()
    await page.getByRole('button', { name: 'Цель' }).click()
    await page.getByLabel('Название', { exact: true }).fill('E2E отпуск')
    await page.getByLabel('Описание').fill('Проверка создания цели')
    await page.getByLabel('Сумма цели, ₽').fill('85000')
    await page.getByLabel('Приоритет', { exact: true }).selectOption('2')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('E2E отпуск', { exact: true }).waitFor()
    assert.equal(state.goals.length, 1)
    assert.equal(state.goals[0].target_kopecks, 8500000)
    assert.equal(state.goals[0].priority, 2)

    process.stdout.write(JSON.stringify({
      result: 'PASS',
      checks: [
        'transaction create persists rubles as integer kopecks',
        'transaction edit updates the existing row',
        'transfer stores distinct source/destination accounts and no category',
        'transaction delete removes the row',
        'budget create persists the monthly limit in kopecks',
        'goal create uses the create_goal_with_purchase RPC contract',
      ],
      persisted: {
        transactions: state.transactions.length,
        budgets: state.budgets.length,
        goals: state.goals.length,
      },
    }) + '\n')
    await context.close()
  } finally {
    if (browser) await browser.close()
    server.kill('SIGTERM')
  }
}

main().catch(error => {
  process.stderr.write(String(error && error.stack || error) + '\n')
  process.exitCode = 1
})
