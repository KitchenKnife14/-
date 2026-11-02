const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

function makeHarness() {
  const sheets = new Map();
  const properties = new Map();
  let uuidCounter = 0;
  const lockStats = { waits: 0, releases: 0 };
  class Range {
    constructor(sheet, row, col, rows, cols) { Object.assign(this, { sheet, row, col, rows, cols }); }
    getValues() {
      return Array.from({ length: this.rows }, (_, ri) =>
        Array.from({ length: this.cols }, (_, ci) => this.sheet.cells[this.row - 1 + ri]?.[this.col - 1 + ci] ?? '')
      );
    }
    setValues(values) {
      values.forEach((line, ri) => line.forEach((value, ci) => {
        const r = this.row - 1 + ri, c = this.col - 1 + ci;
        while (this.sheet.cells.length <= r) this.sheet.cells.push([]);
        while (this.sheet.cells[r].length <= c) this.sheet.cells[r].push('');
        this.sheet.cells[r][c] = value;
      }));
      return this;
    }
    setValue(value) { return this.setValues([[value]]); }
    clearContent() {
      for (let ri = 0; ri < this.rows; ri++) for (let ci = 0; ci < this.cols; ci++) {
        const r = this.row - 1 + ri, c = this.col - 1 + ci;
        if (this.sheet.cells[r]) this.sheet.cells[r][c] = '';
      }
      return this;
    }
    setNumberFormat(format) { this.numberFormat = format; return this; }
    getNumberFormat() { return this.numberFormat || 'General'; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.cells = []; this.maxRows = 1000; }
    getRange(...args) { return new Range(this, ...args); }
    getDataRange() {
      const last = this.getLastRow() || 1;
      const cols = Math.max(1, ...this.cells.map(row => row.length));
      return this.getRange(1, 1, last, cols);
    }
    getLastRow() {
      for (let i = this.cells.length - 1; i >= 0; i--) if (this.cells[i].some(v => v !== '' && v != null)) return i + 1;
      return 0;
    }
    appendRow(row) { this.getRange(this.getLastRow() + 1, 1, 1, row.length).setValues([row]); }
    getMaxRows() { return this.maxRows; }
    insertRowsAfter(after, howMany) { this.maxRows += howMany; return this; }
    deleteRow(row) { this.cells.splice(row - 1, 1); this.maxRows -= 1; return this; }
    deleteRows(row, howMany) { this.cells.splice(row - 1, howMany); this.maxRows -= howMany; return this; }
    setFrozenRows() {}
    hideSheet() {}
  }
  const spreadsheet = {
    getName: () => 'Семейный бюджет',
    getSheetByName: name => sheets.get(name) || null,
    insertSheet: name => { const sheet = new Sheet(name); sheets.set(name, sheet); return sheet; },
    deleteSheet: sheet => sheets.delete(sheet.name),
    getSpreadsheetTimeZone: () => 'Europe/Moscow'
  };
  const context = {
    console,
    Logger: { log: () => {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet, },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: text => ({ text, setMimeType() { return this; }, getContent() { return this.text; } })
    },
    LockService: { getScriptLock: () => ({ waitLock() { lockStats.waits++; }, releaseLock() { lockStats.releases++; }, hasLock: () => false }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.get(key) ?? null,
      setProperty: (key, value) => { properties.set(key, value); return this; },
      deleteProperty: key => properties.delete(key),
      getProperties: () => Object.fromEntries(properties)
    }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm, value) => [...crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : Buffer.from(value)).digest()],
      base64Encode: bytes => Buffer.from(bytes).toString('base64'),
      getUuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
      sleep: () => {},
      formatDate: (date, _tz, format) => format === 'yyyy-MM-dd' ? date.toISOString().slice(0, 10) : date.toISOString()
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('google-apps-script/Code.gs', 'utf8'), context);
  const call = (payload) => {
    const raw = context.doPost({ postData: { contents: JSON.stringify(payload) } }).getContent();
    return JSON.parse(raw);
  };
  const signup = email => {
    const response = call({ action: 'signup', email, password: 'correct-horse-battery' });
    assert.equal(response.error, null, response.error?.message);
    return response.data;
  };
  return { context, call, signup, lockStats };
}

test('signup and signin return the token and user in the API data envelope', () => {
  const h = makeHarness();
  const signup = h.call({ action: 'signup', email: 'auth-shape@example.com', password: 'correct-horse-battery' });
  assert.equal(signup.error, null, signup.error?.message);
  assert.equal(typeof signup.data.token, 'string');
  assert.equal(signup.data.user.email, 'auth-shape@example.com');
  assert.equal(signup.data.data, undefined);

  const signin = h.call({ action: 'signin', email: 'auth-shape@example.com', password: 'correct-horse-battery' });
  assert.equal(signin.error, null, signin.error?.message);
  assert.equal(typeof signin.data.token, 'string');
  assert.equal(signin.data.user.id, signup.data.user.id);
  assert.equal(signin.data.data, undefined);
});


function prepareAllSheetsForReadTests(h) {
  [
    'profiles', 'families', 'family_members', 'categories', 'accounts', 'transactions',
    'recurring_payments', 'budgets', 'goals', 'goal_contributions', 'planned_purchases',
    'monthly_plans', 'notifications'
  ].forEach(name => h.context.sheet_(name));
}

test('read-only requests do not wait for the global script lock; writes remain serialized', () => {
  const h = makeHarness();
  const user = h.signup('read-lock@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Чтение без блокировки' }).data;
  prepareAllSheetsForReadTests(h);
  const waitsBeforeRead = h.lockStats.waits;
  const read = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' });
  assert.equal(read.error, null, read.error?.message);
  assert.equal(h.lockStats.waits, waitsBeforeRead);
  const write = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert',
    values: { family_id: family.id, type: 'expense', amount_kopecks: 1000, operation_date: '2026-11-02', description: 'Тест блокировки' }
  });
  assert.equal(write.error, null, write.error?.message);
  assert.equal(h.lockStats.waits, waitsBeforeRead + 1);
  assert.equal(h.context.dataRevision_() % 2, 0);
});

test('read-only requests retry when a writer changes the revision during the snapshot', () => {
  const h = makeHarness();
  const user = h.signup('read-retry@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Повтор чтения' }).data;
  prepareAllSheetsForReadTests(h);
  let attempts = 0;
  const originalQuery = h.context.query_;
  h.context.query_ = function(req, authenticatedUser) {
    const result = originalQuery(req, authenticatedUser);
    attempts++;
    if (attempts === 1) {
      h.context.PropertiesService.getScriptProperties().setProperty('BUDGET_DATA_REVISION_V1', String(h.context.dataRevision_() + 2));
    }
    return result;
  };
  const result = h.call({ action: 'query', token: user.token, table: 'families', mode: 'select' });
  assert.equal(result.error, null, result.error?.message);
  assert.equal(attempts, 2);
  assert.equal(result.data[0].id, family.id);
});

test('an odd revision blocks reads until manual integrity verification', () => {
  const h = makeHarness();
  const user = h.signup('stale-revision@example.com');
  h.call({ action: 'createFamily', token: user.token, name: 'Проверка ревизии' });
  prepareAllSheetsForReadTests(h);
  h.context.PropertiesService.getScriptProperties().setProperty('BUDGET_DATA_REVISION_V1', '7');
  const result = h.call({ action: 'query', token: user.token, table: 'families', mode: 'select' });
  assert.match(result.error.message, /заблокирована после прерванной записи/i);
  assert.equal(h.context.dataRevision_(), 7);
  h.context.confirmDataIntegrityAfterManualAudit();
  assert.equal(h.context.dataRevision_(), 8);
});

test('a failed mutation after a sheet write leaves reads blocked for manual review', () => {
  const h = makeHarness();
  const user = h.signup('partial-write@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Частичная запись' }).data;
  prepareAllSheetsForReadTests(h);
  const append = h.context.appendRows_;
  h.context.appendRows_ = function(name, rows) { append(name, rows); throw new Error('simulated failure after write'); };
  const failed = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert',
    values: { family_id: family.id, type: 'expense', amount_kopecks: 900, operation_date: '2026-11-02', description: 'Частично записано' }
  });
  assert.match(failed.error.message, /simulated failure/i);
  assert.equal(h.context.dataRevision_() % 2, 1);
  const blockedRead = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' });
  assert.match(blockedRead.error.message, /заблокирована после прерванной записи/i);
});

test('goal contributions allow withdrawals but reject a negative final balance', () => {
  const h = makeHarness();
  const user = h.signup('goal-withdrawal@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Снятие с цели' }).data;
  const goal = h.call({ action: 'query', token: user.token, table: 'goals', mode: 'insert', returning: true, values: { family_id: family.id, name: 'Накопление', target_kopecks: 1000000, status: 'active' } }).data[0];
  const deposit = h.call({ action: 'query', token: user.token, table: 'goal_contributions', mode: 'insert', returning: true, values: { goal_id: goal.id, amount_kopecks: 500000, contribution_date: '2026-11-02', note: 'Пополнение' } });
  assert.equal(deposit.error, null, deposit.error?.message);
  const withdrawal = h.call({ action: 'query', token: user.token, table: 'goal_contributions', mode: 'insert', returning: true, values: { goal_id: goal.id, amount_kopecks: -125000, contribution_date: '2026-11-02', note: 'Снятие' } });
  assert.equal(withdrawal.error, null, withdrawal.error?.message);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'goals', mode: 'select' }).data[0].saved_kopecks, 375000);
  const excessive = h.call({ action: 'query', token: user.token, table: 'goal_contributions', mode: 'insert', values: { goal_id: goal.id, amount_kopecks: -400000, contribution_date: '2026-11-02' } });
  assert.match(excessive.error.message, /не может быть отрицательным/i);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'goal_contributions', mode: 'select' }).data.length, 2);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'goals', mode: 'select' }).data[0].saved_kopecks, 375000);
});

test('bulk goal movements cannot overdraw a goal', () => {
  const h = makeHarness();
  const user = h.signup('goal-bulk@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Пакетные снятия' }).data;
  const goal = h.call({ action: 'query', token: user.token, table: 'goals', mode: 'insert', returning: true, values: { family_id: family.id, name: 'Накопление', target_kopecks: 1000000, status: 'active' } }).data[0];
  h.call({ action: 'query', token: user.token, table: 'goal_contributions', mode: 'insert', values: { goal_id: goal.id, amount_kopecks: 10000, contribution_date: '2026-11-02' } });
  const result = h.call({
    action: 'query', token: user.token, table: 'goal_contributions', mode: 'insert',
    values: [
      { goal_id: goal.id, amount_kopecks: -6000, contribution_date: '2026-11-02' },
      { goal_id: goal.id, amount_kopecks: -6000, contribution_date: '2026-11-02' }
    ]
  });
  assert.match(result.error.message, /не может быть отрицательным/i);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'goal_contributions', mode: 'select' }).data.length, 1);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'goals', mode: 'select' }).data[0].saved_kopecks, 10000);
});

test('deleting a contribution cannot make the remaining goal balance negative', () => {
  const h = makeHarness();
  const user = h.signup('goal-delete@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Удаление пополнения' }).data;
  const goal = h.call({ action: 'query', token: user.token, table: 'goals', mode: 'insert', returning: true, values: { family_id: family.id, name: 'Накопление', target_kopecks: 1000000, status: 'active' } }).data[0];
  const deposit = h.call({ action: 'query', token: user.token, table: 'goal_contributions', mode: 'insert', returning: true, values: { goal_id: goal.id, amount_kopecks: 500000, contribution_date: '2026-11-02' } }).data[0];
  h.call({ action: 'query', token: user.token, table: 'goal_contributions', mode: 'insert', values: { goal_id: goal.id, amount_kopecks: -100000, contribution_date: '2026-11-02' } });
  const result = h.call({ action: 'query', token: user.token, table: 'goal_contributions', mode: 'delete', filters: [{ column: 'id', op: 'eq', value: deposit.id }] });
  assert.match(result.error.message, /не может быть отрицательным/i);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'goal_contributions', mode: 'select' }).data.length, 2);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'goals', mode: 'select' }).data[0].saved_kopecks, 400000);
});


