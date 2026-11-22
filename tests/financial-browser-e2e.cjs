const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { chromium } = require('playwright')

const baseUrl = 'http://127.0.0.1:4174'
const apiUrl = 'https://test-gas.invalid/exec'
const familyId = 'family-e2e'
const alternateFamilyId = 'family-isolation-e2e'
let activeFamilyId = familyId
let assertActiveFamilyQuery = false
let injectForeignTransactionRow = false
const userId = 'user-e2e'
const partnerId = 'partner-e2e'

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
  profiles: [
    { id: userId, display_name: 'Тестовый пользователь' },
    { id: partnerId, display_name: 'Тестовый партнёр' },
  ],
  transactions: [],
  notifications: [],
  recurring_payments: [],
  planned_purchases: [],
  budgets: [],
  monthly_plans: [],
  goals: [],
  goal_contributions: [],
}
let sequence = 0
let transactionInsertRequests = 0
let transactionAbortAfterInsertOnce = false
let transactionDeleteDelayMs = 0
let transactionDeleteError = null
let purchaseConfirmDelayMs = 0
let purchaseConfirmError = null
let purchaseConfirmRequests = 0
let recurringConfirmDelayMs = 0
let recurringConfirmError = null
let recurringConfirmRequests = 0
let transactionReadDelayMs = 0
let transactionReadError = null
let notificationReadDelayMs = 0
let notificationReadError = null
let notificationWriteDelayMs = 0
let monthlyPlanReadDelayMs = 0
let monthlyPlanReadError = null
let accountReadDelayMs = 0
let accountReadError = null
let goalReadDelayMs = 0
let goalReadError = null
const budgetMonthsRead = []
let budgetResponseGate = null
let budgetReadDelayMs = 0
let budgetReadError = null
let purchaseReadDelayMs = 0
let purchaseReadError = null
let recurringReadDelayMs = 0
let recurringReadError = null
let categoryReadDelayMs = 0
let categoryReadError = null
let telegramStatusDelayMs = 0
let telegramStatusError = null
let transactionReadRequests = 0
let tableRevisions = { transactions: 1, accounts: 1, budgets: 1 }
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
  if (assertActiveFamilyQuery && payload.mode === 'select' && payload.table === 'transactions') {
    assert.ok(
      filters.some(filter => filter.column === 'family_id' && filter.op === 'eq' && filter.value === activeFamilyId),
      'transaction reads must be scoped to the currently active family',
    )
  }
  if (payload.mode === 'select' && payload.table === 'budgets') {
    budgetMonthsRead.push(filters.find(filter => filter.column === 'month_date')?.value)
  }
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
    if (injectForeignTransactionRow && payload.table === 'transactions') {
      result.push(...rows.filter(row => row.family_id !== activeFamilyId))
    }
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
        const existing = rows.find(row => row.id === value.id)
        if (existing) {
          // Simulate the idempotent TEST backend: a retry with the same ID and payload
          // returns the original transaction without inserting a second row.
          const matchesOriginal = payload.table === 'transactions'
            && Object.entries(value).every(([key, field]) => JSON.stringify(existing[key]) === JSON.stringify(field))
          if (!matchesOriginal) throw new Error('Duplicate id in E2E fixture')
          continue
        }
        if (payload.table === 'transactions') {
          const now = new Date().toISOString()
          rows.push({ operation_time: null, parent_recurring_id: null, updated_by: userId, created_at: now, updated_at: now, ...value })
        } else {
          rows.push({ ...value })
        }
      }
    }
    if (payload.table === 'goal_contributions') syncGoalTotals(values.map(row => row.goal_id))
    return payload.returning ? values : null
  }
  if (payload.mode === 'update') {
    const values = payload.values || {}
    const affectedGoalIds = selected.flatMap(row => [row.goal_id, values.goal_id])
    if (payload.table === 'transactions') {
      for (const row of selected) {
        const columns = Object.keys(row)
        if (!payload.expected || columns.some(column => !Object.hasOwn(payload.expected, column))) {
          throw new Error('Некорректный или неполный снимок записи для проверки изменений')
        }
        if (columns.some(column => payload.expected[column] !== row[column])) {
          throw new Error('Запись была изменена другим участником. Обновите данные и повторите изменение.')
        }
      }
    }
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
      family: { id: activeFamilyId, name: 'Тестовая семья' },
      members: [{ user_id: userId, role: 'owner' }, { user_id: partnerId, role: 'member' }],
      member_profiles: state.profiles,
    }
  }
  if (name === 'ensure_supplemental_categories') return { added: 0 }
  if (name === 'get_telegram_link_status') {
    if (telegramStatusError) throw new Error(telegramStatusError)
    return { linked: false }
  }
  if (name === 'get_table_revision') { revisionReadRequests++; return String(tableRevisions[params.p_table] ?? 1) }
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
    purchaseConfirmRequests++
    if (purchaseConfirmError) throw new Error(purchaseConfirmError)
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
    recurringConfirmRequests++
    if (recurringConfirmError) throw new Error(recurringConfirmError)
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

