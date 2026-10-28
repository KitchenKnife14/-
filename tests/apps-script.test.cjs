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
  }
  class Sheet {
    constructor(name) { this.name = name; this.cells = []; }
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
    setFrozenRows() {}
    hideSheet() {}
  }
  const spreadsheet = {
    getName: () => 'Семейный бюджет',
    getSheetByName: name => sheets.get(name) || null,
    insertSheet: name => { const sheet = new Sheet(name); sheets.set(name, sheet); return sheet; }
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