test('family data is hidden until a user joins the family', () => {
  const h = makeHarness();
  const first = h.signup('first@example.com');
  const second = h.signup('second@example.com');
  const familyResult = h.call({ action: 'createFamily', token: first.token, name: 'Тестовая семья' });
  assert.equal(familyResult.error, null, familyResult.error?.message);
  const family = familyResult.data;
  const txInsert = h.call({
    action: 'query', token: first.token, table: 'transactions', mode: 'insert',
    values: { family_id: family.id, type: 'expense', amount_kopecks: 12345, operation_date: '2026-10-28', description: 'Тест' }
  });
  assert.equal(txInsert.error, null, txInsert.error?.message);
  const hidden = h.call({ action: 'query', token: second.token, table: 'transactions', mode: 'select' });
  assert.equal(hidden.data.length, 0);
  const joined = h.call({ action: 'joinFamily', token: second.token, invite_code: family.invite_code });
  assert.equal(joined.error, null, joined.error?.message);
  const visible = h.call({ action: 'query', token: second.token, table: 'transactions', mode: 'select' });
  assert.equal(visible.data.length, 1);
  assert.equal(visible.data[0].amount_kopecks, 12345);
});

test('recurring payment confirmation can retry after a partial write without duplicating the transaction', () => {
  const h = makeHarness();
  const user = h.signup('owner@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Повторные платежи' }).data;
  const created = h.call({
    action: 'query', token: user.token, table: 'recurring_payments', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 9900, description: 'Тестовая подписка', start_date: '2026-10-28', next_due_date: '2026-10-28', frequency: 'monthly', active: true }
  });
  assert.equal(created.error, null, created.error?.message);
  const recurring = h.call({ action: 'query', token: user.token, table: 'recurring_payments', mode: 'select' }).data[0];
  const originalUpdate = h.context.updateRows_;
  let failOnce = true;
  h.context.updateRows_ = function(name, rows) {
    if (name === 'recurring_payments' && failOnce) { failOnce = false; throw new Error('simulated write failure'); }
    return originalUpdate(name, rows);
  };
  const args = { action: 'rpc', token: user.token, name: 'confirm_recurring_payment', params: {
    p_recurring_id: recurring.id, p_expected_due_date: '2026-10-28', p_operation_date: '2026-10-28'
  }};
  const failed = h.call(args);
  assert.match(failed.error.message, /simulated write failure/);
  assert.equal(h.context.dataRevision_() % 2, 1, 'The incomplete recurring occurrence must block reads');
  const blockedRead = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' });
  assert.match(blockedRead.error.message, /заблокированы до восстановления/);
  const alteredRetry = h.call({ ...args, params: { ...args.params, p_operation_date: '2026-10-29' } });
  assert.match(alteredRetry.error.message, /Повторите исходное подтверждение/);
  const retried = h.call(args);
  assert.equal(retried.error, null, retried.error?.message);
  const txs = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data;
  assert.equal(txs.length, 1);
  assert.equal(txs[0].id, `recurring_${recurring.id}_2026-10-28`);
  const after = h.call({ action: 'query', token: user.token, table: 'recurring_payments', mode: 'select' }).data[0];
  assert.equal(after.next_due_date, '2026-11-28');
  assert.equal(h.context.dataRevision_() % 2, 0, 'A successful exact retry releases the data lock');
});


test('goal balances stay synchronized with contribution history', () => {
  const h = makeHarness();
  const user = h.signup('goals@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Цели семьи' }).data;
  const createdGoal = h.call({
    action: 'query', token: user.token, table: 'goals', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Велосипед', target_kopecks: 2500000, saved_kopecks: 0, status: 'active' }
  });
  assert.equal(createdGoal.error, null, createdGoal.error?.message);
  const goal = createdGoal.data[0];
  const createdContribution = h.call({
    action: 'query', token: user.token, table: 'goal_contributions', mode: 'insert', returning: true,
    values: { goal_id: goal.id, amount_kopecks: 500000, contribution_date: '2026-10-28', note: 'Первый взнос' }
  });
  assert.equal(createdContribution.error, null, createdContribution.error?.message);
  let savedGoal = h.call({ action: 'query', token: user.token, table: 'goals', mode: 'select' }).data[0];
  assert.equal(savedGoal.saved_kopecks, 500000);

  const contribution = createdContribution.data[0];
  const updated = h.call({
    action: 'query', token: user.token, table: 'goal_contributions', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: contribution.id }],
    values: { amount_kopecks: 700000 }
  });
  assert.equal(updated.error, null, updated.error?.message);
  savedGoal = h.call({ action: 'query', token: user.token, table: 'goals', mode: 'select' }).data[0];
  assert.equal(savedGoal.saved_kopecks, 700000);

  const deleted = h.call({
    action: 'query', token: user.token, table: 'goal_contributions', mode: 'delete',
    filters: [{ column: 'id', op: 'eq', value: contribution.id }]
  });
  assert.equal(deleted.error, null, deleted.error?.message);
  savedGoal = h.call({ action: 'query', token: user.token, table: 'goals', mode: 'select' }).data[0];
  assert.equal(savedGoal.saved_kopecks, 0);
});


test('purchase confirmation can retry after a partial write without duplicating the expense', () => {
  const h = makeHarness();
  const user = h.signup('purchases@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Покупки семьи' }).data;
  const created = h.call({
    action: 'query', token: user.token, table: 'planned_purchases', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Тестовый товар', estimated_kopecks: 125000, status: 'planned' }
  });
  assert.equal(created.error, null, created.error?.message);
  const purchase = created.data[0];
  const originalUpdate = h.context.updateRows_;
  let failOnce = true;
  h.context.updateRows_ = function(name, rows) {
    if (name === 'planned_purchases' && failOnce) { failOnce = false; throw new Error('simulated purchase status write failure'); }
    return originalUpdate(name, rows);
  };
  const args = { action: 'rpc', token: user.token, name: 'confirm_planned_purchase', params: {
    p_purchase_id: purchase.id, p_operation_date: '2026-10-28'
  }};
  const failed = h.call(args);
  assert.match(failed.error.message, /simulated purchase status write failure/);
  assert.equal(h.context.dataRevision_() % 2, 1, 'The unlinked purchase expense must block reads');
  const blockedRead = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' });
  assert.match(blockedRead.error.message, /заблокированы до восстановления/);
  const alteredRetry = h.call({ ...args, params: { ...args.params, p_operation_date: '2026-10-29' } });
  assert.match(alteredRetry.error.message, /Повторите исходное подтверждение/);
  const retried = h.call(args);
  assert.equal(retried.error, null, retried.error?.message);
  const txs = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data;
  assert.equal(txs.length, 1);
  assert.equal(txs[0].id, `purchase_${purchase.id}`);
  const after = h.call({ action: 'query', token: user.token, table: 'planned_purchases', mode: 'select' }).data[0];
  assert.equal(after.status, 'bought');
  assert.equal(after.linked_transaction_id, txs[0].id);
  assert.equal(h.context.dataRevision_() % 2, 0, 'A successful exact retry releases the data lock');
});


test('users cannot insert into another family or change record ownership', () => {
  const h = makeHarness();
  const first = h.signup('security-owner@example.com');
  const second = h.signup('security-other@example.com');
  const family = h.call({ action: 'createFamily', token: first.token, name: 'Приватная семья' }).data;
  const outsiderInsert = h.call({
    action: 'query', token: second.token, table: 'transactions', mode: 'insert',
    values: { family_id: family.id, type: 'expense', amount_kopecks: 10000, operation_date: '2026-10-28', description: 'Чужая операция' }
  });
  assert.match(outsiderInsert.error.message, /нет доступа/i);

  const ownInsert = h.call({
    action: 'query', token: first.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 10000, operation_date: '2026-10-28', description: 'Моя операция', created_by: second.user.id }
  });
  assert.equal(ownInsert.error, null, ownInsert.error?.message);
  const tx = ownInsert.data[0];
  assert.equal(tx.created_by, first.user.id);

  const ownershipChange = h.call({
    action: 'query', token: first.token, table: 'transactions', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: tx.id }],
    values: { created_by: second.user.id }
  });
  assert.match(ownershipChange.error.message, /автора записи/i);

  const moveToOtherFamily = h.call({
    action: 'query', token: first.token, table: 'transactions', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: tx.id }],
    values: { family_id: 'not-the-same-family' }
  });
  assert.match(moveToOtherFamily.error.message, /переносить запись/i);
});


test('recurring payments deactivate after the configured end date', () => {
  const h = makeHarness();
  const user = h.signup('recurring-end@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Регулярные платежи' }).data;
  const created = h.call({
    action: 'query', token: user.token, table: 'recurring_payments', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 5000, description: 'Разовый последний платёж', start_date: '2026-10-28', end_date: '2026-10-28', next_due_date: '2026-10-28', frequency: 'monthly', active: true }
  });
  assert.equal(created.error, null, created.error?.message);
  const recurring = created.data[0];
  const result = h.call({ action: 'rpc', token: user.token, name: 'confirm_recurring_payment', params: {
    p_recurring_id: recurring.id, p_expected_due_date: '2026-10-28', p_operation_date: '2026-10-28'
  }});
  assert.equal(result.error, null, result.error?.message);
  const saved = h.call({ action: 'query', token: user.token, table: 'recurring_payments', mode: 'select' }).data[0];
  assert.equal(saved.active, false);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data.length, 1);
});

test('deleting a goal removes its contribution history and unlinks planned purchases', () => {
  const h = makeHarness();
  const user = h.signup('goal-delete@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Удаление цели' }).data;
  const goalResult = h.call({
    action: 'query', token: user.token, table: 'goals', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Удаляемая цель', target_kopecks: 100000, status: 'active' }
  });
  const goal = goalResult.data[0];
  h.call({ action: 'query', token: user.token, table: 'goal_contributions', mode: 'insert',
    values: { goal_id: goal.id, amount_kopecks: 5000, contribution_date: '2026-10-28' }
  });
  h.call({ action: 'query', token: user.token, table: 'planned_purchases', mode: 'insert',
    values: { family_id: family.id, name: 'Связанная покупка', estimated_kopecks: 50000, goal_id: goal.id, status: 'planned' }
  });
  const deleted = h.call({ action: 'query', token: user.token, table: 'goals', mode: 'delete',
    filters: [{ column: 'id', op: 'eq', value: goal.id }]
  });
  assert.equal(deleted.error, null, deleted.error?.message);
  assert.equal(h.context.rows_('goal_contributions').length, 0);
  const purchase = h.call({ action: 'query', token: user.token, table: 'planned_purchases', mode: 'select' }).data[0];
  assert.equal(purchase.goal_id, '');
});


test('personal notifications cannot be read or reassigned by another family member', () => {
  const h = makeHarness();
  const owner = h.signup('notification-owner@example.com');
  const partner = h.signup('notification-partner@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Уведомления семьи' }).data;
  assert.equal(h.call({ action: 'joinFamily', token: partner.token, invite_code: family.invite_code }).error, null);

  const created = h.call({
    action: 'query', token: owner.token, table: 'notifications', mode: 'insert', returning: true,
    values: { family_id: family.id, user_id: owner.user.id, kind: 'system', title: 'Личное уведомление', read: false }
  });
  assert.equal(created.error, null, created.error?.message);
  const notification = created.data[0];
  const partnerRead = h.call({ action: 'query', token: partner.token, table: 'notifications', mode: 'select' });
  assert.equal(partnerRead.data.length, 0);

  const reassigned = h.call({
    action: 'query', token: owner.token, table: 'notifications', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: notification.id }],
    values: { user_id: partner.user.id }
  });
  assert.match(reassigned.error.message, /получателя уведомления/);

  const forged = h.call({
    action: 'query', token: partner.token, table: 'notifications', mode: 'insert',
    values: { family_id: family.id, user_id: owner.user.id, kind: 'system', title: 'Подмена' }
  });
  assert.match(forged.error.message, /другого пользователя/);
});