async function deliverLateResponse(page, matches, startRequest, whilePending) {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const hold = async route => {
    if (matches(route.request())) await gate
    await route.fallback()
  }
  await page.route(apiUrl, hold)
  try {
    const pending = page.waitForRequest(matches)
    await startRequest()
    const request = await pending
    await whilePending()
    const late = page.waitForResponse(response => response.request() === request)
    release()
    await (await late).finished()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  } finally {
    release()
    await page.unroute(apiUrl, hold)
  }
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
        const transactionDeletes = payload.action === 'batch'
          ? (payload.requests || []).some(request => request.action === 'query' && request.table === 'transactions' && request.mode === 'delete')
          : payload.action === 'query' && payload.table === 'transactions' && payload.mode === 'delete'
        if (transactionDeletes && transactionDeleteDelayMs > 0) await new Promise(resolve => setTimeout(resolve, transactionDeleteDelayMs))
        if (payload.action === 'rpc' && payload.name === 'confirm_planned_purchase' && purchaseConfirmDelayMs > 0) await new Promise(resolve => setTimeout(resolve, purchaseConfirmDelayMs))
        if (payload.action === 'rpc' && payload.name === 'confirm_recurring_payment' && recurringConfirmDelayMs > 0) await new Promise(resolve => setTimeout(resolve, recurringConfirmDelayMs))
        const result = payload.action === 'batch'
          ? (payload.requests || []).map(request => {
              try {
                if (request.action === 'query' && request.table === 'transactions' && request.mode === 'delete' && transactionDeleteError) throw new Error(transactionDeleteError)
                if (request.action === 'query' && request.table === 'transactions' && request.mode === 'select' && transactionReadError) throw new Error(transactionReadError)
                if (request.action === 'query' && request.table === 'notifications' && request.mode === 'select' && notificationReadError) throw new Error(notificationReadError)
                if (request.action === 'query' && request.table === 'monthly_plans' && request.mode === 'select' && monthlyPlanReadError) throw new Error(monthlyPlanReadError)
                if (request.action === 'query' && request.table === 'accounts' && request.mode === 'select' && accountReadError) throw new Error(accountReadError)
                if (request.action === 'query' && request.table === 'goals' && request.mode === 'select' && goalReadError) throw new Error(goalReadError)
                if (request.action === 'query' && request.table === 'budgets' && request.mode === 'select' && budgetReadError) throw new Error(budgetReadError)
                if (request.action === 'query' && request.table === 'planned_purchases' && request.mode === 'select' && purchaseReadError) throw new Error(purchaseReadError)
                if (request.action === 'query' && request.table === 'recurring_payments' && request.mode === 'select' && recurringReadError) throw new Error(recurringReadError)
                if (request.action === 'query' && request.table === 'categories' && request.mode === 'select' && categoryReadError) throw new Error(categoryReadError)
                return { data: request.action === 'rpc' ? rpc(request.name, request.params || {}) : query(request), error: null }
              } catch (error) { return { data: null, error: { message: String(error.message || error) } } }
            })
          : payload.action === 'rpc'
            ? rpc(payload.name, payload.params || {})
            : payload.action === 'query'
              ? (() => {
                  if (payload.table === 'transactions' && payload.mode === 'delete' && transactionDeleteError) throw new Error(transactionDeleteError)
                  if (payload.table === 'transactions' && payload.mode === 'select' && transactionReadError) throw new Error(transactionReadError)
                  if (payload.table === 'notifications' && payload.mode === 'select' && notificationReadError) throw new Error(notificationReadError)
                  if (payload.table === 'monthly_plans' && payload.mode === 'select' && monthlyPlanReadError) throw new Error(monthlyPlanReadError)
                  if (payload.table === 'accounts' && payload.mode === 'select' && accountReadError) throw new Error(accountReadError)
                  if (payload.table === 'goals' && payload.mode === 'select' && goalReadError) throw new Error(goalReadError)
                  if (payload.table === 'budgets' && payload.mode === 'select' && budgetReadError) throw new Error(budgetReadError)
                  if (payload.table === 'planned_purchases' && payload.mode === 'select' && purchaseReadError) throw new Error(purchaseReadError)
                  if (payload.table === 'recurring_payments' && payload.mode === 'select' && recurringReadError) throw new Error(recurringReadError)
                  if (payload.table === 'categories' && payload.mode === 'select' && categoryReadError) throw new Error(categoryReadError)
                  return query(payload)
                })()
              : null
        const requests = payload.action === 'batch' ? payload.requests : [payload]
        if (budgetResponseGate && requests.some(request => request.table === 'budgets' && request.mode === 'select'
          && request.filters.some(filter => filter.column === 'month_date' && filter.value === budgetResponseGate.month))) {
          await budgetResponseGate.release
        }
        const transactionReads = payload.action === 'batch'
          ? (payload.requests || []).some(request => request.action === 'query' && request.table === 'transactions' && request.mode === 'select')
          : payload.action === 'query' && payload.table === 'transactions' && payload.mode === 'select'
        if (transactionReads) transactionReadRequests++
        if (transactionReads && transactionReadDelayMs > 0) await new Promise(resolve => setTimeout(resolve, transactionReadDelayMs))
        const notificationReads = payload.action === 'batch'
          ? (payload.requests || []).some(request => request.action === 'query' && request.table === 'notifications' && request.mode === 'select')
          : payload.action === 'query' && payload.table === 'notifications' && payload.mode === 'select'
        if (notificationReads && notificationReadDelayMs > 0) await new Promise(resolve => setTimeout(resolve, notificationReadDelayMs))
        const notificationWrites = payload.action === 'batch'
          ? (payload.requests || []).some(request => request.action === 'query' && request.table === 'notifications' && ['update', 'delete'].includes(request.mode))
          : payload.action === 'query' && payload.table === 'notifications' && ['update', 'delete'].includes(payload.mode)
        if (notificationWrites && notificationWriteDelayMs > 0) await new Promise(resolve => setTimeout(resolve, notificationWriteDelayMs))
        const monthlyPlanReads = payload.action === 'batch'
          ? (payload.requests || []).some(request => request.action === 'query' && request.table === 'monthly_plans' && request.mode === 'select')
          : payload.action === 'query' && payload.table === 'monthly_plans' && payload.mode === 'select'
        if (monthlyPlanReads && monthlyPlanReadDelayMs > 0) await new Promise(resolve => setTimeout(resolve, monthlyPlanReadDelayMs))
        const accountReads = payload.action === 'batch'
          ? (payload.requests || []).some(request => request.action === 'query' && request.table === 'accounts' && request.mode === 'select')
          : payload.action === 'query' && payload.table === 'accounts' && payload.mode === 'select'
        if (accountReads && accountReadDelayMs > 0) await new Promise(resolve => setTimeout(resolve, accountReadDelayMs))
        const goalReads = payload.action === 'batch'
          ? (payload.requests || []).some(request => request.action === 'query' && request.table === 'goals' && request.mode === 'select')
          : payload.action === 'query' && payload.table === 'goals' && payload.mode === 'select'
        if (goalReads && goalReadDelayMs > 0) await new Promise(resolve => setTimeout(resolve, goalReadDelayMs))
        const categoryReads = payload.action === 'batch'
          ? (payload.requests || []).some(request => request.action === 'query' && request.table === 'categories' && request.mode === 'select')
          : payload.action === 'query' && payload.table === 'categories' && payload.mode === 'select'
        if (categoryReads && categoryReadDelayMs > 0) await new Promise(resolve => setTimeout(resolve, categoryReadDelayMs))
        const telegramStatusReads = payload.action === 'rpc' && payload.name === 'get_telegram_link_status'
        if (telegramStatusReads && telegramStatusDelayMs > 0) await new Promise(resolve => setTimeout(resolve, telegramStatusDelayMs))
        for (const [table, delay] of [
          ['budgets', budgetReadDelayMs],
          ['planned_purchases', purchaseReadDelayMs],
          ['recurring_payments', recurringReadDelayMs],
        ]) {
          const readsTable = payload.action === 'batch'
            ? (payload.requests || []).some(request => request.action === 'query' && request.table === table && request.mode === 'select')
            : payload.action === 'query' && payload.table === table && payload.mode === 'select'
          if (readsTable && delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
        }
        const transactionInserts = payload.action === 'batch'
          ? (payload.requests || []).filter(request => request.action === 'query' && request.table === 'transactions' && request.mode === 'insert').length
          : payload.action === 'query' && payload.table === 'transactions' && payload.mode === 'insert' ? 1 : 0
        if (transactionInserts) {
          transactionInsertRequests += transactionInserts
          await new Promise(resolve => setTimeout(resolve, 250))
          if (transactionAbortAfterInsertOnce) {
            // The mock server has already committed the row, but the client loses the response.
            transactionAbortAfterInsertOnce = false
            await route.abort('failed')
            return
          }
        }
        sequence++
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: result, error: null }) })
      } catch (error) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: null, error: { message: String(error.message || error) } }) })
      }
    })
    const page = await context.newPage()

    // Goals must not present a failed read as a legitimate empty list or stale progress.
    goalReadDelayMs = 400
    const goalsNavigation = page.goto(baseUrl + '/goals', { waitUntil: 'domcontentloaded' })
    await page.getByText('Загрузка…', { exact: true }).waitFor()
    assert.equal(await page.getByText('Целей пока нет. Создайте первую — например, отпуск или накопление на покупку.', { exact: true }).count(), 0, 'goals empty state must stay hidden during loading')
    assert.equal(await page.getByText('Общий прогресс по активным целям', { exact: true }).count(), 0, 'goals progress must stay hidden during loading')
    await goalsNavigation
    await page.getByRole('heading', { name: 'Финансовые цели' }).waitFor()
    await page.getByText('Целей пока нет. Создайте первую — например, отпуск или накопление на покупку.', { exact: true }).waitFor()
    goalReadDelayMs = 0
    goalReadError = 'Тестовая ошибка загрузки целей'
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' })
    await page.goto(baseUrl + '/goals', { waitUntil: 'domcontentloaded' })
    await page.getByText('Тестовая ошибка загрузки целей', { exact: true }).waitFor()
    assert.equal(await page.getByText('Целей пока нет. Создайте первую — например, отпуск или накопление на покупку.', { exact: true }).count(), 0, 'a failed goals read must not be presented as an empty list')
    assert.equal(await page.getByText('Общий прогресс по активным целям', { exact: true }).count(), 0, 'a failed goals read must not show stale progress')
    goalReadError = null
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' })
    await page.goto(baseUrl + '/goals', { waitUntil: 'domcontentloaded' })
    await page.getByText('Целей пока нет. Создайте первую — например, отпуск или накопление на покупку.', { exact: true }).waitFor()

    // Budgets: hide totals until successful load; errors must not look like an empty month.
    budgetReadDelayMs = 400
    const budgetsNavigation = page.goto(baseUrl + '/budgets', { waitUntil: 'domcontentloaded' })
    await page.getByText('Загрузка…', { exact: true }).waitFor()
    assert.equal(await page.locator('.card').filter({ hasText: 'Общий бюджет' }).count(), 0, 'budget summary must stay hidden during loading')
    await budgetsNavigation
    await page.getByText('Бюджетов пока нет. Установите лимиты по категориям на месяц.', { exact: true }).waitFor()
    budgetReadDelayMs = 0
    budgetReadError = 'Тестовая ошибка загрузки бюджетов'
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' })
    await page.goto(baseUrl + '/budgets', { waitUntil: 'domcontentloaded' })
    await page.getByText('Тестовая ошибка загрузки бюджетов', { exact: true }).waitFor()
    assert.equal(await page.locator('.card').filter({ hasText: 'Общий бюджет' }).count(), 0, 'failed budget read must not show a summary')
    assert.equal(await page.getByText('Бюджетов пока нет. Установите лимиты по категориям на месяц.', { exact: true }).count(), 0, 'failed budget read must not show an empty state')
    budgetReadError = null
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' })
    await page.goto(baseUrl + '/budgets', { waitUntil: 'domcontentloaded' })
    await page.getByText('Бюджетов пока нет. Установите лимиты по категориям на месяц.', { exact: true }).waitFor()

    // Planned purchases: hide estimated total and empty state until a successful read.
    purchaseReadDelayMs = 400
    const purchasesNavigation = page.goto(baseUrl + '/purchases', { waitUntil: 'domcontentloaded' })
    await page.getByText('Загрузка…', { exact: true }).waitFor()
    assert.equal(await page.locator('.card').filter({ hasText: 'Общая стоимость запланированных покупок' }).count(), 0, 'purchase total must stay hidden during loading')
    await purchasesNavigation
    await page.getByText('Покупок пока нет. Добавьте товары, которые планируете купить.', { exact: true }).waitFor()
    purchaseReadDelayMs = 0
    purchaseReadError = 'Тестовая ошибка загрузки покупок'
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' })
    await page.goto(baseUrl + '/purchases', { waitUntil: 'domcontentloaded' })
    await page.getByText('Тестовая ошибка загрузки покупок', { exact: true }).waitFor()
    assert.equal(await page.locator('.card').filter({ hasText: 'Общая стоимость запланированных покупок' }).count(), 0, 'failed purchase read must not show a total')
    assert.equal(await page.getByText('Покупок пока нет. Добавьте товары, которые планируете купить.', { exact: true }).count(), 0, 'failed purchase read must not show an empty state')
    purchaseReadError = null
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' })
    await page.goto(baseUrl + '/purchases', { waitUntil: 'domcontentloaded' })
    await page.getByText('Покупок пока нет. Добавьте товары, которые планируете купить.', { exact: true }).waitFor()

    // Recurring payments: do not show overdue summary or empty state before a successful read.
    recurringReadDelayMs = 400
    const recurringNavigation = page.goto(baseUrl + '/recurring', { waitUntil: 'domcontentloaded' })
    await page.getByText('Загрузка…', { exact: true }).waitFor()
    assert.equal(await page.locator('.card').filter({ hasText: /Просроченные платежи/ }).count(), 0, 'overdue summary must stay hidden during loading')
    await recurringNavigation
    await page.getByText(/Регулярных платежей пока нет/).waitFor()
    recurringReadDelayMs = 0
    recurringReadError = 'Тестовая ошибка загрузки регулярных платежей'
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' })
    await page.goto(baseUrl + '/recurring', { waitUntil: 'domcontentloaded' })
    await page.getByText('Тестовая ошибка загрузки регулярных платежей', { exact: true }).waitFor()
    assert.equal(await page.locator('.card').filter({ hasText: /Просроченные платежи/ }).count(), 0, 'failed recurring read must not show overdue summary')
    assert.equal(await page.getByText(/Регулярных платежей пока нет/).count(), 0, 'failed recurring read must not show an empty state')
    recurringReadError = null
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' })
    await page.goto(baseUrl + '/recurring', { waitUntil: 'domcontentloaded' })
    await page.getByText(/Регулярных платежей пока нет/).waitFor()

    // Accounts must not show a fabricated zero balance while data is loading or after a failed read.
    accountReadDelayMs = 400
    const accountsNavigation = page.goto(baseUrl + '/accounts', { waitUntil: 'domcontentloaded' })
    await page.getByText('Загрузка…', { exact: true }).waitFor()
    assert.equal(await page.getByText('Общий остаток активных счетов', { exact: true }).count(), 0, 'accounts total must stay hidden during loading')
    await accountsNavigation
    await page.getByRole('heading', { name: 'Счета' }).waitFor()
    await page.getByText('Наличные', { exact: true }).waitFor()
    await page.getByText('Общий остаток активных счетов', { exact: true }).waitFor()
    accountReadDelayMs = 0
    accountReadError = 'Тестовая ошибка загрузки счетов'
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' })
    await page.goto(baseUrl + '/accounts', { waitUntil: 'domcontentloaded' })
    await page.getByText('Тестовая ошибка загрузки счетов', { exact: true }).waitFor()
    assert.equal(await page.getByText('Общий остаток активных счетов', { exact: true }).count(), 0, 'accounts total must stay hidden after a failed read')
    assert.equal(await page.getByText('Наличные', { exact: true }).count(), 0, 'a failed accounts read must not present stale account rows')
    assert.equal(await page.getByText('Счетов пока нет.', { exact: false }).count(), 0, 'a failed read must not claim the family has no accounts')
    accountReadError = null
    await page.getByRole('button', { name: 'Повторить загрузку' }).click()
    await page.getByText('Наличные', { exact: true }).waitFor()
    await page.getByText('Общий остаток активных счетов', { exact: true }).waitFor()

    transactionReadDelayMs = 400
    const initialNavigation = page.goto(baseUrl + '/transactions', { waitUntil: 'domcontentloaded' })
    await page.getByText('Загрузка…', { exact: true }).waitFor()
    await initialNavigation
    await page.getByRole('heading', { name: 'Операции' }).waitFor()
    await page.getByText('Операций за этот месяц нет.', { exact: true }).waitFor()
    transactionReadDelayMs = 0

    // Dashboard must keep financial totals hidden until its reads succeed.
    transactionReadDelayMs = 400
    const dashboardNavigation = page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' })
    await page.getByText('Загружаем операции…', { exact: true }).waitFor()
    await dashboardNavigation
    await page.getByRole('heading', { name: 'Деньги дома. Спокойно, вместе.' }).waitFor()
    await page.getByText('Пока нет операций за этот месяц', { exact: true }).waitFor()
    transactionReadDelayMs = 0
    const dashboardRevisionBaseline = revisionReadRequests
    const dashboardRevisionDeadline = Date.now() + 3000
    while (revisionReadRequests === dashboardRevisionBaseline && Date.now() < dashboardRevisionDeadline) await new Promise(resolve => setTimeout(resolve, 20))
    assert.ok(revisionReadRequests > dashboardRevisionBaseline, 'dashboard realtime subscription must initialize before failure injection')
    transactionReadError = 'Тестовая ошибка главной страницы'
    tableRevisions.transactions++
    await page.getByText(/Тестовая ошибка главной страницы/).waitFor()
    assert.equal(await page.getByRole('region', { name: 'Итоги месяца' }).count(), 0, 'dashboard must not show zero totals when financial data failed to load')
    assert.equal(await page.getByText('Пока нет операций за этот месяц', { exact: true }).count(), 0, 'dashboard must not present a failed load as an empty month')
    transactionReadError = null
    tableRevisions.transactions++
    await page.getByText('Пока нет операций за этот месяц', { exact: true }).waitFor()

    // Calendar must not present failed transaction reads as an empty month/day.
    transactionReadDelayMs = 400
    const calendarNavigation = page.goto(baseUrl + '/calendar', { waitUntil: 'domcontentloaded' })
    await page.getByText('Загрузка…', { exact: true }).waitFor()
    await calendarNavigation
    await page.getByRole('heading', { name: 'Финансовый календарь' }).waitFor()
    const calendarMonth = page.locator('.font-medium.text-slate-700').first()
    const initialCalendarMonth = await calendarMonth.textContent()
    const nextCalendarMonth = page.getByRole('button', { name: 'Следующий месяц' })
    await nextCalendarMonth.focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(previous => {
      const node = document.querySelector('.font-medium.text-slate-700')
      return node && node.textContent !== previous
    }, initialCalendarMonth)
    await page.getByRole('button', { name: /^День \d+ / }).first().waitFor()
    await page.getByRole('button', { name: 'Список' }).click()
    await page.getByText('Нет операций за месяц.', { exact: true }).waitFor()
    transactionReadDelayMs = 0
    transactionReadError = 'Тестовая ошибка календаря'
    await page.getByRole('button').filter({ has: page.locator('svg.lucide-chevron-right') }).click()
    await page.getByText('Тестовая ошибка календаря', { exact: true }).waitFor()
    assert.equal(await page.getByText('Нет операций за месяц.', { exact: true }).count(), 0, 'calendar must not present a failed month read as empty')
    transactionReadError = null
    await page.getByRole('button').filter({ has: page.locator('svg.lucide-chevron-left') }).click()
    await page.getByText('Нет операций за месяц.', { exact: true }).waitFor()

    // Notifications must distinguish a slow successful empty response from a failed load.
    notificationReadDelayMs = 400
    const notificationsNavigation = page.goto(baseUrl + '/notifications', { waitUntil: 'domcontentloaded' })
    await page.getByText('Загрузка…', { exact: true }).waitFor()
    await notificationsNavigation
    await page.getByRole('heading', { name: 'Уведомления' }).waitFor()
    await page.getByText('Нет уведомлений.', { exact: true }).waitFor()
    notificationReadDelayMs = 0
    notificationReadError = 'Тестовая ошибка загрузки уведомлений'
    await page.getByRole('button', { name: 'Непрочитанные' }).click()
    await page.getByText('Тестовая ошибка загрузки уведомлений', { exact: true }).waitFor()
    assert.equal(await page.getByText('Нет уведомлений.', { exact: true }).count(), 0, 'a failed notifications load must not be presented as an empty list')
    notificationReadError = null
    await page.getByRole('button', { name: 'Все', exact: true }).click()
    await page.getByText('Нет уведомлений.', { exact: true }).waitFor()

    // Planning must not show zero totals or an empty-plan message before a successful read.
    monthlyPlanReadDelayMs = 400
    const planningNavigation = page.goto(baseUrl + '/planning', { waitUntil: 'domcontentloaded' })
    await page.getByText('Загрузка…', { exact: true }).waitFor()
    await planningNavigation
    await page.getByRole('heading', { name: 'Месячное планирование' }).waitFor()
    await page.getByText('Планов на этот месяц нет. Добавьте плановые доходы и расходы.', { exact: true }).waitFor()
    monthlyPlanReadDelayMs = 0
    monthlyPlanReadError = 'Тестовая ошибка загрузки планов'
    await page.getByRole('button').filter({ has: page.locator('svg.lucide-chevron-right') }).click()
    await page.getByText('Тестовая ошибка загрузки планов', { exact: true }).waitFor()
    assert.equal(await page.getByText('Планов на этот месяц нет. Добавьте плановые доходы и расходы.', { exact: true }).count(), 0, 'a failed plan read must not be presented as an empty month')
    monthlyPlanReadError = null
    await page.getByRole('button').filter({ has: page.locator('svg.lucide-chevron-left') }).click()
    await page.getByText('Планов на этот месяц нет. Добавьте плановые доходы и расходы.', { exact: true }).waitFor()

    await page.goto(baseUrl + '/transactions', { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Операции' }).waitFor()
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
    assert.ok(revisionReadRequests >= 2, 'realtime subscriptions must read both transaction and account table revisions')
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
    tableRevisions.transactions++
    const refreshDeadline = Date.now() + 7000
    while (transactionReadRequests <= transactionReadsBeforeRealtime && Date.now() < refreshDeadline) await new Promise(resolve => setTimeout(resolve, 20))
    assert.ok(transactionReadRequests > transactionReadsBeforeRealtime, `revision change must trigger a fresh transactions read (revision reads: ${revisionReadRequests}, transaction reads: ${transactionReadRequests})`)
    await page.getByText('Обновление после подписки', { exact: true }).waitFor({ timeout: 2000 })
    const realtimeTransactionCard = page.locator('.card').filter({ hasText: 'Обновление после подписки' }).first()
    const editRealtimeTransaction = realtimeTransactionCard.getByRole('button', { name: 'Изменить операцию: Обновление после подписки' })
    const deleteRealtimeTransaction = realtimeTransactionCard.getByRole('button', { name: 'Удалить операцию: Обновление после подписки' })
    await editRealtimeTransaction.waitFor()
    await deleteRealtimeTransaction.waitFor()
    await editRealtimeTransaction.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('dialog').waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(state.transactions[0].operation_date, nextMonthDate)
    const readsBeforeAccountChange = transactionReadRequests
    state.accounts[0].name = 'Наличные (обновлено)'
    tableRevisions.accounts++
    const accountRefreshDeadline = Date.now() + 7000
    while (transactionReadRequests <= readsBeforeAccountChange && Date.now() < accountRefreshDeadline) await new Promise(resolve => setTimeout(resolve, 20))
    assert.ok(transactionReadRequests > readsBeforeAccountChange, 'account revision change must trigger a fresh transaction page load')
    await page.waitForFunction(() => document.body.innerText.includes('Наличные (обновлено)'), null, { timeout: 2000 })
    const refreshedCard = await page.locator('.card').filter({ hasText: 'Обновление после подписки' }).innerText()
    assert.match(refreshedCard, /Наличные \(обновлено\)/)
    state.accounts[0].name = 'Наличные'
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

    // A background refresh in the same family must not close the form or discard unsaved edits.
    await transactionDialog.getByLabel('Сумма, ₽').fill('43.21')
    const readsBeforeModalRefresh = transactionReadRequests
    tableRevisions.transactions++
    const modalRefreshDeadline = Date.now() + 7000
    while (transactionReadRequests <= readsBeforeModalRefresh && Date.now() < modalRefreshDeadline) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.ok(transactionReadRequests > readsBeforeModalRefresh, 'background refresh must be observed during editing')
    await transactionDialog.getByLabel('Сумма, ₽').waitFor()
    assert.equal(await transactionDialog.getByLabel('Сумма, ₽').inputValue(), '43.21', 'background refresh must preserve the unsaved amount')
    await page.keyboard.press('Escape')
    await transactionDialog.waitFor({ state: 'detached' })
    assert.equal(await addTransactionButton.evaluate(element => element === document.activeElement), true, 'closing the dialog must restore focus to its trigger')

    await addTransactionButton.click()
    await page.getByLabel('Сумма, ₽').fill('123.45')
    await page.getByLabel('Счёт (для расчёта остатка)').selectOption('account-cash')
    await page.getByLabel('Категория').selectOption('category-food')
    await page.getByLabel('Ответственный участник').selectOption(partnerId)
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
    await expenseCard.getByText(/Автор: Тестовый пользователь · Ответственный: Тестовый партнёр/).waitFor()
    const authorFilter = page.getByLabel('Фильтр по автору записи')
    const responsibleFilter = page.getByLabel('Фильтр по ответственному участнику')
    const noMatches = page.getByText('По выбранным фильтрам операций нет.', { exact: true })
    await authorFilter.selectOption(userId)
    await responsibleFilter.selectOption(partnerId)
    await expenseCard.waitFor()
    await responsibleFilter.selectOption(userId)
    await noMatches.waitFor()
    await responsibleFilter.selectOption(partnerId)
    await authorFilter.selectOption(partnerId)
    await noMatches.waitFor()
    await page.getByRole('button', { name: 'Сбросить фильтры' }).click()
    await expenseCard.waitFor()

    // UX-01: changing the family context must never show or attribute another family's transactions.
    // This tests the client's family-scoped queries against an intercepted, fully synthetic API.
    const alternateTransaction = {
      id: 'transaction-isolated-family-e2e', family_id: alternateFamilyId,
      type: 'expense', amount_kopecks: 777, operation_date: state.transactions[0].operation_date,
      operation_time: null, category_id: null, account_id: null, to_account_id: null,
      description: 'E2E изолированная семья', created_by: userId, updated_by: userId,
      responsible_user_id: partnerId, planned: false, parent_recurring_id: null,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    }
    state.transactions.push(alternateTransaction)
    assertActiveFamilyQuery = true
    const alternateCard = page.locator('.card').filter({ hasText: alternateTransaction.description })
    await page.reload({ waitUntil: 'networkidle' })
    await expenseCard.waitFor()
    assert.equal(await alternateCard.count(), 0, 'the original family must not see transactions from a second family')
    injectForeignTransactionRow = true
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('alert').getByText('Ответ сервера содержит некорректные данные или записи другой семьи').waitFor()
    assert.equal(await expenseCard.count(), 0, 'a mixed-family response must not show previously loaded operations')
    assert.equal(await alternateCard.count(), 0, 'a mixed-family response must never show the foreign operation')
    assert.equal(await page.getByRole('button', { name: 'Добавить' }).isDisabled(), true, 'financial editing must be blocked after a mixed-family response')
    injectForeignTransactionRow = false
    await page.getByRole('button', { name: 'Повторить загрузку' }).click()
    await expenseCard.waitFor()
    activeFamilyId = alternateFamilyId
    await page.reload({ waitUntil: 'networkidle' })
    await alternateCard.waitFor()
    assert.equal(await expenseCard.count(), 0, 'the second family must not see the original family transaction')
    await page.getByLabel('Фильтр по автору записи').selectOption(userId)
    await page.getByLabel('Фильтр по ответственному участнику').selectOption(partnerId)
    await alternateCard.waitFor()
    await page.getByRole('button', { name: 'Следующий месяц' }).click()
    await page.getByText('По выбранным фильтрам операций нет.', { exact: true }).waitFor()
    assert.equal(await alternateCard.count(), 0, 'month navigation must not show a transaction from the previous month')
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
    await alternateCard.waitFor()
    assert.equal(await page.getByLabel('Фильтр по автору записи').inputValue(), userId, 'month navigation must retain the selected author')
    assert.equal(await page.getByLabel('Фильтр по ответственному участнику').inputValue(), partnerId, 'month navigation must retain the selected responsible participant')
    activeFamilyId = familyId
    await page.reload({ waitUntil: 'networkidle' })
    await expenseCard.waitFor()
    assert.equal(await alternateCard.count(), 0, 'switching back must not retain the second family data')
    state.transactions = state.transactions.filter(row => row.id !== alternateTransaction.id)
    assertActiveFamilyQuery = false

    transactionReadError = 'Не удалось загрузить следующий месяц'
    await page.getByRole('button', { name: 'Следующий месяц' }).click()
    await page.getByRole('alert').getByText(transactionReadError).waitFor()
    assert.equal(await expenseCard.count(), 0, 'failed period must hide transactions from the previous month')
    assert.equal(await page.getByText(/^Разница за период:/).count(), 0, 'failed period must hide totals from the previous month')
    transactionReadError = null
    await page.getByRole('button', { name: 'Повторить загрузку' }).click()
    await page.getByText('Операций за этот месяц нет.', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
    await expenseCard.waitFor()
    await expenseCard.getByRole('button', { name: 'Изменить' }).click()
    state.transactions[0].operation_time = '09:15'
    await page.getByLabel('Сумма, ₽').fill('15.67')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByRole('dialog').getByText(/Запись была изменена другим участником/).waitFor()
    assert.equal(state.transactions[0].amount_kopecks, 12345, 'stale edit must leave the amount intact')
    await page.getByRole('dialog').getByRole('button', { name: 'Отмена' }).click()
    await page.reload()
    await expenseCard.getByRole('button', { name: 'Изменить' }).click()
    await page.getByLabel('Сумма, ₽').fill('200.00')
    await page.getByRole('textbox', { name: 'Описание' }).fill('E2E расход изменён')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('E2E расход изменён', { exact: true }).waitFor()
    assert.equal(state.transactions[0].amount_kopecks, 20000)
    assert.equal(state.transactions.length, 1, 'editing must not create another transaction')
    assert.equal(state.transactions[0].operation_time, '09:15', 'uneditable server fields must survive the edit')

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
    const confirmTransferDelete = page.locator('button.btn-danger')
    transactionDeleteError = 'Тестовая ошибка удаления'
    await confirmTransferDelete.click()
    await page.getByRole('alert').getByText('Тестовая ошибка удаления').waitFor()
    assert.equal(state.transactions.length, 2, 'failed transaction delete must preserve the original row')
    transactionDeleteError = null
    transactionDeleteDelayMs = 350
    await confirmTransferDelete.click()
    await page.getByRole('button', { name: 'Удаление…' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Удаление…' }).isDisabled(), true, 'transaction delete confirmation must disable while request is pending')
    assert.equal(await page.getByRole('button', { name: 'Отмена' }).isDisabled(), true, 'transaction delete dialog must not close while delete is pending')
    await page.getByText('E2E перевод', { exact: true }).waitFor({ state: 'detached' })
    transactionDeleteDelayMs = 0
    assert.equal(state.transactions.length, 1)

    await page.goto(baseUrl + '/budgets', { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Бюджеты' }).waitFor()
    const addBudgetButton = page.getByRole('button', { name: 'Бюджет' })
    await addBudgetButton.focus()
    await page.keyboard.press('Enter')
    const budgetCreateDialog = page.getByRole('dialog')
    await budgetCreateDialog.waitFor()
    assert.equal(await budgetCreateDialog.evaluate(element => element.contains(document.activeElement)), true, 'opening the budget form with Enter must move focus inside the dialog')
    await page.keyboard.press('Escape')
    await budgetCreateDialog.waitFor({ state: 'detached' })
    assert.equal(await addBudgetButton.evaluate(element => element === document.activeElement), true, 'closing the budget form with Escape must restore focus to its trigger')
    await addBudgetButton.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('dialog').waitFor()
    await page.getByLabel('Категория').selectOption('category-food')
    await page.getByLabel('Лимит на месяц, ₽').fill('12000')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByText('Продукты', { exact: false }).first().waitFor()
    assert.equal(state.budgets.length, 1)
    assert.equal(state.budgets[0].limit_kopecks, 1200000)

    // Both revisions arrive in one poll after the user moves to another month.
    const sourceBudget = state.budgets[0]
    const followingMonth = new Date(sourceBudget.month_date + 'T00:00:00Z')
    followingMonth.setUTCMonth(followingMonth.getUTCMonth() + 1)
    const followingDate = followingMonth.toISOString().slice(0, 10)
    await page.getByRole('button', { name: 'Следующий месяц' }).click()
    await page.getByText('Бюджетов пока нет. Установите лимиты по категориям на месяц.', { exact: true }).waitFor()
    const readsBeforeBudgetRefresh = budgetMonthsRead.length
    state.budgets.push({ ...sourceBudget, id: 'next-month-budget', month_date: followingDate, category_id: 'category-home', limit_kopecks: 543200 })
    tableRevisions.budgets++
    tableRevisions.transactions++
    await page.getByRole('button', { name: 'Изменить бюджет: Дом' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Изменить бюджет: Продукты' }).count(), 0)
    assert.deepEqual(budgetMonthsRead.slice(readsBeforeBudgetRefresh), [followingDate], 'both changes require one budget read for the visible month')
    // Hold an older month's response while the user returns to the month containing «Дом».
    const laterMonth = new Date(followingMonth)
    laterMonth.setUTCMonth(laterMonth.getUTCMonth() + 1)
    let releaseResponse
    const release = new Promise(resolve => { releaseResponse = resolve })
    budgetResponseGate = { month: laterMonth.toISOString().slice(0, 10), release }
    try {
      const requestStarted = page.waitForRequest(req => {
        if (req.url() !== apiUrl) return false
        const payload = req.postDataJSON()
        const requests = payload.action === 'batch' ? payload.requests : [payload]
        return requests.some(request => request.table === 'budgets' && request.filters?.some(filter => filter.value === budgetResponseGate.month))
      })
      await page.getByRole('button', { name: 'Следующий месяц' }).click()
      const delayedRequest = await requestStarted
      await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
      const visibleBudget = page.getByRole('button', { name: 'Изменить бюджет: Дом' })
      await visibleBudget.waitFor()
      const lateResponse = page.waitForResponse(response => response.request() === delayedRequest)
      releaseResponse()
      await (await lateResponse).finished()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await visibleBudget.count(), 1, 'a delayed empty month must not replace the visible budget')
    } finally {
      releaseResponse()
      budgetResponseGate = null
    }
    state.budgets = state.budgets.filter(row => row.id !== 'next-month-budget')

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

    await page.getByRole('button', { name: 'Следующий месяц' }).click()
    await page.getByText('Планов на этот месяц нет.', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Из предыдущего' }).click()
    await page.getByText('E2E план обновлён', { exact: true }).waitFor()
    assert.equal(state.monthly_plans.length, 2, 'copy must retain the source plan and create the destination plan')
    assert.equal(new Set(state.monthly_plans.map(plan => plan.month_date)).size, 2)
    assert.ok(state.monthly_plans.every(plan => plan.planned_kopecks === 700000))


    await page.goto(baseUrl + '/goals', { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Финансовые цели' }).waitFor()
    const addGoalButton = page.getByRole('button', { name: 'Цель' })
    await addGoalButton.focus()
    await page.keyboard.press('Enter')
    const goalCreateDialog = page.getByRole('dialog')
    await goalCreateDialog.waitFor()
    assert.equal(await goalCreateDialog.evaluate(element => element.contains(document.activeElement)), true, 'opening the goal form with Enter must move focus inside the dialog')
    await page.keyboard.press('Escape')
    await goalCreateDialog.waitFor({ state: 'detached' })
    assert.equal(await addGoalButton.evaluate(element => element === document.activeElement), true, 'closing the goal form with Escape must restore focus to its trigger')
    await addGoalButton.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('dialog').waitFor()
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

    await page.getByRole('button', { name: 'Цель', exact: true }).click()
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
    const addAccountButton = page.getByRole('button', { name: 'Добавить счёт' })
    await addAccountButton.focus()
    await page.keyboard.press('Enter')
    const accountCreateDialog = page.getByRole('dialog')
    await accountCreateDialog.waitFor()
    assert.equal(await accountCreateDialog.evaluate(element => element.contains(document.activeElement)), true, 'opening the account form with Enter must move focus inside the dialog')
    await page.keyboard.press('Escape')
    await accountCreateDialog.waitFor({ state: 'detached' })
    assert.equal(await addAccountButton.evaluate(element => element === document.activeElement), true, 'closing the account form with Escape must restore focus to its trigger')
    await addAccountButton.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('dialog').waitFor()
    await accountCreateDialog.getByLabel('Название', { exact: true }).fill('   ')
    await accountCreateDialog.getByRole('button', { name: 'Сохранить' }).click()
    await accountCreateDialog.getByText('Введите название счёта', { exact: true }).waitFor()
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
    const addCategoryButton = page.getByRole('button', { name: 'Добавить', exact: true })
    await addCategoryButton.focus()
    await page.keyboard.press('Enter')
    const categoryCreateDialog = page.getByRole('dialog')
    await categoryCreateDialog.waitFor()
    assert.equal(await categoryCreateDialog.evaluate(element => element.contains(document.activeElement)), true, 'opening the category form with Enter must move focus inside the dialog')
    await page.keyboard.press('Escape')
    await categoryCreateDialog.waitFor({ state: 'detached' })
    assert.equal(await addCategoryButton.evaluate(element => element === document.activeElement), true, 'closing the category form with Escape must restore focus to its trigger')
    await addCategoryButton.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('dialog').waitFor()
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
    const addRecurringButton = page.getByRole('button', { name: 'Добавить' })
    await addRecurringButton.focus()
    await page.keyboard.press('Enter')
    const recurringCreateDialog = page.getByRole('dialog')
    await recurringCreateDialog.waitFor()
    assert.equal(await recurringCreateDialog.evaluate(element => element.contains(document.activeElement)), true, 'opening the recurring payment form with Enter must move focus inside the dialog')
    await page.keyboard.press('Escape')
    await recurringCreateDialog.waitFor({ state: 'detached' })
    assert.equal(await addRecurringButton.evaluate(element => element === document.activeElement), true, 'closing the recurring payment form with Escape must restore focus to its trigger')
    await addRecurringButton.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('dialog').waitFor()
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
    await recurringCard.getByRole('button', { name: /Приостановить платёж:/ }).click()
    await page.getByRole('button', { name: /Возобновить платёж:/ }).waitFor()
    assert.equal(state.recurring_payments[0].active, false)
    const pausedRecurringCard = page.locator('.card').filter({ hasText: 'E2E интернет' }).first()
    await pausedRecurringCard.getByRole('button', { name: /Возобновить платёж:/ }).click()
    await page.getByRole('button', { name: /Приостановить платёж:/ }).waitFor()
    assert.equal(state.recurring_payments[0].active, true)
    const resumedRecurringCard = page.locator('.card').filter({ hasText: 'E2E интернет' }).first()
    await resumedRecurringCard.locator('button[title="Подтвердить оплату"]').click()
    const recurringConfirmDialog = page.getByRole('dialog')
    recurringConfirmError = 'Тестовая ошибка подтверждения регулярного платежа'
    await recurringConfirmDialog.getByRole('button', { name: 'Подтвердить' }).click()
    await recurringConfirmDialog.getByRole('alert').getByText(recurringConfirmError).waitFor()
    assert.equal(await page.getByRole('dialog').count(), 1, 'a failed recurring confirmation must keep its dialog open')
    assert.equal(state.transactions.length, 1, 'a failed recurring confirmation must not create a transaction')
    recurringConfirmError = null
    recurringConfirmDelayMs = 400
    const recurringRequestsBefore = recurringConfirmRequests
    const recurringConfirmButton = recurringConfirmDialog.getByRole('button', { name: 'Подтвердить' })
    await recurringConfirmButton.evaluate(button => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await recurringConfirmDialog.getByRole('button', { name: 'Подтверждение…' }).waitFor()
    assert.equal(await recurringConfirmDialog.getByRole('button', { name: 'Отмена' }).isDisabled(), true, 'recurring confirmation cancel must be disabled while pending')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(recurringConfirmRequests - recurringRequestsBefore, 1, 'rapid recurring confirmation clicks must send one RPC')
    recurringConfirmDelayMs = 0
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
    const addPurchaseButton = page.getByRole('button', { name: 'Добавить' })
    await addPurchaseButton.focus()
    await page.keyboard.press('Enter')
    const purchaseCreateDialog = page.getByRole('dialog')
    await purchaseCreateDialog.waitFor()
    assert.equal(await purchaseCreateDialog.evaluate(element => element.contains(document.activeElement)), true, 'opening the purchase form with Enter must move focus inside the dialog')
    await page.keyboard.press('Escape')
    await purchaseCreateDialog.waitFor({ state: 'detached' })
    assert.equal(await addPurchaseButton.evaluate(element => element === document.activeElement), true, 'closing the purchase form with Escape must restore focus to its trigger')
    await addPurchaseButton.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('dialog').waitFor()
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
    purchaseConfirmError = 'Тестовая ошибка подтверждения покупки'
    await purchaseConfirmDialog.getByRole('button', { name: 'Подтвердить покупку' }).click()
    await purchaseConfirmDialog.getByRole('alert').getByText(purchaseConfirmError).waitFor()
    assert.equal(await page.getByRole('dialog').count(), 1, 'a failed purchase confirmation must keep its dialog open')
    assert.equal(state.transactions.length, 2, 'a failed purchase confirmation must not create a transaction')
    purchaseConfirmError = null
    purchaseConfirmDelayMs = 400
    const purchaseRequestsBefore = purchaseConfirmRequests
    const purchaseConfirmButton = purchaseConfirmDialog.getByRole('button', { name: 'Подтвердить покупку' })
    await purchaseConfirmButton.evaluate(button => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await purchaseConfirmDialog.getByRole('button', { name: 'Подтверждение…' }).waitFor()
    assert.equal(await purchaseConfirmDialog.getByRole('button', { name: 'Отмена' }).isDisabled(), true, 'purchase confirmation cancel must be disabled while pending')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(purchaseConfirmRequests - purchaseRequestsBefore, 1, 'rapid purchase confirmation clicks must send one RPC')
    purchaseConfirmDelayMs = 0
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

    // Categories: slow reads show a loading state; failed reads must not look like an empty list.
    const savedCategories = state.categories
    state.categories = []
    categoryReadDelayMs = 400
    const categoriesNavigation = page.goto(baseUrl + '/categories', { waitUntil: 'domcontentloaded' })
    await page.getByText('Загрузка…', { exact: true }).waitFor()
    assert.equal(await page.getByText('По заданным фильтрам категорий нет.', { exact: true }).count(), 0, 'categories empty state must stay hidden during loading')
    await categoriesNavigation
    await page.getByText('По заданным фильтрам категорий нет.', { exact: true }).waitFor()
    categoryReadDelayMs = 0
    categoryReadError = 'Тестовая ошибка загрузки категорий'
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' })
    await page.goto(baseUrl + '/categories', { waitUntil: 'domcontentloaded' })
    await page.getByText('Тестовая ошибка загрузки категорий', { exact: true }).waitFor()
    assert.equal(await page.getByText('По заданным фильтрам категорий нет.', { exact: true }).count(), 0, 'failed category read must not be presented as an empty list')
    categoryReadError = null
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' })
    await page.goto(baseUrl + '/categories', { waitUntil: 'domcontentloaded' })
    await page.getByText('По заданным фильтрам категорий нет.', { exact: true }).waitFor()
    state.categories = savedCategories

    // Reports and participant analysis: suppress zero totals and empty states until reads succeed.
    const savedTransactions = state.transactions
    state.transactions = []
    transactionReadDelayMs = 400
    const reportsNavigation = page.goto(baseUrl + '/reports', { waitUntil: 'domcontentloaded' })
    await page.getByText('Загрузка…', { exact: true }).waitFor()
    assert.equal(await page.getByText('Доходы', { exact: true }).count(), 0, 'report totals must stay hidden during loading')
    assert.equal(await page.getByText('Нет данных за период.', { exact: true }).count(), 0, 'report empty states must stay hidden during loading')
    await reportsNavigation
    await page.getByText('Нет данных за период.', { exact: true }).first().waitFor()
    transactionReadDelayMs = 0
    transactionReadError = 'Тестовая ошибка отчётов'
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' })
    await page.goto(baseUrl + '/reports', { waitUntil: 'domcontentloaded' })
    await page.getByText('Тестовая ошибка отчётов', { exact: true }).waitFor()
    assert.equal(await page.getByText('Доходы', { exact: true }).count(), 0, 'failed report read must not show stale totals')
    assert.equal(await page.getByText('Нет данных за период.', { exact: true }).count(), 0, 'failed report read must not look like an empty period')
    transactionReadError = null
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' })
    await page.goto(baseUrl + '/reports', { waitUntil: 'domcontentloaded' })
    await page.getByText('Нет данных за период.', { exact: true }).first().waitFor()

    // An export must follow the selected period even if the previous response arrives late.
    const reportMonth = sourceBudget.month_date
    const previousMonthStart = new Date(reportMonth + 'T00:00:00Z')
    previousMonthStart.setUTCMonth(previousMonthStart.getUTCMonth() - 1)
    const previousReportDate = previousMonthStart.toISOString().slice(0, 10)
    state.transactions = [
      { ...savedTransactions[0], id: 'report-current', family_id: familyId, operation_date: reportMonth, planned: false, description: 'CSV текущего месяца' },
      { ...savedTransactions[0], id: 'report-previous', family_id: familyId, operation_date: previousReportDate, planned: false, description: 'CSV предыдущего месяца' },
    ]
    await page.reload()
    const exportButton = page.getByRole('button', { name: 'Экспорт CSV' })
    const reportPeriod = page.getByLabel('Период отчёта')
    await page.getByText('Доходы', { exact: true }).waitFor()
    assert.equal(await exportButton.isEnabled(), true)
    const isPreviousReport = request => {
      if (request.url() !== apiUrl || request.method() !== 'POST') return false
      const payload = request.postDataJSON()
      const items = payload.action === 'batch' ? payload.requests : [payload]
      return items.some(item => item.table === 'transactions' && item.filters?.some(filter =>
        filter.column === 'operation_date' && filter.op === 'gte' && filter.value === previousReportDate))
    }
    try {
      await deliverLateResponse(page, isPreviousReport, () => reportPeriod.selectOption('prev'), async () => {
        assert.equal(await exportButton.isDisabled(), true, 'old rows must not be exported under the new dates')
        await reportPeriod.selectOption('current')
        await page.getByText('Доходы', { exact: true }).waitFor()
      })
      const downloaded = page.waitForEvent('download')
      await exportButton.click()
      const download = await downloaded
      const calendarEnd = new Date(reportMonth + 'T00:00:00Z')
      calendarEnd.setUTCMonth(calendarEnd.getUTCMonth() + 1, 0)
      assert.equal(download.suggestedFilename(), 'report_' + reportMonth + '_' + calendarEnd.toISOString().slice(0, 10) + '.csv')
      const csv = await require('node:fs/promises').readFile(await download.path(), 'utf8')
      assert.equal(csv.trim().split(/\r?\n/).length, 2)
      assert.ok(csv.includes('CSV текущего месяца'))
      assert.ok(!csv.includes('CSV предыдущего месяца'))
      transactionReadError = 'Период отчёта недоступен'
      await reportPeriod.selectOption('6m')
      await page.getByText(transactionReadError, { exact: true }).waitFor()
      assert.equal(await exportButton.isDisabled(), true, 'a failed period must not export a previous successful report')
    } finally {
      transactionReadError = null
      state.transactions = []
    }

    // A server returning another family's row must not populate either the report or its CSV.
    // This is a synthetic, intercepted API; it cannot access any real Google Sheet.
    const reportOwnRow = {
      ...savedTransactions[0], id: 'report-family-safe-e2e',
      family_id: familyId, operation_date: reportMonth, planned: false,
      description: 'CSV разрешённой семьи',
    }
    const reportForeignRow = {
      ...reportOwnRow, id: 'report-other-family-e2e',
      family_id: alternateFamilyId, description: 'CSV чужой семьи',
    }
    state.transactions = [reportOwnRow, reportForeignRow]
    injectForeignTransactionRow = true
    await page.goto(baseUrl + '/reports', { waitUntil: 'domcontentloaded' })
    await page.getByText('Ответ сервера содержит записи другой семьи', { exact: true }).waitFor()
    assert.equal(await page.getByText('Доходы', { exact: true }).count(), 0, 'mixed-family report must not show totals')
    assert.equal(await page.getByRole('button', { name: 'Экспорт CSV' }).isDisabled(), true, 'mixed-family report must not allow CSV export')
    injectForeignTransactionRow = false
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByText('Доходы', { exact: true }).waitFor()
    const safeExport = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Экспорт CSV' }).click()
    const safeCsvFile = await safeExport
    const safeCsvContent = await require('node:fs/promises').readFile(await safeCsvFile.path(), 'utf8')
    assert.ok(safeCsvContent.includes('CSV разрешённой семьи'), 'recovered report must contain the own-family row')
    assert.ok(!safeCsvContent.includes('CSV чужой семьи'), 'recovered report must not export a foreign-family row')

    injectForeignTransactionRow = true
    await page.goto(baseUrl + '/analysis', { waitUntil: 'domcontentloaded' })
    await page.getByText('Ответ сервера содержит записи другой семьи', { exact: true }).waitFor()
    assert.equal(await page.getByText('Общие доходы', { exact: true }).count(), 0, 'mixed-family analysis must not show totals')
    injectForeignTransactionRow = false
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByText('Общие доходы', { exact: true }).waitFor()
    state.transactions = []

    transactionReadDelayMs = 400
    const analysisNavigation = page.goto(baseUrl + '/analysis', { waitUntil: 'domcontentloaded' })
    await page.getByText('Загрузка…', { exact: true }).waitFor()
    assert.equal(await page.getByText('Общие доходы', { exact: true }).count(), 0, 'participant totals must stay hidden during loading')
    assert.equal(await page.getByText('Операций за выбранный месяц нет.', { exact: true }).count(), 0, 'participant empty state must stay hidden during loading')
    await analysisNavigation
    await page.getByText('Операций за выбранный месяц нет.', { exact: true }).waitFor()
    transactionReadDelayMs = 0
    transactionReadError = 'Тестовая ошибка анализа по участникам'
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' })
    await page.goto(baseUrl + '/analysis', { waitUntil: 'domcontentloaded' })
    await page.getByText('Тестовая ошибка анализа по участникам', { exact: true }).waitFor()
    assert.equal(await page.getByText('Общие доходы', { exact: true }).count(), 0, 'failed participant analysis must not show stale totals')
    assert.equal(await page.getByText('Операций за выбранный месяц нет.', { exact: true }).count(), 0, 'failed participant analysis must not look like an empty month')
    transactionReadError = null
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' })
    await page.goto(baseUrl + '/analysis', { waitUntil: 'domcontentloaded' })
    await page.getByText('Операций за выбранный месяц нет.', { exact: true }).waitFor()
    const analysisMonth = page.locator('.font-medium.text-slate-700').first()
    const previousAnalysisMonth = await analysisMonth.textContent()
    const nextAnalysisMonth = page.getByRole('button', { name: 'Следующий месяц' })
    await nextAnalysisMonth.focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(previous => {
      const node = document.querySelector('.font-medium.text-slate-700')
      return node && node.textContent !== previous
    }, previousAnalysisMonth)

    // Current month: the responsible participant overrides the author. Older rows retain author attribution.
    const analysisRow = { ...savedTransactions[0], family_id: familyId, operation_date: reportMonth, planned: false, created_by: userId, responsible_user_id: null }
    state.transactions = [
      { ...analysisRow, id: 'analysis-income', type: 'income', amount_kopecks: 20011 },
      { ...analysisRow, id: 'analysis-legacy', type: 'expense', amount_kopecks: 456, category_id: 'category-home' },
      { ...analysisRow, id: 'analysis-partner-a', responsible_user_id: partnerId, type: 'expense', amount_kopecks: 1234, category_id: 'category-food' },
      { ...analysisRow, id: 'analysis-partner-b', responsible_user_id: partnerId, type: 'expense', amount_kopecks: 766, category_id: 'category-food' },
      { ...analysisRow, id: 'analysis-transfer', type: 'transfer', amount_kopecks: 61111 },
      { ...analysisRow, id: 'analysis-planned', type: 'expense', amount_kopecks: 81234, planned: true },
      { ...analysisRow, id: 'analysis-previous', operation_date: previousReportDate, type: 'income', amount_kopecks: 99999 },
    ]
    await page.reload()
    const ownerCard = page.locator('.card').filter({ has: page.getByText('Тестовый пользователь', { exact: true }) })
    const partnerCard = page.locator('.card').filter({ has: page.getByText('Тестовый партнёр', { exact: true }) })
    await ownerCard.waitFor()
    await deliverLateResponse(page, isPreviousReport,
      () => page.getByRole('button', { name: 'Предыдущий месяц' }).click(),
      async () => {
        await page.getByText('Загрузка…', { exact: true }).waitFor()
        assert.equal(await ownerCard.count(), 0)
        await nextAnalysisMonth.click()
        await ownerCard.waitFor()
      })
    const ownerText = (await ownerCard.innerText()).replace(/\s+/g, ' ')
    const partnerText = (await partnerCard.innerText()).replace(/\s+/g, ' ')
    assert.ok(ownerText.includes('Зарплата / доходы 200,11 ₽') && ownerText.includes('Баланс 195,55 ₽'), ownerText)
    assert.ok(partnerText.includes('Расходы 20 ₽') && partnerText.includes('Продукты 20 ₽'), partnerText)
    const totalExpensesCard = page.locator('.card').filter({ has: page.getByText('Общие расходы', { exact: true }) })
    assert.ok((await totalExpensesCard.innerText()).replace(/\s+/g, ' ').includes('24,56 ₽'))
    state.transactions = savedTransactions

    // Notification icon actions must have useful accessible names and work from the keyboard.
    state.notifications = [
      { id: 'notification-keyboard', family_id: familyId, kind: 'system', title: 'Проверка клавиатуры', body: 'Тестовое уведомление', read: false, created_at: '2026-10-31T21:00:00.000Z' },
    ]
    await page.goto(baseUrl + '/notifications', { waitUntil: 'domcontentloaded' })
    const notificationCard = page.locator('.card').filter({ hasText: 'Проверка клавиатуры' }).first()
    await notificationCard.getByText(/^1 нояб\.? 2026$/).waitFor()
    const markNotificationRead = notificationCard.getByRole('button', { name: 'Отметить уведомление «Проверка клавиатуры» прочитанным' })
    const deleteNotification = notificationCard.getByRole('button', { name: 'Удалить уведомление «Проверка клавиатуры»' })
    await markNotificationRead.waitFor()
    await deleteNotification.waitFor()
    notificationWriteDelayMs = 350
    await markNotificationRead.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Отметить уведомление «Проверка клавиатуры» прочитанным' }).waitFor({ state: 'attached' })
    assert.equal(await page.getByRole('button', { name: 'Отметить уведомление «Проверка клавиатуры» прочитанным' }).isDisabled(), true, 'notification action must disable while its update is pending')
    assert.equal(await page.getByRole('button', { name: 'Удалить уведомление «Проверка клавиатуры»' }).isDisabled(), true, 'other action for the same notification must disable while an update is pending')
    await page.getByRole('button', { name: 'Отметить уведомление «Проверка клавиатуры» прочитанным' }).waitFor({ state: 'detached' })
    notificationWriteDelayMs = 0
    await page.getByRole('button', { name: 'Удалить уведомление «Проверка клавиатуры»' }).waitFor()
    assert.equal(state.notifications[0].read, true, 'keyboard activation must mark the selected notification as read')
    const refreshedNotificationCard = page.locator('.card').filter({ hasText: 'Проверка клавиатуры' }).first()
    const focusedDeleteNotification = refreshedNotificationCard.getByRole('button', { name: 'Удалить уведомление «Проверка клавиатуры»' })
    await focusedDeleteNotification.focus()
    await page.keyboard.press('Enter')
    await page.getByText('Проверка клавиатуры', { exact: true }).waitFor({ state: 'detached' })
    assert.equal(state.notifications.length, 0, 'keyboard activation must delete only the selected notification')
    state.notifications = []

    // Telegram: a delayed or failed status lookup must not be mistaken for an unlinked account.
    telegramStatusDelayMs = 400
    const telegramNavigation = page.goto(baseUrl + '/telegram', { waitUntil: 'domcontentloaded' })
    await page.getByText('Проверяем статус подключения…', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Создать код привязки' }).count(), 0, 'Telegram link flow must stay hidden while status is loading')
    await telegramNavigation
    await page.getByRole('button', { name: 'Создать код привязки' }).waitFor()
    telegramStatusDelayMs = 0
    telegramStatusError = 'Тестовая ошибка статуса Telegram'
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' })
    await page.goto(baseUrl + '/telegram', { waitUntil: 'domcontentloaded' })
    await page.getByText('Тестовая ошибка статуса Telegram', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Создать код привязки' }).count(), 0, 'failed Telegram status lookup must not be presented as unlinked')
    await page.getByRole('button', { name: 'Повторить проверку' }).waitFor()
    telegramStatusError = null
    await page.getByRole('button', { name: 'Повторить проверку' }).click()
    await page.getByRole('button', { name: 'Создать код привязки' }).waitFor()

    // Non-submit page actions must declare their button type explicitly.
    for (const route of ['/reports', '/transactions', '/calendar', '/analysis', '/notifications', '/budgets', '/goals', '/purchases', '/recurring']) {
      await page.goto(baseUrl + route, { waitUntil: 'domcontentloaded' })
      await page.locator('h1').first().waitFor()
      const implicitButtons = await page.locator('button:not([type])').count()
      assert.equal(implicitButtons, 0, route + ' must not contain buttons with an implicit submit type')
      if (['/budgets', '/goals', '/purchases', '/recurring'].includes(route)) {
        const unnamedIconButtons = await page.locator('button:has(svg)').evaluateAll(buttons => buttons.filter(button => !button.textContent.trim() && !button.getAttribute('aria-label')).length)
        assert.equal(unnamedIconButtons, 0, route + ' must give every icon-only button an explicit accessible name')
      }
    }

    await page.goto(baseUrl + '/transactions', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Добавить' }).click()
    const transactionDialogForButtonTypes = page.getByRole('dialog')
    await transactionDialogForButtonTypes.waitFor()
    assert.equal(await transactionDialogForButtonTypes.locator('button:not([type])').count(), 0, 'transaction dialog controls must declare explicit button types')
    await page.keyboard.press('Escape')
    await transactionDialogForButtonTypes.waitFor({ state: 'detached' })

    // A lost response after a committed insert must not permit a different payload to get a new ID.
    // This scenario contacts only the synthetic intercepted API; no GAS or Sheets write occurs.
    const committedRowsBeforeUncertainSave = state.transactions.length
    const insertsBeforeUncertainSave = transactionInsertRequests
    transactionAbortAfterInsertOnce = true
    await page.getByRole('button', { name: 'Добавить' }).click()
    const uncertainDialog = page.getByRole('dialog', { name: 'Новая операция' })
    await uncertainDialog.getByLabel('Сумма, ₽').fill('8.76')
    await uncertainDialog.getByRole('textbox', { name: 'Описание' }).fill('E2E неопределённая запись')
    await uncertainDialog.getByRole('button', { name: 'Сохранить' }).click()
    await uncertainDialog.getByText(/Не удалось связаться с сервером|Сервер не ответил вовремя/).waitFor()
    assert.equal(transactionInsertRequests, insertsBeforeUncertainSave + 1)
    assert.equal(state.transactions.length, committedRowsBeforeUncertainSave + 1, 'mock server committed the first insert despite a lost response')
    const originalUncertainId = state.transactions.at(-1).id
    await uncertainDialog.getByLabel('Сумма, ₽').fill('8.77')
    await uncertainDialog.getByRole('button', { name: 'Сохранить' }).click()
    await uncertainDialog.getByText(/Предыдущий запрос ещё не подтверждён/).waitFor()
    assert.equal(transactionInsertRequests, insertsBeforeUncertainSave + 1, 'changed payload must not trigger a second insert')
    assert.equal(state.transactions.length, committedRowsBeforeUncertainSave + 1, 'changed payload must not create a second transaction')
    assert.equal(state.transactions.at(-1).id, originalUncertainId, 'uncertain transaction ID must remain unchanged')
    await uncertainDialog.getByRole('button', { name: 'Отмена' }).click()

    // Reload must not silently discard the pending ID for a potentially committed expense.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Добавить' }).click()
    const reloadDialog = page.getByRole('dialog', { name: 'Новая операция' })
    await reloadDialog.getByLabel('Сумма, ₽').fill('8.77')
    await reloadDialog.getByRole('textbox', { name: 'Описание' }).fill('E2E неопределённая запись')
    await reloadDialog.getByRole('button', { name: 'Сохранить' }).click()
    await reloadDialog.getByText(/Предыдущий запрос ещё не подтверждён/).waitFor()
    assert.equal(transactionInsertRequests, insertsBeforeUncertainSave + 1, 'changed payload after reload must not be sent')
    assert.equal(state.transactions.length, committedRowsBeforeUncertainSave + 1, 'reloading must not permit a duplicate')

    // Repeating the original payload must reuse the same ID; the backend responds idempotently.
    await reloadDialog.getByLabel('Сумма, ₽').fill('8.76')
    await reloadDialog.getByRole('button', { name: 'Сохранить' }).click()
    await reloadDialog.waitFor({ state: 'detached' })
    assert.equal(transactionInsertRequests, insertsBeforeUncertainSave + 2, 'matching retry must be sent exactly once')
    assert.equal(state.transactions.length, committedRowsBeforeUncertainSave + 1, 'matching retry must not create a second row')
    assert.equal(state.transactions.at(-1).id, originalUncertainId, 'reloaded retry must preserve original ID')
    const pendingCleared = await page.evaluate(({ familyId, userId }) => {
      const key = `budget:pending-transaction:v1:${encodeURIComponent(familyId)}:${encodeURIComponent(userId)}`
      return localStorage.getItem(key) === null
    }, { familyId, userId })
    assert.equal(pendingCleared, true, 'confirmed idempotent retry must clear the pending ID')

    // An isolated browser may deny all localStorage access. The pending ID must survive
    // form remounts in memory, blocking changed payloads after an uncertain insert.
    const deniedStoragePageErrors = []
    page.on('pageerror', error => deniedStoragePageErrors.push(error.message))
    const storageDenied = await page.evaluate(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { throw new DOMException('Storage denied', 'SecurityError') },
      })
      try { window.localStorage.getItem('budget_google_session_v1'); return false } catch { return true }
    })
    assert.equal(storageDenied, true, 'browser storage must actually be denied for this scenario')
    const blockedStorageStartRows = state.transactions.length
    const blockedStorageStartInserts = transactionInsertRequests
    transactionAbortAfterInsertOnce = true
    await page.getByRole('button', { name: 'Добавить' }).click()
    const blockedStorageDialog = page.getByRole('dialog', { name: 'Новая операция' })
    await blockedStorageDialog.getByLabel('Сумма, ₽').fill('9.43')
    await blockedStorageDialog.getByRole('textbox', { name: 'Описание' }).fill('E2E закрытое хранилище')
    await blockedStorageDialog.getByRole('button', { name: 'Сохранить' }).click()
    await blockedStorageDialog.getByText(/Не удалось связаться с сервером|Сервер не ответил вовремя/).waitFor()
    assert.equal(state.transactions.length, blockedStorageStartRows + 1)
    const blockedStorageOriginalId = state.transactions.at(-1).id
    await blockedStorageDialog.getByRole('button', { name: 'Отмена' }).click()
    await page.getByRole('button', { name: 'Добавить' }).click()
    const reopenedStorageDialog = page.getByRole('dialog', { name: 'Новая операция' })
    await reopenedStorageDialog.getByLabel('Сумма, ₽').fill('9.44')
    await reopenedStorageDialog.getByRole('textbox', { name: 'Описание' }).fill('E2E закрытое хранилище')
    await reopenedStorageDialog.getByRole('button', { name: 'Сохранить' }).click()
    await reopenedStorageDialog.getByText(/Предыдущий запрос ещё не подтверждён/).waitFor()
    assert.equal(transactionInsertRequests, blockedStorageStartInserts + 1, 'changed payload with denied storage must not insert')
    assert.equal(state.transactions.length, blockedStorageStartRows + 1, 'denied storage must not permit a duplicate')
    await reopenedStorageDialog.getByLabel('Сумма, ₽').fill('9.43')
    await reopenedStorageDialog.getByRole('button', { name: 'Сохранить' }).click()
    await reopenedStorageDialog.waitFor({ state: 'detached' })
    assert.equal(transactionInsertRequests, blockedStorageStartInserts + 2, 'original payload must reuse its ID after form remount')
    assert.equal(state.transactions.length, blockedStorageStartRows + 1, 'idempotent retry must retain one row with denied storage')
    assert.equal(state.transactions.at(-1).id, blockedStorageOriginalId, 'volatile fallback must keep the original pending ID')
    assert.deepEqual(deniedStoragePageErrors, [], 'denied storage must not cause unhandled browser errors')

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
