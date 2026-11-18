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
  recurring_payments: [],
  planned_purchases: [],
  budgets: [],
  monthly_plans: [],
  goals: [],
  goal_contributions: [],
}
let sequence = 0
let transactionInsertRequests = 0
let transactionReadDelayMs = 0
let transactionReadError = null
let transactionReadRequests = 0
let tableRevision = 1
let revisionReadRequests = 0

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

function syncGoalTotals(goalIds) {
  for (const goalId of new Set(goalIds.filter(Boolean))) {
    const goal = state.goals.find(row => row.id === goalId)
    if (!goal) continue
    goal.saved_kopecks = state.goal_contributions
      .filter(row => row.goal_id === goalId)
      .reduce((sum, row) => sum + row.amount_kopecks, 0)
  }
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
        const keyColumns = (payload.onConflict || 'id').split(',').map(column => column.trim())
        const existing = rows.find(row => keyColumns.every(column => (row[column] ?? null) === (value[column] ?? null)))
        if (existing) Object.assign(existing, value)
        else rows.push({ ...value, id: value.id || 'fixture-' + payload.table + '-' + (++sequence) })
      } else {
        if (rows.some(row => row.id === value.id)) throw new Error('Duplicate id in E2E fixture')
        rows.push({ ...value })
      }
    }
    if (payload.table === 'goal_contributions') syncGoalTotals(values.map(row => row.goal_id))
    return payload.returning ? values : null
  }
  if (payload.mode === 'update') {
    const values = payload.values || {}
    const affectedGoalIds = selected.flatMap(row => [row.goal_id, values.goal_id])
    for (const row of selected) Object.assign(row, values)
    if (payload.table === 'goal_contributions') syncGoalTotals(affectedGoalIds)
    return payload.returning ? selected : null
  }
  if (payload.mode === 'delete') {
    const selectedRows = new Set(selected)
    const selectedIds = new Set(selected.map(row => row.id))
    state[payload.table] = rows.filter(row => !selectedRows.has(row))
    if (payload.table === 'goal_contributions') syncGoalTotals(selected.map(row => row.goal_id))
    if (payload.table === 'recurring_payments') {
      for (const transaction of state.transactions) {
        if (selectedIds.has(transaction.parent_recurring_id)) transaction.parent_recurring_id = ''
      }
    }
    if (payload.table === 'transactions') {
      for (const purchase of state.planned_purchases) {
        if (selectedIds.has(purchase.linked_transaction_id)) {
          purchase.linked_transaction_id = ''
          if (purchase.status === 'bought') purchase.status = 'planned'
        }
      }
    }
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
  if (name === 'get_table_revision') { revisionReadRequests++; return String(tableRevision) }
  if (name === 'create_goal_with_purchase') {
    const goalId = 'goal_' + params.p_request_id
    let goal = state.goals.find(row => row.id === goalId)
    if (!goal) {
      goal = {
        id: goalId,
        family_id: params.p_family_id,
        name: params.p_name,
        description: params.p_description,
        target_kopecks: params.p_target_kopecks,
        saved_kopecks: 0,
        target_date: params.p_target_date || null,
        priority: params.p_priority,
        status: 'active',
        responsible_user_id: userId,
        created_at: new Date().toISOString(),
      }
      state.goals.push(goal)
    }
    let purchaseId = null
    if (params.p_create_purchase) {
      purchaseId = 'purchase_' + params.p_request_id
      if (!state.planned_purchases.some(row => row.id === purchaseId)) {
        state.planned_purchases.push({
          id: purchaseId,
          family_id: params.p_family_id,
          name: params.p_name,
          category_id: null,
          estimated_kopecks: params.p_target_kopecks,
          priority: params.p_priority,
          desired_month: params.p_target_date ? params.p_target_date.slice(0, 7) + '-01' : null,
          desired_date: params.p_target_date || null,
          url: '',
          comment: params.p_description || '',
          status: 'planned',
          responsible_user_id: userId,
          goal_id: goal.id,
          linked_transaction_id: '',
          created_by: userId,
          created_at: new Date().toISOString(),
        })
      }
    }
    return { goal_id: goalId, purchase_id: purchaseId }
  }
  if (name === 'confirm_planned_purchase') {
    const purchase = state.planned_purchases.find(row => row.id === params.p_purchase_id)
    if (!purchase) throw new Error('Планируемая покупка не найдена')
    const transactionId = 'purchase_' + purchase.id
    if (!state.transactions.some(row => row.id === transactionId)) {
      state.transactions.push({
        id: transactionId,
        family_id: purchase.family_id,
        type: 'expense',
        amount_kopecks: purchase.estimated_kopecks,
        operation_date: params.p_operation_date,
        operation_time: null,
        category_id: purchase.category_id || null,
        account_id: params.p_account_id || null,
        to_account_id: null,
        description: purchase.name,
        created_by: userId,
        updated_by: userId,
        responsible_user_id: purchase.responsible_user_id || purchase.created_by || userId,
        planned: false,
        parent_recurring_id: null,
      })
    }
    purchase.status = 'bought'
    purchase.linked_transaction_id = transactionId
    return { transaction_id: transactionId }
  }
  if (name === 'confirm_recurring_payment') {
    const recurring = state.recurring_payments.find(row => row.id === params.p_recurring_id)
    if (!recurring) throw new Error('Регулярный платёж не найден')
    const dueDate = params.p_expected_due_date
    const transactionId = 'recurring_' + recurring.id + '_' + dueDate
    if (!state.transactions.some(row => row.id === transactionId)) {
      state.transactions.push({
        id: transactionId,
        family_id: recurring.family_id,
        type: recurring.type,
        amount_kopecks: recurring.amount_kopecks,
        operation_date: params.p_operation_date,
        operation_time: null,
        category_id: recurring.category_id || null,
        account_id: recurring.account_id || null,
        to_account_id: null,
        description: recurring.description,
        created_by: userId,
        updated_by: userId,
        responsible_user_id: recurring.responsible_user_id || recurring.created_by || userId,
        planned: false,
        parent_recurring_id: recurring.id,
      })
    }
    const next = new Date(dueDate + 'T12:00:00.000Z')
    const days = recurring.frequency === 'custom' ? Math.max(1, Number(recurring.custom_interval_days) || 30) : recurring.frequency === 'weekly' ? 7 : recurring.frequency === 'daily' ? 1 : 30
    next.setUTCDate(next.getUTCDate() + days)
    recurring.next_due_date = next.toISOString().slice(0, 10)
    if (recurring.end_date && recurring.next_due_date > recurring.end_date) recurring.active = false
    return true
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
    await context.addInitScript(() => {
      const nativeSetInterval = window.setInterval.bind(window)
      window.setInterval = (handler, timeout, ...args) => nativeSetInterval(handler, timeout === 15000 ? 100 : timeout, ...args)
    })
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
              try {
                if (request.action === 'query' && request.table === 'transactions' && request.mode === 'select' && transactionReadError) throw new Error(transactionReadError)
                return { data: request.action === 'rpc' ? rpc(request.name, request.params || {}) : query(request), error: null }
              } catch (error) { return { data: null, error: { message: String(error.message || error) } } }
            })
          : payload.action === 'rpc'
            ? rpc(payload.name, payload.params || {})
            : payload.action === 'query'
              ? (() => {
                  if (payload.table === 'transactions' && payload.mode === 'select' && transactionReadError) throw new Error(transactionReadError)
                  return query(payload)
                })()
              : null
        const transactionReads = payload.action === 'batch'
          ? (payload.requests || []).some(request => request.action === 'query' && request.table === 'transactions' && request.mode === 'select')
          : payload.action === 'query' && payload.table === 'transactions' && payload.mode === 'select'
        if (transactionReads) transactionReadRequests++
        if (transactionReads && transactionReadDelayMs > 0) await new Promise(resolve => setTimeout(resolve, transactionReadDelayMs))
        const transactionInserts = payload.action === 'batch'
          ? (payload.requests || []).filter(request => request.action === 'query' && request.table === 'transactions' && request.mode === 'insert').length
          : payload.action === 'query' && payload.table === 'transactions' && payload.mode === 'insert' ? 1 : 0
        if (transactionInserts) {
          transactionInsertRequests += transactionInserts
          await new Promise(resolve => setTimeout(resolve, 250))
        }
        sequence++
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: result, error: null }) })
      } catch (error) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: null, error: { message: String(error.message || error) } }) })
      }
    })
    const page = await context.newPage()

    transactionReadDelayMs = 400
    const initialNavigation = page.goto(baseUrl + '/transactions', { waitUntil: 'domcontentloaded' })
    await page.getByText('Загрузка…', { exact: true }).waitFor()
    await initialNavigation
    await page.getByRole('heading', { name: 'Операции' }).waitFor()
    await page.getByText('Операций за этот месяц нет.', { exact: true }).waitFor()
    transactionReadDelayMs = 0

    transactionReadError = 'Тестовая ошибка загрузки операций'
    await page.getByRole('button', { name: 'Следующий месяц' }).click()
    await page.getByText('Тестовая ошибка загрузки операций', { exact: true }).waitFor()
    assert.equal(await page.getByText('Операций за этот месяц нет.', { exact: true }).count(), 0, 'a failed load must not be presented as an empty month')
    transactionReadError = null
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
    await page.getByText('Операций за этот месяц нет.', { exact: true }).waitFor()

    // Realtime refresh must use the latest month selection and keep current client-side filters.
    await page.getByRole('button', { name: 'Следующий месяц' }).click()
    await page.getByText('Операций за этот месяц нет.', { exact: true }).waitFor()
    await page.getByLabel('Поиск операций').fill('Обновление после подписки')
    await page.getByLabel('Фильтр по типу операции').selectOption('expense')
    await page.getByLabel('Фильтр по категории операции').selectOption('category-food')
    const revisionDeadline = Date.now() + 3000
    while (revisionReadRequests < 1 && Date.now() < revisionDeadline) await new Promise(resolve => setTimeout(resolve, 20))
    assert.ok(revisionReadRequests > 0, 'realtime subscription must read the initial table revision')
    const transactionReadsBeforeRealtime = transactionReadRequests
    const nextMonth = new Date()
    nextMonth.setUTCDate(15)
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
    const nextMonthDate = nextMonth.toISOString().slice(0, 10)
    state.transactions.push({
      id: 'transaction-realtime-refresh', family_id: familyId, type: 'expense', amount_kopecks: 9876,
      operation_date: nextMonthDate, operation_time: null, category_id: 'category-food', account_id: 'account-cash',
      to_account_id: null, description: 'Обновление после подписки', created_by: userId, updated_by: userId,
      responsible_user_id: userId, planned: false, parent_recurring_id: null,
    })
    tableRevision++
    const refreshDeadline = Date.now() + 7000
    while (transactionReadRequests <= transactionReadsBeforeRealtime && Date.now() < refreshDeadline) await new Promise(resolve => setTimeout(resolve, 20))
    assert.ok(transactionReadRequests > transactionReadsBeforeRealtime, `revision change must trigger a fresh transactions read (revision reads: ${revisionReadRequests}, transaction reads: ${transactionReadRequests})`)
    await page.getByText('Обновление после подписки', { exact: true }).waitFor({ timeout: 2000 })
    assert.equal(state.transactions[0].operation_date, nextMonthDate)
    state.transactions = state.transactions.filter(row => row.id !== 'transaction-realtime-refresh')
    await page.getByLabel('Поиск операций').fill('')
    await page.getByLabel('Фильтр по типу операции').selectOption('all')
    await page.getByLabel('Фильтр по категории операции').selectOption('')
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
    await page.getByText('Операций за этот месяц нет.', { exact: true }).waitFor()

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
    const saveTransactionButton = page.getByRole('button', { name: 'Сохранить' })
    const saveTransactionButtonElement = await saveTransactionButton.elementHandle()
    await saveTransactionButton.click()
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find(element => element.textContent?.trim() === 'Сохранение…')
      return Boolean(button?.disabled)
    }, null, { timeout: 2000 })
    await saveTransactionButtonElement.evaluate(button => button.click())
    await page.getByText('E2E расход', { exact: true }).waitFor()
    assert.equal(transactionInsertRequests, 1, 'a pending transaction save must reject a repeated click')
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
    const deleteTransferButton = transferCard.getByRole('button', { name: 'Удалить' })
    await deleteTransferButton.click()
    const deleteDialog = page.getByRole('dialog')
    await page.getByRole('heading', { name: 'Удалить операцию?' }).waitFor()
    await page.keyboard.press('Escape')
    await deleteDialog.waitFor({ state: 'detached' })
    assert.equal(await deleteTransferButton.evaluate(element => element === document.activeElement), true, 'closing a sequential dialog must restore focus to its trigger')
    await deleteTransferButton.click()
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

    await page.goto(baseUrl + '/planning', { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Месячное планирование' }).waitFor()
    await page.getByRole('button', { name: 'План' }).click()
    await page.getByLabel('Категория').selectOption('category-food')
    await page.getByLabel('Плановая сумма, ₽').fill('5000')
    await page.getByLabel('Заметка').fill('E2E план')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('E2E план', { exact: true }).waitFor()
    assert.equal(state.monthly_plans.length, 1)
    assert.equal(state.monthly_plans[0].planned_kopecks, 500000)
    assert.equal(state.monthly_plans[0].type, 'expense')
    await page.getByRole('button', { name: 'План' }).click()
    await page.getByLabel('Категория').selectOption('category-food')
    await page.getByLabel('Плановая сумма, ₽').fill('7000')
    await page.getByLabel('Заметка').fill('E2E план обновлён')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('E2E план обновлён', { exact: true }).waitFor()
    assert.equal(state.monthly_plans.length, 1, 'monthly plan upsert must update the existing composite key')
    assert.equal(state.monthly_plans[0].planned_kopecks, 700000)
    assert.equal(state.monthly_plans[0].note, 'E2E план обновлён')

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
    const goalCard = page.locator('.card').filter({ hasText: 'E2E отпуск' }).first()
    await goalCard.locator('button[title="Пополнить"]').click()
    const contributionDialog = page.getByRole('dialog')
    await contributionDialog.getByLabel('Сумма, ₽ (минус для снятия)').fill('0')
    await contributionDialog.getByRole('button', { name: 'Пополнить' }).click()
    await page.getByText('Введите корректную положительную сумму с точностью до копейки').waitFor()
    assert.equal(state.goal_contributions.length, 0, 'zero contribution must not write data')
    await contributionDialog.getByLabel('Сумма, ₽ (минус для снятия)').fill('500.25')
    await contributionDialog.getByLabel('Комментарий').fill('E2E взнос')
    await contributionDialog.getByRole('button', { name: 'Пополнить' }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(state.goal_contributions.length, 1)
    assert.equal(state.goal_contributions[0].goal_id, state.goals[0].id)
    assert.equal(state.goal_contributions[0].amount_kopecks, 50025)
    assert.equal(state.goal_contributions[0].note, 'E2E взнос')
    assert.equal(state.goals[0].saved_kopecks, 50025, 'goal saved total must be recalculated from contribution history')
    const updatedGoalCard = page.locator('.card').filter({ hasText: 'E2E отпуск' }).first()
    await updatedGoalCard.locator('button[title="История"]').click()
    await page.getByRole('dialog').getByText('E2E взнос', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })

    await page.getByRole('button', { name: 'Цель' }).click()
    const linkedGoalDialog = page.getByRole('dialog')
    await linkedGoalDialog.getByLabel('Название', { exact: true }).fill('E2E авто покупка')
    await linkedGoalDialog.getByLabel('Описание').fill('Автоматически связанная покупка')
    await linkedGoalDialog.getByLabel('Сумма цели, ₽').fill('25000')
    await linkedGoalDialog.getByLabel('Приоритет', { exact: true }).selectOption('1')
    await linkedGoalDialog.getByRole('checkbox').check()
    await linkedGoalDialog.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('E2E авто покупка', { exact: true }).waitFor()
    assert.equal(state.goals.length, 2)
    assert.equal(state.planned_purchases.length, 1)
    assert.equal(state.planned_purchases[0].name, 'E2E авто покупка')
    assert.equal(state.planned_purchases[0].estimated_kopecks, 2500000)
    assert.equal(state.planned_purchases[0].priority, 1)
    assert.equal(state.planned_purchases[0].goal_id, state.goals[1].id)
    assert.equal(state.planned_purchases[0].comment, 'Автоматически связанная покупка')

    await page.goto(baseUrl + '/accounts', { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Счета' }).waitFor()
    await page.getByRole('button', { name: 'Добавить счёт' }).click()
    await page.getByLabel('Название', { exact: true }).fill('E2E накопительный')
    await page.getByRole('dialog').getByLabel('Тип').selectOption('savings')
    await page.getByLabel('Начальный остаток, ₽').fill('-25.50')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('E2E накопительный', { exact: true }).waitFor()
    assert.equal(state.accounts.length, 3)
    assert.equal(state.accounts[2].starting_balance_kopecks, -2550)
    assert.equal(state.accounts[2].kind, 'savings')
    const accountCard = page.locator('.card').filter({ hasText: 'E2E накопительный' }).first()
    await accountCard.getByRole('button', { name: 'Редактировать счёт' }).click()
    await page.getByLabel('Название', { exact: true }).fill('E2E накопительный изменён')
    await page.getByLabel('Начальный остаток, ₽').fill('-30.75')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('E2E накопительный изменён', { exact: true }).waitFor()
    assert.equal(state.accounts.length, 3, 'editing an account must not create a duplicate')
    assert.equal(state.accounts[2].name, 'E2E накопительный изменён')
    assert.equal(state.accounts[2].starting_balance_kopecks, -3075)
    const editedAccountCard = page.locator('.card').filter({ hasText: 'E2E накопительный изменён' }).first()
    await editedAccountCard.getByRole('button', { name: 'Архивировать счёт' }).click()
    await editedAccountCard.waitFor({ state: 'detached' })
    assert.equal(state.accounts[2].archived, true)
    await page.getByLabel('Показывать архивные счета').check()
    const archivedAccountCard = page.locator('.card').filter({ hasText: 'E2E накопительный изменён' }).first()
    await archivedAccountCard.getByRole('button', { name: 'Восстановить счёт' }).click()
    await page.getByText('E2E накопительный изменён', { exact: true }).waitFor()
    assert.equal(state.accounts[2].archived, false)

    await page.goto(baseUrl + '/categories', { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Категории' }).waitFor()
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    await page.getByLabel('Название', { exact: true }).fill('E2E транспорт')
    await page.getByRole('dialog').getByLabel('Тип').selectOption('expense')
    await page.getByLabel('Значок').fill('🚕')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('E2E транспорт', { exact: true }).waitFor()
    assert.equal(state.categories.length, 4)
    assert.equal(state.categories[3].name, 'E2E транспорт')
    assert.equal(state.categories[3].kind, 'expense')
    const categoryCard = page.locator('.card').filter({ hasText: 'E2E транспорт' }).first()
    await categoryCard.getByRole('button', { name: 'Изменить' }).click()
    await page.getByLabel('Название', { exact: true }).fill('E2E транспорт изменён')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('E2E транспорт изменён', { exact: true }).waitFor()
    assert.equal(state.categories.length, 4, 'editing a category must not create a duplicate')
    assert.equal(state.categories[3].name, 'E2E транспорт изменён')
    const editedCategoryCard = page.locator('.card').filter({ hasText: 'E2E транспорт изменён' }).first()
    await editedCategoryCard.getByRole('button', { name: 'Архивировать' }).click()
    await page.getByText('E2E транспорт изменён', { exact: true }).waitFor({ state: 'detached' })
    assert.equal(state.categories[3].archived, true)

    await page.goto(baseUrl + '/recurring', { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Регулярные платежи' }).waitFor()
    await page.getByRole('button', { name: 'Добавить' }).click()
    await page.getByLabel('Название').fill('E2E интернет')
    await page.getByLabel('Сумма, ₽').fill('12.34')
    await page.getByLabel('Частота').selectOption('custom')
    await page.getByLabel('Интервал, дней').fill('14')
    await page.getByLabel('Дата начала').fill('2026-11-18')
    await page.getByLabel('Дата окончания').fill('2026-11-17')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('Дата окончания не может быть раньше даты начала').waitFor()
    assert.equal(state.recurring_payments.length, 0, 'invalid recurring date range must not write data')
    await page.getByLabel('Дата окончания').fill('2026-12-18')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('E2E интернет', { exact: true }).waitFor()
    assert.equal(state.recurring_payments.length, 1)
    assert.equal(state.recurring_payments[0].amount_kopecks, 1234)
    assert.equal(state.recurring_payments[0].frequency, 'custom')
    assert.equal(state.recurring_payments[0].custom_interval_days, 14)
    assert.equal(state.recurring_payments[0].start_date, '2026-11-18')
    assert.equal(state.recurring_payments[0].end_date, '2026-12-18')
    const recurringCard = page.locator('.card').filter({ hasText: 'E2E интернет' }).first()
    await recurringCard.getByRole('button', { name: 'Пауза' }).click()
    await page.getByRole('button', { name: 'Возобновить' }).waitFor()
    assert.equal(state.recurring_payments[0].active, false)
    const pausedRecurringCard = page.locator('.card').filter({ hasText: 'E2E интернет' }).first()
    await pausedRecurringCard.getByRole('button', { name: 'Возобновить' }).click()
    await page.getByRole('button', { name: 'Пауза' }).waitFor()
    assert.equal(state.recurring_payments[0].active, true)
    const resumedRecurringCard = page.locator('.card').filter({ hasText: 'E2E интернет' }).first()
    await resumedRecurringCard.locator('button[title="Подтвердить оплату"]').click()
    const recurringConfirmDialog = page.getByRole('dialog')
    await recurringConfirmDialog.getByRole('button', { name: 'Подтвердить' }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(state.transactions.length, 2, 'confirming a recurring payment must create one operation')
    assert.equal(state.transactions[1].id, 'recurring_' + state.recurring_payments[0].id + '_2026-11-18')
    assert.equal(state.transactions[1].amount_kopecks, 1234)
    assert.equal(state.transactions[1].parent_recurring_id, state.recurring_payments[0].id)
    assert.equal(state.recurring_payments[0].next_due_date, '2026-12-02')
    await page.locator('.card').filter({ hasText: 'E2E интернет' }).first().locator('button[title="Удалить"]').click()
    await page.getByText('E2E интернет', { exact: true }).waitFor({ state: 'detached' })
    assert.equal(state.recurring_payments.length, 0, 'deleting a recurring payment must remove only the selected fixture row')
    assert.equal(state.transactions[1].parent_recurring_id, '', 'deleting a recurring payment must detach, not delete, its transaction')

    await page.goto(baseUrl + '/purchases', { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Планируемые покупки' }).waitFor()
    const autoPurchaseCard = page.locator('.card').filter({ hasText: 'E2E авто покупка' }).first()
    await autoPurchaseCard.locator('button[title="Удалить"]').click()
    await page.getByText('E2E авто покупка', { exact: true }).waitFor({ state: 'detached' })
    assert.equal(state.planned_purchases.length, 0, 'auto-created purchase can be managed from the purchases page')
    await page.getByRole('button', { name: 'Добавить' }).click()
    await page.getByLabel('Название').fill('E2E наушники')
    await page.getByLabel('Ориентировочная стоимость, ₽').fill('345.67')
    await page.getByLabel('Ссылка на товар').fill('ftp://example.com/item')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('Укажите корректную ссылку, начинающуюся с http:// или https://').waitFor()
    assert.equal(state.planned_purchases.length, 0, 'unsupported purchase URL must not write data')
    await page.getByLabel('Ссылка на товар').fill('https://example.com/item')
    await page.getByLabel('Приоритет').selectOption('2')
    await page.getByLabel('Желаемая дата').fill('2026-12-01')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('E2E наушники', { exact: true }).waitFor()
    assert.equal(state.planned_purchases.length, 1)
    assert.equal(state.planned_purchases[0].estimated_kopecks, 34567)
    assert.equal(state.planned_purchases[0].priority, 2)
    assert.equal(state.planned_purchases[0].url, 'https://example.com/item')
    assert.equal(state.planned_purchases[0].desired_date, '2026-12-01')
    const purchaseCard = page.locator('.card').filter({ hasText: 'E2E наушники' }).first()
    await purchaseCard.locator('button[title="Изменить"]').click()
    await page.getByLabel('Название').fill('E2E наушники изменены')
    await page.getByLabel('Ориентировочная стоимость, ₽').fill('400.00')
    await page.getByLabel('Комментарий').fill('Проверка редактирования')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('E2E наушники изменены', { exact: true }).waitFor()
    assert.equal(state.planned_purchases.length, 1, 'editing a purchase must not create a duplicate')
    assert.equal(state.planned_purchases[0].estimated_kopecks, 40000)
    assert.equal(state.planned_purchases[0].comment, 'Проверка редактирования')
    const editedPurchaseCard = page.locator('.card').filter({ hasText: 'E2E наушники изменены' }).first()
    await editedPurchaseCard.locator('button[title="Отметить купленным"]').click()
    const purchaseConfirmDialog = page.getByRole('dialog')
    await purchaseConfirmDialog.getByLabel('Списать со счёта').selectOption('account-cash')
    await purchaseConfirmDialog.getByRole('button', { name: 'Подтвердить покупку' }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await page.locator('.badge').filter({ hasText: 'Куплено' }).waitFor()
    assert.equal(state.planned_purchases[0].status, 'bought')
    assert.equal(state.planned_purchases[0].linked_transaction_id, 'purchase_' + state.planned_purchases[0].id)
    assert.equal(state.transactions.length, 3, 'confirming a planned purchase must create one expense')
    assert.equal(state.transactions[2].amount_kopecks, 40000)
    assert.equal(state.transactions[2].account_id, 'account-cash')
    assert.equal(state.transactions[2].type, 'expense')

    await page.getByRole('button', { name: 'Добавить' }).click()
    await page.getByLabel('Название').fill('E2E мышь')
    await page.getByLabel('Ориентировочная стоимость, ₽').fill('100.00')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('E2E мышь', { exact: true }).waitFor()
    assert.equal(state.planned_purchases.length, 2)
    const secondPurchaseCard = page.locator('.card').filter({ hasText: 'E2E мышь' }).first()
    await secondPurchaseCard.locator('button[title="Удалить"]').click()
    await page.getByText('E2E мышь', { exact: true }).waitFor({ state: 'detached' })
    assert.equal(state.planned_purchases.length, 1, 'deleting a planned purchase must remove only the selected fixture row')

    process.stdout.write(JSON.stringify({
      result: 'PASS',
      checks: [
        'transaction create persists rubles as integer kopecks',
        'transaction edit updates the existing row',
        'transfer stores distinct source/destination accounts and no category',
        'transaction delete removes the row',
        'budget create persists the monthly limit in kopecks',
        'monthly plan upsert updates the same family/month/category/type key without duplicates',
        'goal create and contribution validate positive kopecks, preserve history, and optionally create a linked planned purchase',
        'account create, edit, archive, and restore preserve negative opening balances in integer kopecks',
        'category create, edit, and archive persist changes without duplicate rows',
        'recurring payment validates dates, saves custom intervals, pauses, resumes, confirms one operation, and detaches on delete',
        'planned purchase validates URLs, saves, edits, confirms one expense, and deletes an unbought item',
      ],
      persisted: {
        transactions: state.transactions.length,
        budgets: state.budgets.length,
        monthly_plans: state.monthly_plans.length,
        goals: state.goals.length,
        accounts: state.accounts.length,
        categories: state.categories.length,
        recurring_payments: state.recurring_payments.length,
        planned_purchases: state.planned_purchases.length,
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