test('notification upsert always scopes records to the current user', () => {
  const h = makeHarness();
  const owner = h.signup('notification-upsert-owner@example.com');
  const partner = h.signup('notification-upsert-partner@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Upsert уведомлений' }).data;
  assert.equal(h.call({ action: 'joinFamily', token: partner.token, invite_code: family.invite_code }).error, null);

  const inserted = h.call({
    action: 'query', token: owner.token, table: 'notifications', mode: 'upsert', returning: true,
    values: { id: 'private-upsert', family_id: family.id, kind: 'system', title: 'Только владельцу' }
  });
  assert.equal(inserted.error, null, inserted.error?.message);
  const ownerRows = h.call({ action: 'query', token: owner.token, table: 'notifications', mode: 'select' });
  const partnerRows = h.call({ action: 'query', token: partner.token, table: 'notifications', mode: 'select' });
  assert.equal(ownerRows.data.length, 1);
  assert.equal(ownerRows.data[0].user_id, owner.user.id);
  assert.equal(partnerRows.data.length, 0);

  const forged = h.call({
    action: 'query', token: partner.token, table: 'notifications', mode: 'upsert',
    values: { id: 'forged-upsert', family_id: family.id, user_id: owner.user.id, kind: 'system', title: 'Подмена' }
  });
  assert.match(forged.error.message, /другого пользователя/);
});


test('notifications without an explicit recipient are hidden from all users', () => {
  const h = makeHarness();
  const owner = h.signup('notification-unassigned-owner@example.com');
  const partner = h.signup('notification-unassigned-partner@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Проверка получателя' }).data;
  assert.equal(h.call({ action: 'joinFamily', token: partner.token, invite_code: family.invite_code }).error, null);
  h.context.writeRows_('notifications', [{
    id: 'unassigned-notification', family_id: family.id, user_id: '', kind: 'system',
    title: 'Без получателя', body: '', read: false, created_at: '2026-10-28T00:00:00.000Z'
  }]);
  assert.equal(h.call({ action: 'query', token: owner.token, table: 'notifications', mode: 'select' }).data.length, 0);
  assert.equal(h.call({ action: 'query', token: partner.token, table: 'notifications', mode: 'select' }).data.length, 0);
});


test('repeated failed sign-ins are temporarily rate limited', () => {
  const h = makeHarness();
  h.signup('rate-limit@example.com');
  for (let i = 0; i < 8; i++) {
    const failed = h.call({ action: 'signin', email: 'rate-limit@example.com', password: 'incorrect-password' });
    assert.match(failed.error.message, /Неверный email или пароль/);
  }
  const blocked = h.call({ action: 'signin', email: 'rate-limit@example.com', password: 'correct-horse-battery' });
  assert.match(blocked.error.message, /Слишком много попыток входа/);
});


test('upsert cannot create a duplicate ID owned by another family member', () => {
  const h = makeHarness();
  const owner = h.signup('notification-id-owner@example.com');
  const partner = h.signup('notification-id-partner@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Уникальность ID' }).data;
  assert.equal(h.call({ action: 'joinFamily', token: partner.token, invite_code: family.invite_code }).error, null);
  const own = h.call({ action: 'query', token: owner.token, table: 'notifications', mode: 'insert', returning: true,
    values: { id: 'occupied-notification-id', family_id: family.id, kind: 'system', title: 'Личное' }
  });
  assert.equal(own.error, null, own.error?.message);
  const collision = h.call({ action: 'query', token: partner.token, table: 'notifications', mode: 'upsert',
    values: { id: 'occupied-notification-id', family_id: family.id, kind: 'system', title: 'Подмена' }
  });
  assert.match(collision.error.message, /ID уже существует или недоступна/);
  assert.equal(h.call({ action: 'query', token: owner.token, table: 'notifications', mode: 'select' }).data.length, 1);
  assert.equal(h.call({ action: 'query', token: partner.token, table: 'notifications', mode: 'select' }).data.length, 0);
});


test('transaction form uses the Google Sheets adapter instead of the legacy Supabase client', () => {
  const source = fs.readFileSync('src/components/TransactionForm.tsx', 'utf8');
  assert.match(source, /from ['"]\.\.\/lib\/googleSheets['"]/);
  assert.doesNotMatch(source, /from ['"]\.\.\/lib\/supabase['"]/);
});


test('update and delete without filters are rejected and preserve family data', () => {
  const h = makeHarness();
  const user = h.signup('no-filter@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Защита фильтров' }).data;
  const created = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 12300, operation_date: '2026-10-29', description: 'Не удалять' }
  });
  assert.equal(created.error, null, created.error?.message);

  const update = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'update', values: { description: 'Повреждено' } });
  assert.match(update.error.message, /нужен хотя бы один фильтр/i);
  const remove = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'delete' });
  assert.match(remove.error.message, /нужен хотя бы один фильтр/i);

  const rows = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' });
  assert.equal(rows.data.length, 1);
  assert.equal(rows.data[0].description, 'Не удалять');
});

test('health endpoint hides spreadsheet name unless DEBUG_INFO is enabled', () => {
  const h = makeHarness();
  const normal = JSON.parse(h.context.doGet().getContent());
  assert.equal(normal.status, 'ok');
  assert.equal(Object.hasOwn(normal, 'spreadsheet'), false);
});


test('family creation rolls back earlier writes if default category creation fails', () => {
  const h = makeHarness();
  const user = h.signup('family-rollback@example.com');
  const originalAppend = h.context.appendRows_;
  let failOnce = true;
  h.context.appendRows_ = function(name, rows) {
    if (name === 'categories' && failOnce) {
      failOnce = false;
      throw new Error('simulated category append failure');
    }
    return originalAppend(name, rows);
  };

  const failed = h.call({ action: 'createFamily', token: user.token, name: 'Семья с ошибкой' });
  assert.match(failed.error.message, /simulated category append failure/);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'families', mode: 'select' }).data.length, 0);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'family_members', mode: 'select' }).data.length, 0);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'categories', mode: 'select' }).data.length, 0);
});


test('direct API requests cannot read, update or delete another family records', () => {
  const h = makeHarness();
  const owner = h.signup('direct-api-owner@example.com');
  const outsider = h.signup('direct-api-outsider@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Семья владельца' }).data;
  const inserted = h.call({
    action: 'query', token: owner.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 56700, operation_date: '2026-10-29', description: 'Частная запись' }
  });
  assert.equal(inserted.error, null, inserted.error?.message);
  const id = inserted.data[0].id;

  const read = h.call({ action: 'query', token: outsider.token, table: 'transactions', mode: 'select', filters: [{ column: 'id', op: 'eq', value: id }] });
  assert.equal(read.error, null, read.error?.message);
  assert.equal(read.data.length, 0);

  const update = h.call({ action: 'query', token: outsider.token, table: 'transactions', mode: 'update', filters: [{ column: 'id', op: 'eq', value: id }], values: { description: 'Подмена' } });
  assert.equal(update.error, null, update.error?.message);
  const remove = h.call({ action: 'query', token: outsider.token, table: 'transactions', mode: 'delete', filters: [{ column: 'id', op: 'eq', value: id }] });
  assert.equal(remove.error, null, remove.error?.message);

  const ownerRows = h.call({ action: 'query', token: owner.token, table: 'transactions', mode: 'select', filters: [{ column: 'id', op: 'eq', value: id }] });
  assert.equal(ownerRows.data.length, 1);
  assert.equal(ownerRows.data[0].description, 'Частная запись');
});


test('signup removes auth record and session when profile creation fails', () => {
  const h = makeHarness();
  const originalAppend = h.context.appendRows_;
  let failOnce = true;
  h.context.appendRows_ = function(name, rows) {
    if (name === 'profiles' && failOnce) {
      failOnce = false;
      throw new Error('simulated profile write failure');
    }
    return originalAppend(name, rows);
  };

  const failed = h.call({ action: 'signup', email: 'profile-failure@example.com', password: 'correct-horse-battery' });
  assert.match(failed.error.message, /simulated profile write failure/);
  assert.equal(h.context.authRows_().some(user => user.email === 'profile-failure@example.com'), false);
  const signin = h.call({ action: 'signin', email: 'profile-failure@example.com', password: 'correct-horse-battery' });
  assert.match(signin.error.message, /Неверный email или пароль/);
});


test('strings beginning with equals are escaped before writing to Sheets', () => {
  const h = makeHarness();
  assert.equal(h.context.safeCell_('=1+1'), "'=1+1");
  assert.equal(h.context.safeCell_('обычный текст'), 'обычный текст');
  assert.equal(h.context.safeCell_(14), 14);
  assert.equal(h.context.safeCell_(null), null);
});

test('v3 creates exactly 82 default categories with valid parent links',()=>{const h=makeHarness(),u=h.signup('cat-v3@example.com'),f=h.call({action:'createFamily',token:u.token,name:'Категории'}).data,c=h.call({action:'query',token:u.token,table:'categories',mode:'select'}).data,p=c.filter(x=>!x.parent_id),ch=c.filter(x=>x.parent_id);assert.equal(c.length,82);assert.equal(p.length,13);assert.equal(ch.length,69);const ids=new Set(p.map(x=>x.id));assert.ok(ch.every(x=>ids.has(x.parent_id)));assert.ok(c.every(x=>x.family_id===f.id));});
test('v3 get_my_context returns profile, memberships and first family',()=>{const h=makeHarness(),u=h.signup('ctx-v3@example.com'),f=h.call({action:'createFamily',token:u.token,name:'Контекст',display_name:'Новое имя'}).data,r=h.call({action:'rpc',token:u.token,name:'get_my_context',params:{}});assert.equal(r.error,null,r.error?.message);assert.equal(r.data.profile.display_name,'Новое имя');assert.equal(r.data.members.length,1);assert.equal(r.data.family.id,f.id);});
test('v3 create_family and join_family_by_invite save display names',()=>{const h=makeHarness(),o=h.signup('owner-v3@example.com'),p=h.signup('partner-v3@example.com'),f=h.call({action:'rpc',token:o.token,name:'create_family',params:{p_name:'Семья v3',p_display_name:'Владелец'}});assert.equal(f.error,null,f.error?.message);const j=h.call({action:'rpc',token:p.token,name:'join_family_by_invite',params:{p_invite_code:f.data.invite_code,p_display_name:'Партнёр'}});assert.equal(j.error,null,j.error?.message);const c=h.call({action:'rpc',token:p.token,name:'get_my_context',params:{}});assert.equal(c.data.profile.display_name,'Партнёр');assert.equal(c.data.family.id,f.data.id);});
test('v3 batch isolates errors and preserves request order',()=>{const h=makeHarness(),u=h.signup('batch-v3@example.com'),f=h.call({action:'createFamily',token:u.token,name:'Пакет'}).data,r=h.call({action:'batch',token:u.token,requests:[{action:'query',table:'families',mode:'select'},{action:'rpc',name:'get_my_context',params:{}},{action:'unknown_action'}]});assert.equal(r.error,null,r.error?.message);assert.equal(r.data.length,3);assert.equal(r.data[0].data[0].id,f.id);assert.equal(r.data[1].data.family.id,f.id);assert.match(r.data[2].error.message,/Неизвестное действие/);});
test('v3 batch rejects more than 25 requests and unauthenticated calls',()=>{const h=makeHarness(),u=h.signup('batch-limit-v3@example.com'),r=h.call({action:'batch',token:u.token,requests:Array.from({length:26},()=>({action:'query',table:'profiles',mode:'select'}))}),noAuth=h.call({action:'batch',requests:[{action:'query',table:'profiles',mode:'select'}]});assert.match(r.error.message,/Слишком много запросов/);assert.match(noAuth.error.message,/Требуется вход/);});
test('GET health endpoint reports API version 6',()=>{const h=makeHarness(),r=JSON.parse(h.context.doGet().getContent());assert.equal(r.version,6);});


test('upsert cannot overwrite server-owned creation timestamp', () => {
  const h = makeHarness();
  const user = h.signup('audit-owner@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Аудит' }).data;
  const created = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 1000, operation_date: '2026-10-31', description: 'Исходная' }
  });
  assert.equal(created.error, null, created.error?.message);
  const tx = created.data[0];
  const result = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'upsert', onConflict: 'id',
    values: { id: tx.id, family_id: family.id, type: 'expense', amount_kopecks: 1000, created_at: '1999-01-01T00:00:00.000Z' }
  });
  assert.match(result.error.message, /Нельзя менять дату создания записи/);
  const unchanged = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data[0];
  assert.notEqual(unchanged.created_at, '1999-01-01T00:00:00.000Z');
});

