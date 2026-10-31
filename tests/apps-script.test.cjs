const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

function makeHarness() {
  const sheets = new Map();
  const properties = new Map();
  let uuidCounter = 0;
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
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet, },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: text => ({ text, setMimeType() { return this; }, getContent() { return this.text; } })
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {}, hasLock: () => false }) },
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
  return { context, call, signup };
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
  const originalWrite = h.context.writeRows_;
  let failOnce = true;
  h.context.writeRows_ = function(name, rows) {
    if (name === 'recurring_payments' && failOnce) { failOnce = false; throw new Error('simulated write failure'); }
    return originalWrite(name, rows);
  };
  const args = { action: 'rpc', token: user.token, name: 'confirm_recurring_payment', params: {
    p_recurring_id: recurring.id, p_expected_due_date: '2026-10-28', p_operation_date: '2026-10-28'
  }};
  const failed = h.call(args);
  assert.match(failed.error.message, /simulated write failure/);
  const retried = h.call(args);
  assert.equal(retried.error, null, retried.error?.message);
  const txs = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data;
  assert.equal(txs.length, 1);
  assert.equal(txs[0].id, `recurring_${recurring.id}_2026-10-28`);
  const after = h.call({ action: 'query', token: user.token, table: 'recurring_payments', mode: 'select' }).data[0];
  assert.equal(after.next_due_date, '2026-11-28');
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
  const originalWrite = h.context.writeRows_;
  let failOnce = true;
  h.context.writeRows_ = function(name, rows) {
    if (name === 'planned_purchases' && failOnce) { failOnce = false; throw new Error('simulated purchase status write failure'); }
    return originalWrite(name, rows);
  };
  const args = { action: 'rpc', token: user.token, name: 'confirm_planned_purchase', params: {
    p_purchase_id: purchase.id, p_operation_date: '2026-10-28'
  }};
  const failed = h.call(args);
  assert.match(failed.error.message, /simulated purchase status write failure/);
  const retried = h.call(args);
  assert.equal(retried.error, null, retried.error?.message);
  const txs = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data;
  assert.equal(txs.length, 1);
  assert.equal(txs[0].id, `purchase_${purchase.id}`);
  const after = h.call({ action: 'query', token: user.token, table: 'planned_purchases', mode: 'select' }).data[0];
  assert.equal(after.status, 'bought');
  assert.equal(after.linked_transaction_id, txs[0].id);
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
  const originalWrite = h.context.writeRows_;
  let failOnce = true;
  h.context.writeRows_ = function(name, rows) {
    if (name === 'categories' && failOnce) {
      failOnce = false;
      throw new Error('simulated category write failure');
    }
    return originalWrite(name, rows);
  };

  const failed = h.call({ action: 'createFamily', token: user.token, name: 'Семья с ошибкой' });
  assert.match(failed.error.message, /simulated category write failure/);
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
  const originalWrite = h.context.writeRows_;
  let failOnce = true;
  h.context.writeRows_ = function(name, rows) {
    if (name === 'profiles' && failOnce) {
      failOnce = false;
      throw new Error('simulated profile write failure');
    }
    return originalWrite(name, rows);
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
test('GET health endpoint reports API version 5',()=>{const h=makeHarness(),r=JSON.parse(h.context.doGet().getContent());assert.equal(r.version,5);});


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

test('goal contributions require positive integer kopecks and deletion recalculates totals', () => {
  const h = makeHarness();
  const user = h.signup('goal-contribution-validation@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Проверка пополнений' }).data;
  const goal = h.call({
    action: 'query', token: user.token, table: 'goals', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Резерв', target_kopecks: 1000000 }
  }).data[0];
  for (const amount of [0, -100, 12.5]) {
    const rejected = h.call({
      action: 'query', token: user.token, table: 'goal_contributions', mode: 'insert',
      values: { goal_id: goal.id, amount_kopecks: amount, contribution_date: '2026-10-31' }
    });
    assert.match(rejected.error.message, /положительным целым числом копеек/);
  }
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