test('upsert cannot create a duplicate ID belonging to another family', () => {
  const h = makeHarness();
  const first = h.signup('audit-first@example.com');
  const second = h.signup('audit-second@example.com');
  const familyA = h.call({ action: 'createFamily', token: first.token, name: 'Семья A' }).data;
  const familyB = h.call({ action: 'createFamily', token: second.token, name: 'Семья B' }).data;
  const inserted = h.call({
    action: 'query', token: first.token, table: 'transactions', mode: 'insert',
    values: { id: 'shared-id', family_id: familyA.id, type: 'expense', amount_kopecks: 100, operation_date: '2026-10-31' }
  });
  assert.equal(inserted.error, null, inserted.error?.message);
  const result = h.call({
    action: 'query', token: second.token, table: 'transactions', mode: 'upsert', onConflict: 'id',
    values: { id: 'shared-id', family_id: familyB.id, type: 'expense', amount_kopecks: 200, operation_date: '2026-10-31' }
  });
  assert.match(result.error.message, /уже существует или недоступна/);
  const visible = h.call({ action: 'query', token: first.token, table: 'transactions', mode: 'select' }).data;
  assert.equal(visible.length, 1);
  assert.equal(visible[0].family_id, familyA.id);
});


test('transactions cannot reference a category or account from another family', () => {
  const h = makeHarness();
  const a = h.signup('relation-a@example.com');
  const b = h.signup('relation-b@example.com');
  const fa = h.call({ action: 'createFamily', token: a.token, name: 'Семья A' }).data;
  const fb = h.call({ action: 'createFamily', token: b.token, name: 'Семья B' }).data;
  const foreignCategory = h.call({ action: 'query', token: b.token, table: 'categories', mode: 'select' }).data[0];
  const foreignAccount = h.call({
    action: 'query', token: b.token, table: 'accounts', mode: 'insert', returning: true,
    values: { family_id: fb.id, name: 'Чужой счёт', kind: 'cash', starting_balance_kopecks: 0 }
  }).data[0];
  const byCategory = h.call({
    action: 'query', token: a.token, table: 'transactions', mode: 'insert',
    values: { family_id: fa.id, type: 'expense', amount_kopecks: 100, operation_date: '2026-10-31', category_id: foreignCategory.id }
  });
  assert.match(byCategory.error.message, /Категория не найдена в этой семье/);
  const byAccount = h.call({
    action: 'query', token: a.token, table: 'transactions', mode: 'insert',
    values: { family_id: fa.id, type: 'expense', amount_kopecks: 100, operation_date: '2026-10-31', account_id: foreignAccount.id }
  });
  assert.match(byAccount.error.message, /Счёт списания не найдена в этой семье/);
});

test('transaction update cannot attach a foreign category or rewrite created_at', () => {
  const h = makeHarness();
  const a = h.signup('relation-update-a@example.com');
  const b = h.signup('relation-update-b@example.com');
  const fa = h.call({ action: 'createFamily', token: a.token, name: 'Семья A' }).data;
  h.call({ action: 'createFamily', token: b.token, name: 'Семья B' });
  const foreignCategory = h.call({ action: 'query', token: b.token, table: 'categories', mode: 'select' }).data[0];
  const created = h.call({
    action: 'query', token: a.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: fa.id, type: 'expense', amount_kopecks: 100, operation_date: '2026-10-31' }
  }).data[0];
  const categoryUpdate = h.call({
    action: 'query', token: a.token, table: 'transactions', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: created.id }], values: { category_id: foreignCategory.id }
  });
  assert.match(categoryUpdate.error.message, /Категория не найдена в этой семье/);
  const timestampUpdate = h.call({
    action: 'query', token: a.token, table: 'transactions', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: created.id }], values: { created_at: '1999-01-01T00:00:00.000Z' }
  });
  assert.match(timestampUpdate.error.message, /Нельзя менять дату создания записи/);
});


test('planned purchase confirmation rejects a deterministic ID collision', () => {
  const h = makeHarness();
  const user = h.signup('purchase-collision@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Покупки' }).data;
  const purchase = h.call({
    action: 'query', token: user.token, table: 'planned_purchases', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Велосипед', estimated_kopecks: 2000000, status: 'planned' }
  }).data[0];
  h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert',
    values: { id: 'purchase_' + purchase.id, family_id: family.id, type: 'expense', amount_kopecks: 1, operation_date: '2026-10-31', description: 'Посторонняя операция' }
  });
  const result = h.call({ action: 'rpc', token: user.token, name: 'confirm_planned_purchase', params: { p_purchase_id: purchase.id, p_operation_date: '2026-10-31' } });
  assert.match(result.error.message, /не соответствует планируемой покупке/);
  const unchanged = h.call({ action: 'query', token: user.token, table: 'planned_purchases', mode: 'select' }).data[0];
  assert.notEqual(unchanged.status, 'bought');
});

test('recurring payment confirmation rejects a deterministic ID collision', () => {
  const h = makeHarness();
  const user = h.signup('recurring-collision@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Регулярные платежи' }).data;
  const recurring = h.call({
    action: 'query', token: user.token, table: 'recurring_payments', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 99000, description: 'Интернет', start_date: '2026-10-01', frequency: 'monthly', next_due_date: '2026-11-01', active: true }
  }).data[0];
  const transactionId = 'recurring_' + recurring.id + '_' + recurring.next_due_date;
  h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert',
    values: { id: transactionId, family_id: family.id, type: 'expense', amount_kopecks: 1, operation_date: '2026-11-01', description: 'Чужая операция' }
  });
  const result = h.call({
    action: 'rpc', token: user.token, name: 'confirm_recurring_payment',
    params: { p_recurring_id: recurring.id, p_expected_due_date: recurring.next_due_date, p_operation_date: '2026-11-01' }
  });
  assert.match(result.error.message, /не соответствует регулярному платежу/);
  const unchanged = h.call({ action: 'query', token: user.token, table: 'recurring_payments', mode: 'select' }).data[0];
  assert.equal(unchanged.next_due_date, '2026-11-01');
});


test('goal contribution upsert validates ownership and recalculates saved total', () => {
  const h = makeHarness();
  const owner = h.signup('goal-upsert-owner@example.com');
  const outsider = h.signup('goal-upsert-outsider@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Цели' }).data;
  const foreignFamily = h.call({ action: 'createFamily', token: outsider.token, name: 'Чужие цели' }).data;
  const goal = h.call({
    action: 'query', token: owner.token, table: 'goals', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Отпуск', target_kopecks: 5000000 }
  }).data[0];
  const foreignGoal = h.call({
    action: 'query', token: outsider.token, table: 'goals', mode: 'insert', returning: true,
    values: { family_id: foreignFamily.id, name: 'Чужая цель', target_kopecks: 1000000 }
  }).data[0];
  const contribution = h.call({
    action: 'query', token: owner.token, table: 'goal_contributions', mode: 'insert', returning: true,
    values: { goal_id: goal.id, amount_kopecks: 100000, contribution_date: '2026-10-31' }
  }).data[0];
  const updated = h.call({
    action: 'query', token: owner.token, table: 'goal_contributions', mode: 'upsert', onConflict: 'id',
    values: { id: contribution.id, goal_id: goal.id, amount_kopecks: 250000, contribution_date: '2026-10-31' }
  });
  assert.equal(updated.error, null, updated.error?.message);
  const saved = h.call({ action: 'query', token: owner.token, table: 'goals', mode: 'select' }).data[0];
  assert.equal(Number(saved.saved_kopecks), 250000);
  const rejected = h.call({
    action: 'query', token: owner.token, table: 'goal_contributions', mode: 'upsert', onConflict: 'id',
    values: { id: contribution.id, goal_id: foreignGoal.id, amount_kopecks: 300000, contribution_date: '2026-10-31' }
  });
  assert.match(rejected.error.message, /Нет доступа к этой цели/);
  const unchanged = h.call({ action: 'query', token: owner.token, table: 'goals', mode: 'select' }).data[0];
  assert.equal(Number(unchanged.saved_kopecks), 250000);
});

test('deleting a purchase transaction unlinks the purchase and restores planned status', () => {
  const h = makeHarness();
  const user = h.signup('purchase-delete-link@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Связь покупки' }).data;
  const purchase = h.call({
    action: 'query', token: user.token, table: 'planned_purchases', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Телевизор', estimated_kopecks: 5500000, status: 'planned' }
  }).data[0];
  const confirmed = h.call({
    action: 'rpc', token: user.token, name: 'confirm_planned_purchase',
    params: { p_purchase_id: purchase.id, p_operation_date: '2026-10-31' }
  });
  assert.equal(confirmed.error, null, confirmed.error?.message);
  const transactionId = confirmed.data.transaction_id;
  const bought = h.call({ action: 'query', token: user.token, table: 'planned_purchases', mode: 'select' }).data[0];
  assert.equal(bought.status, 'bought');
  assert.equal(bought.linked_transaction_id, transactionId);

  let purchaseFullRewrites = 0;
  let purchaseTargetedUpdates = 0;
  const originalWriteRows = h.context.writeRows_;
  const originalUpdateRows = h.context.updateRows_;
  h.context.writeRows_ = function(table, rows) {
    if (table === 'planned_purchases') purchaseFullRewrites++;
    return originalWriteRows(table, rows);
  };
  h.context.updateRows_ = function(table, rows) {
    if (table === 'planned_purchases') purchaseTargetedUpdates += rows.length;
    return originalUpdateRows(table, rows);
  };
  const removed = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'delete',
    filters: [{ column: 'id', op: 'eq', value: transactionId }]
  });
  assert.equal(removed.error, null, removed.error?.message);
  assert.equal(purchaseFullRewrites, 0);
  assert.equal(purchaseTargetedUpdates, 1);
  const restored = h.call({ action: 'query', token: user.token, table: 'planned_purchases', mode: 'select' }).data[0];
  assert.equal(restored.status, 'planned');
  assert.equal(restored.linked_transaction_id, '');
  assert.equal(h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data.length, 0);
});

test('budgets reject duplicate family/category/month combinations on insert and update', () => {
  const h = makeHarness();
  const user = h.signup('budget-unique@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Уникальность бюджетов' }).data;
  const categories = h.call({ action: 'query', token: user.token, table: 'categories', mode: 'select' }).data
    .filter(category => category.kind === 'expense' && !category.parent_id);
  const first = h.call({
    action: 'query', token: user.token, table: 'budgets', mode: 'insert', returning: true,
    values: { family_id: family.id, category_id: categories[0].id, month_date: '2026-11-01', limit_kopecks: 100000 }
  });
  assert.equal(first.error, null, first.error?.message);
  const duplicate = h.call({
    action: 'query', token: user.token, table: 'budgets', mode: 'insert',
    values: { family_id: family.id, category_id: categories[0].id, month_date: '2026-11-01', limit_kopecks: 200000 }
  });
  assert.match(duplicate.error.message, /уже задан бюджет/);
  const second = h.call({
    action: 'query', token: user.token, table: 'budgets', mode: 'insert', returning: true,
    values: { family_id: family.id, category_id: categories[1].id, month_date: '2026-11-01', limit_kopecks: 300000 }
  });
  assert.equal(second.error, null, second.error?.message);
  const update = h.call({
    action: 'query', token: user.token, table: 'budgets', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: second.data[0].id }],
    values: { category_id: categories[0].id }
  });
  assert.match(update.error.message, /уже задан бюджет/);
  const rows = h.call({ action: 'query', token: user.token, table: 'budgets', mode: 'select' }).data;
  assert.equal(rows.length, 2);
  assert.equal(rows[1].category_id, categories[1].id);
});

test('deleting a recurring payment preserves history and detaches its transactions', () => {
  const h = makeHarness();
  const user = h.signup('recurring-delete@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'История регулярных платежей' }).data;
  const recurring = h.call({
    action: 'query', token: user.token, table: 'recurring_payments', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 129900, description: 'Домашний интернет', start_date: '2026-10-01', frequency: 'monthly', next_due_date: '2026-11-01', active: true }
  }).data[0];
  const confirmed = h.call({
    action: 'rpc', token: user.token, name: 'confirm_recurring_payment',
    params: { p_recurring_id: recurring.id, p_expected_due_date: recurring.next_due_date, p_operation_date: '2026-11-01' }
  });
  assert.equal(confirmed.error, null, confirmed.error?.message);
  const transactionId = 'recurring_' + recurring.id + '_' + recurring.next_due_date;
  const before = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data[0];
  assert.equal(before.parent_recurring_id, recurring.id);

  const removed = h.call({
    action: 'query', token: user.token, table: 'recurring_payments', mode: 'delete',
    filters: [{ column: 'id', op: 'eq', value: recurring.id }]
  });
  assert.equal(removed.error, null, removed.error?.message);
  const after = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data[0];
  assert.equal(after.id, transactionId);
  assert.equal(after.parent_recurring_id, '');
  assert.equal(after.amount_kopecks, 129900);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'recurring_payments', mode: 'select' }).data.length, 0);
});

test('goal contributions require nonzero integer kopecks and deletion recalculates totals', () => {
  const h = makeHarness();
  const user = h.signup('goal-contribution-validation@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Проверка пополнений' }).data;
  const goal = h.call({
    action: 'query', token: user.token, table: 'goals', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Резерв', target_kopecks: 1000000 }
  }).data[0];
  for (const amount of [0, 12.5]) {
    const rejected = h.call({
      action: 'query', token: user.token, table: 'goal_contributions', mode: 'insert',
      values: { goal_id: goal.id, amount_kopecks: amount, contribution_date: '2026-10-31' }
    });
    assert.match(rejected.error.message, /ненулевым целым числом копеек/);
  }
  const overdraft = h.call({
    action: 'query', token: user.token, table: 'goal_contributions', mode: 'insert',
    values: { goal_id: goal.id, amount_kopecks: -100, contribution_date: '2026-10-31' }
  });
  assert.match(overdraft.error.message, /не может быть отрицательным/i);
  const contribution = h.call({
    action: 'query', token: user.token, table: 'goal_contributions', mode: 'insert', returning: true,
    values: { goal_id: goal.id, amount_kopecks: 45000, contribution_date: '2026-10-31' }
  });
  assert.equal(contribution.error, null, contribution.error?.message);
  assert.equal(Number(h.call({ action: 'query', token: user.token, table: 'goals', mode: 'select' }).data[0].saved_kopecks), 45000);
  const removed = h.call({
    action: 'query', token: user.token, table: 'goal_contributions', mode: 'delete',
    filters: [{ column: 'id', op: 'eq', value: contribution.data[0].id }]
  });
  assert.equal(removed.error, null, removed.error?.message);
  assert.equal(Number(h.call({ action: 'query', token: user.token, table: 'goals', mode: 'select' }).data[0].saved_kopecks), 0);
});

test('transfers require two distinct family accounts and referenced accounts cannot be deleted', () => {
  const h = makeHarness();
  const user = h.signup('account-transfer-guards@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Проверка переводов' }).data;
  const addAccount = name => h.call({
    action: 'query', token: user.token, table: 'accounts', mode: 'insert', returning: true,
    values: { family_id: family.id, name, kind: 'bank', starting_balance_kopecks: 100000, archived: false }
  });
  const from = addAccount('Основная карта');
  const to = addAccount('Накопительный счёт');
  assert.equal(from.error, null, from.error?.message);
  assert.equal(to.error, null, to.error?.message);
  const missingDestination = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert',
    values: { family_id: family.id, type: 'transfer', amount_kopecks: 2500, operation_date: '2026-10-31', account_id: from.data[0].id }
  });
  assert.match(missingDestination.error.message, /нужны счёт списания и счёт зачисления/);
  const sameAccount = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert',
    values: { family_id: family.id, type: 'transfer', amount_kopecks: 2500, operation_date: '2026-10-31', account_id: from.data[0].id, to_account_id: from.data[0].id }
  });
  assert.match(sameAccount.error.message, /должны различаться/);
  const valid = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'transfer', amount_kopecks: 2500, operation_date: '2026-10-31', account_id: from.data[0].id, to_account_id: to.data[0].id, planned: false }
  });
  assert.equal(valid.error, null, valid.error?.message);
  const transferId = valid.data[0].id;
  const edited = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: transferId }],
    values: { amount_kopecks: 3200 }
  });
  assert.equal(edited.error, null, edited.error?.message);
  const afterEdit = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data[0];
  assert.equal(afterEdit.amount_kopecks, 3200);
  assert.equal(afterEdit.account_id, from.data[0].id);
  assert.equal(afterEdit.to_account_id, to.data[0].id);
  const protectedDelete = h.call({
    action: 'query', token: user.token, table: 'accounts', mode: 'delete',
    filters: [{ column: 'id', op: 'eq', value: from.data[0].id }]
  });
  assert.match(protectedDelete.error.message, /Архивируйте его вместо удаления/);
  const removedTransfer = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'delete',
    filters: [{ column: 'id', op: 'eq', value: transferId }]
  });
  assert.equal(removedTransfer.error, null, removedTransfer.error?.message);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data.length, 0);
  const deletion = h.call({
    action: 'query', token: user.token, table: 'accounts', mode: 'delete',
    filters: [{ column: 'id', op: 'eq', value: from.data[0].id }]
  });
  assert.equal(deletion.error, null, deletion.error?.message);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'accounts', mode: 'select' }).data.length, 1);
});

test('monthly and yearly recurring dates preserve the original calendar anchor', () => {
  const h = makeHarness();

  // A short month must not permanently shift a monthly payment from the 31st to the 28th.
  assert.equal(h.context.nextDate_('2026-01-31', 'monthly', null, '2026-01-31'), '2026-02-28');
  assert.equal(h.context.nextDate_('2026-02-28', 'monthly', null, '2026-01-31'), '2026-03-31');

  // A payment created on the 30th returns to the 30th after February.
  assert.equal(h.context.nextDate_('2026-01-30', 'monthly', null, '2026-01-30'), '2026-02-28');
  assert.equal(h.context.nextDate_('2026-02-28', 'monthly', null, '2026-01-30'), '2026-03-30');

  // Leap-day yearly schedules return to February 29 in the next leap year.
  assert.equal(h.context.nextDate_('2024-02-29', 'yearly', null, '2024-02-29'), '2025-02-28');
  assert.equal(h.context.nextDate_('2027-02-28', 'yearly', null, '2024-02-29'), '2028-02-29');
});

test('confirming a planned purchase can debit a selected active family account', () => {
  const h = makeHarness();
  const user = h.signup('purchase-account-owner@example.com');
  const outsider = h.signup('purchase-account-outsider@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Покупка со счёта' }).data;
  const foreignFamily = h.call({ action: 'createFamily', token: outsider.token, name: 'Другая семья' }).data;
  const account = h.call({
    action: 'query', token: user.token, table: 'accounts', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Основная карта', kind: 'bank', starting_balance_kopecks: 100000 }
  }).data[0];
  const foreignAccount = h.call({
    action: 'query', token: outsider.token, table: 'accounts', mode: 'insert', returning: true,
    values: { family_id: foreignFamily.id, name: 'Чужой счёт', kind: 'bank', starting_balance_kopecks: 0 }
  }).data[0];
  const purchase = h.call({
    action: 'query', token: user.token, table: 'planned_purchases', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Наушники', estimated_kopecks: 25000, status: 'planned' }
  }).data[0];

  const rejected = h.call({
    action: 'rpc', token: user.token, name: 'confirm_planned_purchase',
    params: { p_purchase_id: purchase.id, p_operation_date: '2026-10-31', p_account_id: foreignAccount.id }
  });
  assert.match(rejected.error.message, /счёт не найден в этой семье/);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data.length, 0);

  const confirmed = h.call({
    action: 'rpc', token: user.token, name: 'confirm_planned_purchase',
    params: { p_purchase_id: purchase.id, p_operation_date: '2026-10-31', p_account_id: account.id }
  });
  assert.equal(confirmed.error, null, confirmed.error?.message);
  const tx = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data[0];
  assert.equal(tx.account_id, account.id);
  assert.equal(tx.amount_kopecks, 25000);
});

test('monthly plan bulk upsert inserts and updates multiple rows in one logical operation', () => {
  const h = makeHarness();
  const user = h.signup('monthly-plan-bulk@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Пакетное планирование' }).data;
  const categories = h.call({ action: 'query', token: user.token, table: 'categories', mode: 'select' }).data
    .filter(category => category.kind === 'expense' && !category.parent_id).slice(0, 2);
  const values = categories.map((category, index) => ({
    family_id: family.id, month_date: '2026-11-01', category_id: category.id,
    type: 'expense', planned_kopecks: (index + 1) * 10000, note: ''
  }));
  const inserted = h.call({
    action: 'query', token: user.token, table: 'monthly_plans', mode: 'upsert',
    onConflict: 'family_id,month_date,category_id,type', values
  });
  assert.equal(inserted.error, null, inserted.error?.message);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'monthly_plans', mode: 'select' }).data.length, 2);

  const updated = h.call({
    action: 'query', token: user.token, table: 'monthly_plans', mode: 'upsert',
    onConflict: 'family_id,month_date,category_id,type',
    values: values.map((row) => ({ ...row, planned_kopecks: row.planned_kopecks + 5000 }))
  });
  assert.equal(updated.error, null, updated.error?.message);
  const rows = h.call({ action: 'query', token: user.token, table: 'monthly_plans', mode: 'select' }).data;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => Number(row.planned_kopecks)).sort((a, b) => a - b), [15000, 25000]);
});

test('transaction inserts append rows without replacing existing ledger entries', () => {
  const h = makeHarness();
  const user = h.signup('append-transaction@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Добавление операций' }).data;
  for (const [description, amount] of [['Первый расход', 1200], ['Второй расход', 3400], ['Третий расход', 5600]]) {
    const inserted = h.call({
      action: 'query', token: user.token, table: 'transactions', mode: 'insert',
      values: { family_id: family.id, type: 'expense', amount_kopecks: amount, operation_date: '2026-10-31', description }
    });
    assert.equal(inserted.error, null, inserted.error?.message);
  }
  const rows = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.description), ['Первый расход', 'Второй расход', 'Третий расход']);
  assert.deepEqual(rows.map(row => Number(row.amount_kopecks)), [1200, 3400, 5600]);
});

test('generated-ID transaction inserts do not read the full transaction ledger', () => {
  const h = makeHarness();
  const user = h.signup('fast-ledger-insert@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Быстрое добавление' }).data;
  const first = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert',
    values: { family_id: family.id, type: 'expense', amount_kopecks: 1000, operation_date: '2026-10-31', description: 'Существующая операция' }
  });
  assert.equal(first.error, null, first.error?.message);

  const originalReadRows = h.context.readRows_;
  let transactionLedgerReads = 0;
  h.context.readRows_ = function(name) {
    if (name === 'transactions') transactionLedgerReads++;
    return originalReadRows(name);
  };
  const second = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert',
    values: { family_id: family.id, type: 'expense', amount_kopecks: 2500, operation_date: '2026-10-31', description: 'Новая операция' }
  });
  assert.equal(second.error, null, second.error?.message);
  assert.equal(transactionLedgerReads, 0);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data.length, 2);
});

test('goal contribution recalculation updates only affected goal rows', () => {
  const h = makeHarness();
  const user = h.signup('goal-row-update@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Точечное обновление цели' }).data;
  const goals = [];
  for (const name of ['Цель А', 'Цель Б']) {
    goals.push(h.call({
      action: 'query', token: user.token, table: 'goals', mode: 'insert', returning: true,
      values: { family_id: family.id, name, target_kopecks: 100000, saved_kopecks: 0, status: 'active' }
    }).data[0]);
  }
  let fullGoalRewrites = 0;
  let targetedGoalUpdates = 0;
  const originalWriteRows = h.context.writeRows_;
  const originalUpdateRows = h.context.updateRows_;
  h.context.writeRows_ = function(table, rows) {
    if (table === 'goals') fullGoalRewrites++;
    return originalWriteRows(table, rows);
  };
  h.context.updateRows_ = function(table, rows) {
    if (table === 'goals') targetedGoalUpdates += rows.length;
    return originalUpdateRows(table, rows);
  };
  const result = h.call({
    action: 'query', token: user.token, table: 'goal_contributions', mode: 'insert',
    values: { goal_id: goals[0].id, amount_kopecks: 12500, contribution_date: '2026-10-31' }
  });
  assert.equal(result.error, null, result.error?.message);
  assert.equal(fullGoalRewrites, 0);
  assert.equal(targetedGoalUpdates, 1);
  const saved = h.call({ action: 'query', token: user.token, table: 'goals', mode: 'select' }).data;
  assert.equal(Number(saved.find(g => g.id === goals[0].id).saved_kopecks), 12500);
  assert.equal(Number(saved.find(g => g.id === goals[1].id).saved_kopecks), 0);
});

test('family creation appends rows instead of rewriting existing sheets', () => {
  const h = makeHarness();
  const user = h.signup('append-family@example.com');
  const rewrites = [];
  const originalWriteRows = h.context.writeRows_;
  h.context.writeRows_ = function(table, rows) {
    if (['families', 'family_members', 'categories', 'profiles'].includes(table)) rewrites.push(table);
    return originalWriteRows(table, rows);
  };
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Добавление без переписи' });
  assert.equal(family.error, null, family.error?.message);
  assert.deepEqual(rewrites, []);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'categories', mode: 'select' }).data.length > 80, true);
});

test('planned purchase confirmation updates only its row', () => {
  const h = makeHarness();
  const user = h.signup('purchase-targeted-update@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Точечное подтверждение' }).data;
  const purchase = h.call({
    action: 'query', token: user.token, table: 'planned_purchases', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Велосипед', estimated_kopecks: 2000000, status: 'planned' }
  }).data[0];
  let fullRewrites = 0;
  let targetedUpdates = 0;
  const originalWriteRows = h.context.writeRows_;
  const originalUpdateRows = h.context.updateRows_;
  h.context.writeRows_ = function(table, rows) {
    if (table === 'planned_purchases') fullRewrites++;
    return originalWriteRows(table, rows);
  };
  h.context.updateRows_ = function(table, rows) {
    if (table === 'planned_purchases') targetedUpdates += rows.length;
    return originalUpdateRows(table, rows);
  };
  const result = h.call({
    action: 'rpc', token: user.token, name: 'confirm_planned_purchase',
    params: { p_purchase_id: purchase.id, p_operation_date: '2026-10-31' }
  });
  assert.equal(result.error, null, result.error?.message);
  assert.equal(fullRewrites, 0);
  assert.equal(targetedUpdates, 1);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'planned_purchases', mode: 'select' }).data[0].status, 'bought');
});

test('PBKDF2-HMAC-SHA256 matches Node crypto for Unicode and SHA-256 block boundaries', () => {
  const h = makeHarness();
  const vectors = [
    ['password', 'salt', 1], ['password', 'salt', 2], ['password', 'salt', 4096],
    ['пароль', 'соль', 2], ['пароль😀', 'соль🔐', 30],
    ['a'.repeat(55), 'salt', 2], ['a'.repeat(56), 'salt', 2],
    ['a'.repeat(63), 'salt', 2], ['a'.repeat(64), 'salt', 2],
    ['a'.repeat(65), 'salt', 2], ['a'.repeat(100), 'salt', 2]
  ];
  for (const [password, salt, iterations] of vectors) {
    const expected = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
    assert.equal(h.context.pbkdf2Hex_(password, salt, iterations), expected);
  }
});

test('new accounts store PBKDF2 hashes and legacy accounts migrate after successful sign-in', () => {
  const h = makeHarness();
  const created = h.signup('password-migration@example.com');
  let row = h.context.authRows_().find(user => user.id === created.user.id);
  assert.equal(row.hash.startsWith('p2$30000$'), true);

  const legacy = h.context.hash_('correct-horse-battery', row.salt);
  h.context.authSheet_().getRange(row.row, 4, 1, 1).setValues([[legacy]]);
  const signin = h.call({ action: 'signin', email: 'password-migration@example.com', password: 'correct-horse-battery' });
  assert.equal(signin.error, null, signin.error?.message);
  row = h.context.authRows_().find(user => user.id === created.user.id);
  assert.equal(row.hash.startsWith('p2$30000$'), true);
});


test('batch aborts and leaves the data revision blocked after a subrequest partially mutates multiple sheets', () => {
  const h = makeHarness();
  const user = h.signup('batch-partial-write@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Пакетная частичная запись' }).data;
  const goal = h.call({
    action: 'query', token: user.token, table: 'goals', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Цель с историей', target_kopecks: 100000 }
  }).data[0];
  h.call({
    action: 'query', token: user.token, table: 'goal_contributions', mode: 'insert',
    values: { goal_id: goal.id, amount_kopecks: 10000, contribution_date: '2026-11-02' }
  });

  const originalDeleteRows = h.context.deleteRows_;
  h.context.deleteRows_ = function(table, rows) {
    if (table === 'goal_contributions') throw new Error('Искусственный сбой после удаления цели');
    return originalDeleteRows(table, rows);
  };

  const response = h.call({
    action: 'batch', token: user.token,
    requests: [{
      action: 'query', table: 'goals', mode: 'delete',
      filters: [{ column: 'id', op: 'eq', value: goal.id }]
    }]
  });

  assert.ok(response.error, 'A partial batch write must fail the whole batch');
  assert.match(response.error.message, /после начала записи/);
  assert.equal(h.context.dataRevision_() % 2, 1, 'The revision marker must remain odd until manual integrity review');
});

test('financial amount fields require positive safe integer kopecks on the server', () => {
  const h = makeHarness();
  const user = h.signup('safe-money-values@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Проверка сумм' }).data;
  const category = h.call({ action: 'query', token: user.token, table: 'categories', mode: 'select' }).data
    .find(item => item.kind === 'expense' && !item.parent_id);
  const invalidValues = ['100', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1];

  const cases = [
    { table: 'transactions', field: 'amount_kopecks', values: { family_id: family.id, type: 'expense', operation_date: '2026-11-02', description: 'Проверка' } },
    { table: 'recurring_payments', field: 'amount_kopecks', values: { family_id: family.id, type: 'expense', description: 'Подписка', start_date: '2026-11-02', next_due_date: '2026-11-02', frequency: 'monthly', active: true } },
    { table: 'budgets', field: 'limit_kopecks', values: { family_id: family.id, category_id: category.id, month_date: '2026-11-01' } },
    { table: 'goals', field: 'target_kopecks', values: { family_id: family.id, name: 'Цель' } },
    { table: 'planned_purchases', field: 'estimated_kopecks', values: { family_id: family.id, name: 'Покупка', status: 'planned' } },
    { table: 'monthly_plans', field: 'planned_kopecks', values: { family_id: family.id, month_date: '2026-11-01', category_id: category.id, type: 'expense' } },
  ];

  for (const item of cases) {
    for (const amount of invalidValues) {
      const result = h.call({
        action: 'query', token: user.token, table: item.table, mode: 'insert',
        values: { ...item.values, [item.field]: amount }
      });
      assert.ok(result.error, item.table + ' accepted invalid amount: ' + String(amount));
    }
  }
});

test('planned purchases can only become bought through the confirmation RPC', () => {
  const h = makeHarness();
  const user = h.signup('purchase-state-guard@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Проверка статуса покупки' }).data;
  const purchase = h.call({
    action: 'query', token: user.token, table: 'planned_purchases', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Телевизор', estimated_kopecks: 6500000, status: 'planned' }
  }).data[0];

  const directUpdate = h.call({
    action: 'query', token: user.token, table: 'planned_purchases', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: purchase.id }], values: { status: 'bought' }
  });
  assert.match(directUpdate.error.message, /только через подтверждение покупки/);

  const validTransaction = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 5000, operation_date: '2026-11-02', description: 'Свободная операция' }
  }).data[0];
  const arbitraryLink = h.call({
    action: 'query', token: user.token, table: 'planned_purchases', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: purchase.id }], values: { linked_transaction_id: validTransaction.id }
  });
  assert.match(arbitraryLink.error.message, /изменяется только сервером/);

  const directInsert = h.call({
    action: 'query', token: user.token, table: 'planned_purchases', mode: 'insert',
    values: { family_id: family.id, name: 'Поддельно купленная покупка', estimated_kopecks: 1000, status: 'bought' }
  });
  assert.match(directInsert.error.message, /только через подтверждение покупки/);

  const cancelled = h.call({
    action: 'query', token: user.token, table: 'planned_purchases', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Отменённая покупка', estimated_kopecks: 1000, status: 'cancelled' }
  }).data[0];
  const transactionCountBeforeRejectedConfirmation = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'select'
  }).data.length;
  const cancelledConfirmation = h.call({
    action: 'rpc', token: user.token, name: 'confirm_planned_purchase',
    params: { p_purchase_id: cancelled.id, p_operation_date: '2026-11-02' }
  });
  assert.match(cancelledConfirmation.error.message, /Отменённую покупку нельзя подтвердить/);
  assert.equal(
    h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data.length,
    transactionCountBeforeRejectedConfirmation,
    'A cancelled purchase must not create an expense'
  );
});

test('linked bought purchases cannot be edited in a way that desynchronizes their expense history', () => {
  const h = makeHarness();
  const user = h.signup('bought-purchase-edit@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Синхронизация покупки' }).data;
  const purchase = h.call({
    action: 'query', token: user.token, table: 'planned_purchases', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Наушники', estimated_kopecks: 250000, status: 'planned' }
  }).data[0];
  const confirmed = h.call({
    action: 'rpc', token: user.token, name: 'confirm_planned_purchase',
    params: { p_purchase_id: purchase.id, p_operation_date: '2026-11-02' }
  });
  assert.equal(confirmed.error, null, confirmed.error?.message);

  const edited = h.call({
    action: 'query', token: user.token, table: 'planned_purchases', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: purchase.id }], values: { estimated_kopecks: 300000 }
  });
  assert.match(edited.error.message, /Нельзя менять название, стоимость или категорию/);

  const reset = h.call({
    action: 'query', token: user.token, table: 'planned_purchases', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: purchase.id }], values: { status: 'planned' }
  });
  assert.match(reset.error.message, /статус и связь нельзя изменить/);
});


test('failed batched CRUD validation does not leak uncommitted rows into the request cache', () => {
  const h = makeHarness();
  const user = h.signup('batch-cache-isolation@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Кэш пакета' }).data;
  const category = h.call({ action: 'query', token: user.token, table: 'categories', mode: 'select' }).data
    .find(item => item.kind === 'expense' && !item.parent_id);

  const result = h.call({
    action: 'batch',
    token: user.token,
    requests: [
      {
        action: 'query',
        table: 'budgets',
        mode: 'insert',
        values: [
          { family_id: family.id, category_id: category.id, month_date: '2026-11-01', limit_kopecks: 100000 },
          { family_id: family.id, category_id: category.id, month_date: '2026-11-01', limit_kopecks: 200000 }
        ]
      },
      {
        action: 'query',
        table: 'budgets',
        mode: 'select',
        filters: [{ column: 'family_id', op: 'eq', value: family.id }]
      }
    ]
  });

  assert.equal(result.error, null, result.error?.message);
  assert.ok(result.data[0].error, 'The duplicate budget insert must fail validation');
  assert.deepEqual(result.data[1].data, [], 'The following select must not see an uncommitted budget from the failed insert');
  assert.equal(h.context.dataRevision_() % 2, 0, 'No sheet write happened, so the revision remains readable');
});

test('failed batched upsert validation does not mutate cached rows before commit', () => {
  const h = makeHarness();
  const owner = h.signup('batch-upsert-cache-owner@example.com');
  const outsider = h.signup('batch-upsert-cache-outsider@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Кэш upsert' }).data;
  const foreignFamily = h.call({ action: 'createFamily', token: outsider.token, name: 'Чужая семья' }).data;
  const category = h.call({ action: 'query', token: owner.token, table: 'categories', mode: 'select' }).data
    .find(item => item.kind === 'expense' && !item.parent_id);
  const foreignCategory = h.call({ action: 'query', token: outsider.token, table: 'categories', mode: 'select' }).data
    .find(item => item.kind === 'expense' && !item.parent_id);
  const created = h.call({
    action: 'query', token: owner.token, table: 'monthly_plans', mode: 'insert', returning: true,
    values: { family_id: family.id, month_date: '2026-11-01', category_id: category.id, type: 'expense', planned_kopecks: 10000, note: '' }
  });
  assert.equal(created.error, null, created.error?.message);
  const plan = created.data[0];

  const result = h.call({
    action: 'batch',
    token: owner.token,
    requests: [
      {
        action: 'query',
        table: 'monthly_plans',
        mode: 'upsert',
        onConflict: 'id',
        values: [
          { ...plan, planned_kopecks: 20000 },
          { id: 'new-plan', family_id: foreignFamily.id, month_date: '2026-11-01', category_id: foreignCategory.id, type: 'expense', planned_kopecks: 30000 }
        ]
      },
      {
        action: 'query',
        table: 'monthly_plans',
        mode: 'select',
        filters: [{ column: 'family_id', op: 'eq', value: family.id }]
      }
    ]
  });

  assert.equal(result.error, null, result.error?.message);
  assert.ok(result.data[0].error, 'The foreign-family row must reject the upsert');
  assert.equal(result.data[1].data.length, 1);
  assert.equal(Number(result.data[1].data[0].planned_kopecks), 10000, 'The cached row must still match the persisted row');
  assert.equal(h.context.dataRevision_() % 2, 0, 'No sheet write happened, so the revision remains readable');
});


test('archived categories and accounts cannot be assigned to new records but remain valid on historical edits', () => {
  const h = makeHarness();
  const user = h.signup('archived-relations@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Архивные связи' }).data;
  const categories = h.call({ action: 'query', token: user.token, table: 'categories', mode: 'select' }).data;
  const category = categories.find(item => item.kind === 'expense' && !item.parent_id && !item.archived);
  const secondCategory = categories.find(item => item.kind === 'expense' && !item.parent_id && item.id !== category.id && !item.archived);
  const account = h.call({
    action: 'query', token: user.token, table: 'accounts', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Основной счёт', kind: 'bank', starting_balance_kopecks: 0 }
  }).data[0];

  const historical = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 1000, operation_date: '2026-11-02', category_id: category.id, account_id: account.id, description: 'Старая операция' }
  }).data[0];
  const changeRelationLater = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 500, operation_date: '2026-11-02', description: 'Операция без счёта и категории' }
  }).data[0];

  assert.equal(h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: category.id }], values: { archived: true }
  }).error, null);
  assert.equal(h.call({
    action: 'query', token: user.token, table: 'accounts', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: account.id }], values: { archived: true }
  }).error, null);

  const newWithArchivedCategory = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert',
    values: { family_id: family.id, type: 'expense', amount_kopecks: 100, operation_date: '2026-11-02', category_id: category.id, description: 'Новая операция' }
  });
  assert.match(newWithArchivedCategory.error.message, /находится в архиве/);

  const newWithArchivedAccount = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert',
    values: { family_id: family.id, type: 'expense', amount_kopecks: 100, operation_date: '2026-11-02', account_id: account.id, description: 'Новая операция' }
  });
  assert.match(newWithArchivedAccount.error.message, /находится в архиве/);

  const historicalEdit = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: historical.id }], values: { description: 'Исправлено описание' }
  });
  assert.equal(historicalEdit.error, null, historicalEdit.error?.message);

  const attachArchivedCategory = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: changeRelationLater.id }], values: { category_id: category.id }
  });
  assert.match(attachArchivedCategory.error.message, /находится в архиве/);

  const attachArchivedAccount = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: changeRelationLater.id }], values: { account_id: account.id }
  });
  assert.match(attachArchivedAccount.error.message, /находится в архиве/);
  assert.equal(secondCategory.archived, false);
});

test('account owner must be a member of the same family', () => {
  const h = makeHarness();
  const owner = h.signup('account-owner-member@example.com');
  const member = h.signup('account-owner-valid@example.com');
  const outsider = h.signup('account-owner-outsider@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Владельцы счетов' }).data;
  const joined = h.call({ action: 'joinFamily', token: member.token, invite_code: family.invite_code });
  assert.equal(joined.error, null, joined.error?.message);

  const invalidOwner = h.call({
    action: 'query', token: owner.token, table: 'accounts', mode: 'insert',
    values: { family_id: family.id, name: 'Чужой владелец', kind: 'bank', starting_balance_kopecks: 0, owner_user_id: outsider.user.id }
  });
  assert.match(invalidOwner.error.message, /участником этой семьи/);

  const validOwner = h.call({
    action: 'query', token: owner.token, table: 'accounts', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Счёт супруга', kind: 'bank', starting_balance_kopecks: 0, owner_user_id: member.user.id }
  });
  assert.equal(validOwner.error, null, validOwner.error?.message);
  assert.equal(validOwner.data[0].owner_user_id, member.user.id);
});

test('categories referenced by history or child categories cannot be deleted', () => {
  const h = makeHarness();
  const user = h.signup('category-delete-guard@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Защита категорий' }).data;
  const root = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'insert', returning: true,
    values: { family_id: family.id, parent_id: null, name: 'Тестовая категория', kind: 'expense', icon: 'x', color: '#000000' }
  }).data[0];
  const child = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'insert', returning: true,
    values: { family_id: family.id, parent_id: root.id, name: 'Подкатегория', kind: 'expense', icon: 'x', color: '#000000' }
  }).data[0];

  const referencedByChild = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'delete',
    filters: [{ column: 'id', op: 'eq', value: root.id }]
  });
  assert.match(referencedByChild.error.message, /Архивируйте её вместо удаления/);

  const transaction = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 1000, operation_date: '2026-11-02', category_id: child.id, description: 'Исторический расход' }
  });
  assert.equal(transaction.error, null, transaction.error?.message);

  const referencedByHistory = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'delete',
    filters: [{ column: 'id', op: 'in', values: [root.id, child.id] }]
  });
  assert.match(referencedByHistory.error.message, /Архивируйте её вместо удаления/);

  const stillExists = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'select',
    filters: [{ column: 'id', op: 'in', values: [root.id, child.id] }]
  });
  assert.equal(stillExists.data.length, 2);
});

test('categories reject invalid hierarchy and mismatched parent kinds', () => {
  const h = makeHarness();
  const user = h.signup('category-hierarchy@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Иерархия категорий' }).data;
  const expenseRoot = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'insert', returning: true,
    values: { family_id: family.id, parent_id: null, name: 'Расходы тест', kind: 'expense', icon: 'x', color: '#000000' }
  }).data[0];

  const mismatchedChild = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'insert',
    values: { family_id: family.id, parent_id: expenseRoot.id, name: 'Доход под расходом', kind: 'income', icon: 'x', color: '#000000' }
  });
  assert.match(mismatchedChild.error.message, /должен совпадать/);

  const selfParent = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: expenseRoot.id }], values: { parent_id: expenseRoot.id }
  });
  assert.match(selfParent.error.message, /самой себе/);
});


test('accounts used by active recurring payments cannot be archived until the schedule is paused or removed', () => {
  const h = makeHarness();
  const user = h.signup('archive-account-recurring@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Архив счёта и регулярный платёж' }).data;
  const account = h.call({
    action: 'query', token: user.token, table: 'accounts', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Счёт для подписки', kind: 'bank', starting_balance_kopecks: 0 }
  }).data[0];
  const payment = h.call({
    action: 'query', token: user.token, table: 'recurring_payments', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 1000, description: 'Подписка', account_id: account.id, start_date: '2026-11-02', next_due_date: '2026-11-02', frequency: 'monthly', active: true }
  }).data[0];
  assert.equal(payment.account_id, account.id);

  const blockedArchive = h.call({
    action: 'query', token: user.token, table: 'accounts', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: account.id }], values: { archived: true }
  });
  assert.match(blockedArchive.error.message, /используется активным регулярным платежом/);

  const paused = h.call({
    action: 'query', token: user.token, table: 'recurring_payments', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: payment.id }], values: { active: false }
  });
  assert.equal(paused.error, null, paused.error?.message);

  const archived = h.call({
    action: 'query', token: user.token, table: 'accounts', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: account.id }], values: { archived: true }
  });
  assert.equal(archived.error, null, archived.error?.message);
});

test('categories used by active recurring payments cannot be archived until the schedule is paused', () => {
  const h = makeHarness();
  const user = h.signup('archive-category-recurring@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Архив категории и регулярный платёж' }).data;
  const category = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'insert', returning: true,
    values: { family_id: family.id, parent_id: null, name: 'Подписки тест', kind: 'expense', icon: 'x', color: '#000000' }
  }).data[0];
  const payment = h.call({
    action: 'query', token: user.token, table: 'recurring_payments', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 1000, description: 'Подписка', category_id: category.id, start_date: '2026-11-02', next_due_date: '2026-11-02', frequency: 'monthly', active: true }
  }).data[0];
  assert.equal(payment.category_id, category.id);

  const blockedArchive = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: category.id }], values: { archived: true }
  });
  assert.match(blockedArchive.error.message, /использует активный регулярный платёж/);

  const paused = h.call({
    action: 'query', token: user.token, table: 'recurring_payments', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: payment.id }], values: { active: false }
  });
  assert.equal(paused.error, null, paused.error?.message);

  const archived = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: category.id }], values: { archived: true }
  });
  assert.equal(archived.error, null, archived.error?.message);
});


test('registration closes automatically after the second family member joins and stays closed if the setting is missing', () => {
  const h = makeHarness();
  const owner = h.signup('signup-close-owner@example.com');
  const member = h.signup('signup-close-member@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Закрытие регистрации' }).data;

  const joined = h.call({ action: 'joinFamily', token: member.token, invite_code: family.invite_code });
  assert.equal(joined.error, null, joined.error?.message);

  const thirdSignup = h.call({
    action: 'signup', email: 'signup-close-third@example.com', password: 'correct-horse-battery'
  });
  assert.match(thirdSignup.error.message, /Регистрация закрыта/);

  // Even if the script property is accidentally removed, the server derives the limit from family membership.
  h.context.PropertiesService.getScriptProperties().deleteProperty('SIGNUP_DISABLED');
  const fourthSignup = h.call({
    action: 'signup', email: 'signup-close-fourth@example.com', password: 'correct-horse-battery'
  });
  assert.match(fourthSignup.error.message, /Регистрация закрыта/);

  const ownerSignin = h.call({ action: 'signin', email: 'signup-close-owner@example.com', password: 'correct-horse-battery' });
  const memberSignin = h.call({ action: 'signin', email: 'signup-close-member@example.com', password: 'correct-horse-battery' });
  assert.equal(ownerSignin.error, null, ownerSignin.error?.message);
  assert.equal(memberSignin.error, null, memberSignin.error?.message);
});


test('families and family memberships can only be created through dedicated server operations', () => {
  const h = makeHarness();
  const user = h.signup('family-rpc-only@example.com');

  const directFamilyInsert = h.call({
    action: 'query', token: user.token, table: 'families', mode: 'insert',
    values: { name: 'Обход onboarding' }
  });
  assert.match(directFamilyInsert.error.message, /только через безопасные серверные операции/);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'families', mode: 'select' }).data.length, 0);

  const family = h.call({
    action: 'rpc', token: user.token, name: 'create_family', params: { p_name: 'Правильное создание' }
  });
  assert.equal(family.error, null, family.error?.message);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'family_members', mode: 'select' }).data.length, 1);

  const directMembershipInsert = h.call({
    action: 'query', token: user.token, table: 'family_members', mode: 'insert',
    values: { family_id: family.data.id, user_id: user.user.id, role: 'owner' }
  });
  assert.match(directMembershipInsert.error.message, /только через безопасные серверные операции/);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'family_members', mode: 'select' }).data.length, 1);
});


test('update and delete reject unknown columns and unbounded filters without changing family data', () => {
  const h = makeHarness();
  const user = h.signup('strict-mutation-filters@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Строгие фильтры' }).data;
  const created = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 12500, operation_date: '2026-11-02', description: 'Не менять' }
  }).data[0];

  const unknownUpdate = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'update',
    filters: [{ column: 'nonexistent_column', op: 'eq', value: null }], values: { description: 'Массовая подмена' }
  });
  assert.match(unknownUpdate.error.message, /Недопустимое поле фильтра/);

  const unboundedUpdate = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'update',
    filters: [{ column: 'family_id', op: 'eq', value: family.id }], values: { description: 'Массовая подмена' }
  });
  assert.match(unboundedUpdate.error.message, /фильтр по ID/);

  const unknownDelete = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'delete',
    filters: [{ column: 'missing', op: 'eq', value: null }]
  });
  assert.match(unknownDelete.error.message, /Недопустимое поле фильтра/);

  const unboundedDelete = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'delete',
    filters: [{ column: 'family_id', op: 'eq', value: family.id }]
  });
  assert.match(unboundedDelete.error.message, /фильтр по ID/);

  const unchanged = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'select',
    filters: [{ column: 'id', op: 'eq', value: created.id }]
  }).data[0];
  assert.equal(unchanged.description, 'Не менять');
  assert.equal(unchanged.amount_kopecks, 12500);
});

test('bulk notification read updates are allowed but cannot reassign or rewrite notification content', () => {
  const h = makeHarness();
  const owner = h.signup('notification-bulk-owner@example.com');
  const member = h.signup('notification-bulk-member@example.com');
  const outsider = h.signup('notification-bulk-outsider@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Уведомления' }).data;
  assert.equal(h.call({ action: 'joinFamily', token: member.token, invite_code: family.invite_code }).error, null);
  const otherFamily = h.call({ action: 'createFamily', token: outsider.token, name: 'Другая семья' }).data;

  const ownerNotification = h.call({
    action: 'query', token: owner.token, table: 'notifications', mode: 'insert', returning: true,
    values: { family_id: family.id, kind: 'budget_warning', title: 'Лимит', body: 'Порог', read: false }
  }).data[0];
  h.call({
    action: 'query', token: member.token, table: 'notifications', mode: 'insert',
    values: { family_id: family.id, kind: 'goal_progress', title: 'Цель', body: 'Прогресс', read: false }
  });
  h.call({
    action: 'query', token: outsider.token, table: 'notifications', mode: 'insert',
    values: { family_id: otherFamily.id, kind: 'goal_progress', title: 'Чужое', body: 'Данные', read: false }
  });

  const bulk = h.call({
    action: 'query', token: owner.token, table: 'notifications', mode: 'update',
    filters: [{ column: 'family_id', op: 'eq', value: family.id }, { column: 'read', op: 'eq', value: false }],
    values: { read: true }
  });
  assert.equal(bulk.error, null, bulk.error?.message);

  const ownerRows = h.call({ action: 'query', token: owner.token, table: 'notifications', mode: 'select' }).data;
  const memberRows = h.call({ action: 'query', token: member.token, table: 'notifications', mode: 'select' }).data;
  assert.equal(ownerRows.length, 1);
  assert.equal(ownerRows[0].read, true);
  assert.equal(ownerRows[0].title, 'Лимит');
  assert.equal(memberRows.length, 1);
  assert.equal(memberRows[0].read, false);

  const rewrite = h.call({
    action: 'query', token: owner.token, table: 'notifications', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: ownerNotification.id }], values: { title: 'Подмена' }
  });
  assert.match(rewrite.error.message, /только изменять статус прочтения/);
});

test('upsert accepts only the supported unique keys', () => {
  const h = makeHarness();
  const user = h.signup('upsert-keys@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Ключи upsert' }).data;
  const invalid = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'upsert',
    onConflict: 'family_id', values: { family_id: family.id, type: 'expense', amount_kopecks: 100, operation_date: '2026-11-02', description: 'Не сохранять' }
  });
  assert.match(invalid.error.message, /не поддерживается указанный ключ upsert/);
  const valid = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'upsert', onConflict: 'id',
    values: { id: 'valid-expense', family_id: family.id, type: 'expense', amount_kopecks: 100, operation_date: '2026-11-02', description: 'Сохранить' }
  });
  assert.equal(valid.error, null, valid.error?.message);
});


test('batch rejects multiple write operations before executing any of them', () => {
  const h = makeHarness();
  const user = h.signup('batch-multiple-writes@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Пакет записей' }).data;
  const result = h.call({
    action: 'batch', token: user.token,
    requests: [
      { action: 'query', table: 'transactions', mode: 'insert', values: { family_id: family.id, type: 'expense', amount_kopecks: 100, operation_date: '2026-11-02', description: 'Первая' } },
      { action: 'query', table: 'transactions', mode: 'insert', values: { family_id: family.id, type: 'expense', amount_kopecks: 200, operation_date: '2026-11-02', description: 'Вторая' } }
    ]
  });
  assert.match(result.error.message, /не более одной изменяющей CRUD-операции/);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data.length, 0);
  assert.equal(h.context.dataRevision_() % 2, 0);
});


test('transaction and recurring-payment categories must match the operation type', () => {
  const h = makeHarness();
  const user = h.signup('category-kind-owner@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Виды категорий' }).data;
  const categories = h.call({ action: 'query', token: user.token, table: 'categories', mode: 'select' }).data;
  const expense = categories.find(c => c.kind === 'expense' && !c.parent_id && !c.archived);
  const income = categories.find(c => c.kind === 'income' && !c.parent_id && !c.archived);

  const wrongTransaction = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert',
    values: { family_id: family.id, type: 'income', amount_kopecks: 1000, operation_date: '2026-11-03', category_id: expense.id, description: 'Неверная категория' }
  });
  assert.match(wrongTransaction.error.message, /Тип категории должен совпадать/);

  const rightTransaction = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert',
    values: { family_id: family.id, type: 'income', amount_kopecks: 1000, operation_date: '2026-11-03', category_id: income.id, description: 'Правильная категория' }
  });
  assert.equal(rightTransaction.error, null, rightTransaction.error?.message);

  const wrongRecurring = h.call({
    action: 'query', token: user.token, table: 'recurring_payments', mode: 'insert',
    values: { family_id: family.id, type: 'income', amount_kopecks: 5000, category_id: expense.id, description: 'Неверная подписка', start_date: '2026-11-03', next_due_date: '2026-11-03', frequency: 'monthly', active: true }
  });
  assert.match(wrongRecurring.error.message, /Тип категории должен совпадать/);

  const invalidRecurringType = h.call({
    action: 'query', token: user.token, table: 'recurring_payments', mode: 'insert',
    values: { family_id: family.id, type: 'refund', amount_kopecks: 5000, description: 'Неверный тип', start_date: '2026-11-03', next_due_date: '2026-11-03', frequency: 'monthly', active: true }
  });
  assert.match(invalidRecurringType.error.message, /должен быть доходом или расходом/);
});

test('category type cannot be changed while financial history depends on it', () => {
  const h = makeHarness();
  const user = h.signup('immutable-used-category@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'История категорий' }).data;
  const category = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'insert', returning: true,
    values: { family_id: family.id, parent_id: null, name: 'Категория с историей', kind: 'expense', icon: 'x', color: '#000000' }
  }).data[0];
  h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert',
    values: { family_id: family.id, type: 'expense', amount_kopecks: 1000, operation_date: '2026-11-03', category_id: category.id, description: 'Историческая запись' }
  });

  const result = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: category.id }], values: { kind: 'income' }
  });
  assert.match(result.error.message, /пока она используется в финансовой истории/);
  const persisted = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'select',
    filters: [{ column: 'id', op: 'eq', value: category.id }]
  }).data[0];
  assert.equal(persisted.kind, 'expense');
});

test('goal and purchase responsible users must belong to the same family', () => {
  const h = makeHarness();
  const owner = h.signup('responsible-owner@example.com');
  const member = h.signup('responsible-member@example.com');
  const outsider = h.signup('responsible-outsider@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Ответственные' }).data;
  assert.equal(h.call({ action: 'joinFamily', token: member.token, invite_code: family.invite_code }).error, null);

  const wrongGoal = h.call({
    action: 'query', token: owner.token, table: 'goals', mode: 'insert',
    values: { family_id: family.id, name: 'Чужой ответственный', target_kopecks: 10000, responsible_user_id: outsider.user.id }
  });
  assert.match(wrongGoal.error.message, /должен быть участником этой семьи/);

  const rightGoal = h.call({
    action: 'query', token: owner.token, table: 'goals', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Ответственный супруг', target_kopecks: 10000, responsible_user_id: member.user.id }
  });
  assert.equal(rightGoal.error, null, rightGoal.error?.message);

  const wrongPurchase = h.call({
    action: 'query', token: owner.token, table: 'planned_purchases', mode: 'insert',
    values: { family_id: family.id, name: 'Покупка', estimated_kopecks: 1000, status: 'planned', responsible_user_id: outsider.user.id }
  });
  assert.match(wrongPurchase.error.message, /должен быть участником этой семьи/);
});


test('monthly plans enforce one family/month/category/type row across insert, update and ID upsert', () => {
  const h = makeHarness();
  const user = h.signup('monthly-plan-unique@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Уникальность планов' }).data;
  const categories = h.call({ action: 'query', token: user.token, table: 'categories', mode: 'select' }).data
    .filter(category => category.kind === 'expense' && !category.parent_id && !category.archived);
  const first = h.call({
    action: 'query', token: user.token, table: 'monthly_plans', mode: 'insert', returning: true,
    values: { family_id: family.id, month_date: '2026-11-01', category_id: categories[0].id, type: 'expense', planned_kopecks: 10000, note: 'Первая строка' }
  });
  assert.equal(first.error, null, first.error?.message);
  const duplicateInsert = h.call({
    action: 'query', token: user.token, table: 'monthly_plans', mode: 'insert',
    values: { family_id: family.id, month_date: '2026-11-01', category_id: categories[0].id, type: 'expense', planned_kopecks: 20000, note: 'Дубликат' }
  });
  assert.match(duplicateInsert.error.message, /уже задан план/);

  const second = h.call({
    action: 'query', token: user.token, table: 'monthly_plans', mode: 'insert', returning: true,
    values: { family_id: family.id, month_date: '2026-11-01', category_id: categories[1].id, type: 'expense', planned_kopecks: 30000, note: 'Вторая строка' }
  });
  assert.equal(second.error, null, second.error?.message);

  const duplicateUpdate = h.call({
    action: 'query', token: user.token, table: 'monthly_plans', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: second.data[0].id }], values: { category_id: categories[0].id }
  });
  assert.match(duplicateUpdate.error.message, /уже задан план/);

  const duplicateUpsert = h.call({
    action: 'query', token: user.token, table: 'monthly_plans', mode: 'upsert', onConflict: 'id',
    values: { ...second.data[0], category_id: categories[0].id }
  });
  assert.match(duplicateUpsert.error.message, /уже задан план/);

  const remaining = h.call({ action: 'query', token: user.token, table: 'monthly_plans', mode: 'select' }).data;
  assert.equal(remaining.length, 2);
  assert.equal(remaining[1].category_id, categories[1].id);
});


test('server rejects impossible dates and malformed operation times while accepting valid leap days', () => {
  const h = makeHarness();
  const user = h.signup('strict-dates@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Проверка дат' }).data;

  const invalidDate = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert',
    values: { family_id: family.id, type: 'expense', amount_kopecks: 1000, operation_date: '2026-02-30', description: 'Невозможная дата' }
  });
  assert.match(invalidDate.error.message, /некорректную календарную дату/);

  const invalidTime = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert',
    values: { family_id: family.id, type: 'expense', amount_kopecks: 1000, operation_date: '2028-02-29', operation_time: '25:61', description: 'Неверное время' }
  });
  assert.match(invalidTime.error.message, /формате ЧЧ:ММ/);

  const validLeapDay = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 1000, operation_date: '2028-02-29', operation_time: '09:05', description: 'Корректная дата' }
  });
  assert.equal(validLeapDay.error, null, validLeapDay.error?.message);
  assert.equal(validLeapDay.data[0].operation_date, '2028-02-29');

  const invalidMonth = h.call({
    action: 'query', token: user.token, table: 'budgets', mode: 'insert',
    values: { family_id: family.id, category_id: '', month_date: '2026-11-02', limit_kopecks: 100000 }
  });
  assert.match(invalidMonth.error.message, /первое число месяца/);
});
