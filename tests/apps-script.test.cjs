const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

function makeHarness() {
  const sheets = new Map();
  const properties = new Map();
  const scriptCache = new Map();
  let uuidCounter = 0;
  let lockAcquires = 0, lockReleases = 0, failNextLockWait = false;
  let setValuesCalls = 0, failSetValuesAt = null;
  let deleteRowsCalls = 0, failDeleteRowsAt = null;
  class Range {
    constructor(sheet, row, col, rows, cols) { Object.assign(this, { sheet, row, col, rows, cols }); }
    getValues() {
      return Array.from({ length: this.rows }, (_, ri) =>
        Array.from({ length: this.cols }, (_, ci) => this.sheet.cells[this.row - 1 + ri]?.[this.col - 1 + ci] ?? '')
      );
    }
    setValues(values) {
      setValuesCalls++;
      if (failSetValuesAt === setValuesCalls) { failSetValuesAt = null; throw new Error('Injected setValues failure'); }
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
    constructor(name) { this.name = name; this.cells = []; this.maxRows = 1000; this.hidden = false; }
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
    deleteRows(row, howMany) {
      deleteRowsCalls++;
      if (failDeleteRowsAt === deleteRowsCalls) { failDeleteRowsAt = null; throw new Error('Injected deleteRows failure'); }
      this.cells.splice(row - 1, howMany); this.maxRows -= howMany; return this;
    }
    setFrozenRows() {}
    hideSheet() { this.hidden = true; return this; }
    isSheetHidden() { return this.hidden; }
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
    CacheService: { getScriptCache: () => ({ get: key => scriptCache.get(key) ?? null, put: (key, value) => scriptCache.set(key, value), remove: key => scriptCache.delete(key) }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: text => ({ text, setMimeType() { return this; }, getContent() { return this.text; } })
    },
    LockService: { getScriptLock: () => ({
      waitLock() { lockAcquires++; if (failNextLockWait) { failNextLockWait = false; throw new Error('Injected lock timeout'); } },
      releaseLock() { lockReleases++; },
      hasLock: () => false
    }) },
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
  return {
    context, call, signup,
    lockStats: () => ({ acquires: lockAcquires, releases: lockReleases }),
    resetLockStats: () => { lockAcquires = 0; lockReleases = 0; },
    failNextLockWait: () => { failNextLockWait = true; },
    failSetValuesAfter: offset => { failSetValuesAt = setValuesCalls + offset; },
    failDeleteRowsAfter: offset => { failDeleteRowsAt = deleteRowsCalls + offset; }
  };
}

function seedTable(h, name) {
  const headers = JSON.parse(JSON.stringify(vm.runInContext(`TABLES[${JSON.stringify(name)}]`, h.context)));
  const sheet = h.context.SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name)
    || h.context.SpreadsheetApp.getActiveSpreadsheet().insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sheet;
}

test('doGet omits spreadsheet diagnostics unless DEBUG_INFO is explicitly enabled', () => {
  const h = makeHarness();
  const parse = output => JSON.parse(output.getContent());
  const normal = parse(h.context.doGet());
  assert.deepEqual(Object.keys(normal).sort(), ['message', 'status', 'version']);
  assert.equal(normal.status, 'ok');
  const props = h.context.PropertiesService.getScriptProperties();
  props.setProperty('DEBUG_INFO', '1');
  const debug = parse(h.context.doGet());
  assert.equal(debug.spreadsheet, 'Семейный бюджет');
});

test('Apps Script request logs contain metrics only and never payload secrets or financial values', () => {
  const h = makeHarness();
  const logs = [];
  h.context.console = { log: value => logs.push(String(value)) };
  const email = 'diagnostic-private@example.com';
  const password = 'private-password-never-log';
  const secretDescription = 'private-expense-description-never-log';
  const user = h.call({ action: 'signup', email, password });
  assert.equal(user.error, null, user.error?.message);
  const family = h.call({ action: 'createFamily', token: user.data.token, name: 'Private family name' });
  assert.equal(family.error, null, family.error?.message);
  const inserted = h.call({
    action: 'query', token: user.data.token, table: 'transactions', mode: 'insert',
    values: {
      family_id: family.data.id, type: 'expense', amount_kopecks: 987654321,
      operation_date: '2026-11-10', description: secretDescription
    }
  });
  assert.equal(inserted.error, null, inserted.error?.message);
  assert.equal(logs.length, 3);
  const allowed = ['act', 'lockMs', 'totalMs', 'workMs', 'reads', 'writes', 'readMs', 'writeMs'];
  for (const line of logs) {
    const record = JSON.parse(line);
    assert.deepEqual(Object.keys(record).sort(), allowed.sort());
    assert.ok(!line.includes(email));
    assert.ok(!line.includes(password));
    assert.ok(!line.includes(user.data.token));
    assert.ok(!line.includes(secretDescription));
    assert.ok(!line.includes('987654321'));
    assert.ok(!line.includes('Private family name'));
  }
});

test('request metrics never log attacker-controlled unknown action values', () => {
  const h = makeHarness();
  const logs = [];
  h.context.console = { log: value => logs.push(String(value)) };
  const marker = 'private-action-payload@example.com:secret-marker';
  const response = h.call({ action: marker });
  assert.ok(response.error);
  assert.equal(logs.length, 1);
  const record = JSON.parse(logs[0]);
  assert.equal(record.act, 'unknown');
  assert.equal(logs[0].includes(marker), false);
  assert.equal(logs[0].includes('secret-marker'), false);
});

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

test('expired sessions are rejected and removed from Script Properties', () => {
  const h = makeHarness();
  const user = h.signup('expired-session@example.com');
  const key = 'session:' + user.token;
  h.context.PropertiesService.getScriptProperties().setProperty(key, JSON.stringify({
    userId: user.user.id,
    expires: 0
  }));
  const response = h.call({ action: 'getSession', token: user.token });
  assert.match(response.error?.message || '', /Сессия завершена/);
  assert.equal(h.context.PropertiesService.getScriptProperties().getProperty(key), null);
});

test('malformed session records fail closed and are deleted on use', () => {
  const h = makeHarness();
  const user = h.signup('malformed-session@example.com');
  const props = h.context.PropertiesService.getScriptProperties();
  const key = 'session:' + user.token;
  const malformed = ['{not-json', 'null', JSON.stringify({ expires: Date.now() + 60_000 })];

  for (const value of malformed) {
    props.setProperty(key, value);
    const response = h.call({ action: 'getSession', token: user.token });
    assert.match(response.error?.message || '', /Сессия завершена/);
    assert.equal(props.getProperty(key), null);
  }
});

test('signout revokes the session token immediately', () => {
  const h = makeHarness();
  const user = h.signup('signout-session@example.com');
  const key = 'session:' + user.token;
  assert.ok(h.context.PropertiesService.getScriptProperties().getProperty(key));
  const signedOut = h.call({ action: 'signout', token: user.token });
  assert.equal(signedOut.error, null, signedOut.error?.message);
  assert.equal(signedOut.data, true);
  assert.equal(h.context.PropertiesService.getScriptProperties().getProperty(key), null);
  const nextRequest = h.call({ action: 'getSession', token: user.token });
  assert.match(nextRequest.error?.message || '', /Сессия завершена/);
});

test('signup prunes expired and malformed session properties but preserves live sessions', () => {
  const h = makeHarness();
  const user = h.signup('session-prune-owner@example.com');
  const props = h.context.PropertiesService.getScriptProperties();
  props.setProperty('session:expired', JSON.stringify({ userId: user.user.id, expires: 0 }));
  props.setProperty('session:malformed', '{not-json');
  props.setProperty('loginfail:expired', JSON.stringify({ count: 8, expires: 0, blockedUntil: 0 }));
  props.setProperty('session:live', JSON.stringify({ userId: user.user.id, expires: Date.now() + 60_000 }));
  const created = h.call({ action: 'signup', email: 'session-prune-new@example.com', password: 'correct-horse-battery' });
  assert.equal(created.error, null, created.error?.message);
  assert.equal(props.getProperty('session:expired'), null);
  assert.equal(props.getProperty('session:malformed'), null);
  assert.equal(props.getProperty('loginfail:expired'), null);
  assert.ok(props.getProperty('session:live'));
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

test('joinFamily validates membership before changing profile and remains idempotent', () => {
  const h = makeHarness();
  const owner = h.signup('join-owner@example.com');
  const partner = h.signup('join-partner@example.com');
  const third = h.signup('join-third@example.com');
  const outsider = h.signup('join-outsider@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Основная семья' }).data;
  const otherFamily = h.call({ action: 'createFamily', token: outsider.token, name: 'Другая семья' }).data;

  const joined = h.call({ action: 'joinFamily', token: partner.token, invite_code: ` ${family.invite_code.toLowerCase()} `, display_name: 'Участник' });
  assert.equal(joined.error, null, joined.error?.message);
  const repeated = h.call({ action: 'joinFamily', token: partner.token, invite_code: family.invite_code, display_name: 'Новое имя' });
  assert.equal(repeated.error, null, repeated.error?.message);
  assert.equal(h.context.rows_('family_members').filter(row => row.user_id === partner.user.id).length, 1);
  assert.equal(h.context.rows_('profiles').find(row => row.id === partner.user.id).display_name, 'Новое имя');

  const thirdBefore = h.context.rows_('profiles').find(row => row.id === third.user.id).display_name;
  const fullFamilyRejected = h.call({ action: 'joinFamily', token: third.token, invite_code: family.invite_code, display_name: 'Не менять имя третьего участника' });
  assert.match(fullFamilyRejected.error.message, /В семье уже два участника/);
  assert.equal(h.context.rows_('profiles').find(row => row.id === third.user.id).display_name, thirdBefore);
  assert.equal(h.context.rows_('family_members').filter(row => row.user_id === third.user.id).length, 0);

  const before = h.context.rows_('profiles').find(row => row.id === outsider.user.id).display_name;
  const rejected = h.call({ action: 'joinFamily', token: outsider.token, invite_code: family.invite_code, display_name: 'Не менять профиль' });
  assert.match(rejected.error.message, /Вы уже состоите в другой семье/);
  assert.equal(h.context.rows_('profiles').find(row => row.id === outsider.user.id).display_name, before);
  assert.equal(h.context.rows_('family_members').filter(row => row.user_id === outsider.user.id).length, 1);
  assert.ok(otherFamily.id);
});

test('joinFamily does not change the profile when the membership write fails', () => {
  const h = makeHarness();
  const owner = h.signup('join-write-owner@example.com');
  const partner = h.signup('join-write-partner@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Семья для проверки записи' }).data;
  const profileBefore = h.context.rows_('profiles').find(row => row.id === partner.user.id).display_name;
  const originalAppend = h.context.appendRows_;
  h.context.appendRows_ = function(name, rows) {
    if (name === 'family_members') throw new Error('simulated membership append failure');
    return originalAppend(name, rows);
  };

  const failed = h.call({
    action: 'joinFamily',
    token: partner.token,
    invite_code: family.invite_code,
    display_name: 'Имя не должно сохраниться'
  });
  assert.match(failed.error.message, /simulated membership append failure/);
  assert.equal(h.context.rows_('profiles').find(row => row.id === partner.user.id).display_name, profileBefore);
  assert.equal(h.context.rows_('family_members').filter(row => row.user_id === partner.user.id).length, 0);
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


test('planned purchase URLs accept only absolute HTTP(S) links', () => {
  const h = makeHarness();
  const user = h.signup('purchase-url@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Ссылки покупок' }).data;
  const insert = (url) => h.call({
    action: 'query', token: user.token, table: 'planned_purchases', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Товар', estimated_kopecks: 10000, status: 'planned', url }
  });
  for (const url of ['http://example.com/item', 'https://example.com/item?q=1']) {
    const result = insert(url);
    assert.equal(result.error, null, result.error?.message);
  }
  const invalid = [
    'javascript:alert(1)',
    'data:text/html,hello',
    '//evil.example/path',
    'ftp://example.com/file',
    'https://example.com/path with space',
    'https://example.com\\@evil.example',
    'https://' + 'a'.repeat(2042),
  ];
  for (const url of invalid) {
    const result = insert(url);
    assert.ok(result.error, 'expected rejection for ' + url.slice(0, 80));
    assert.match(result.error.message, /HTTP\(S\)/);
  }
  const rows = h.call({ action: 'query', token: user.token, table: 'planned_purchases', mode: 'select' }).data;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.url), ['http://example.com/item', 'https://example.com/item?q=1']);
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
  const profileBefore = h.context.rows_('profiles').find(row => row.id === user.user.id).display_name;
  const originalAppend = h.context.appendRows_;
  let failOnce = true;
  h.context.appendRows_ = function(name, rows) {
    if (name === 'categories' && failOnce) {
      failOnce = false;
      throw new Error('simulated category append failure');
    }
    return originalAppend(name, rows);
  };

  const failed = h.call({ action: 'createFamily', token: user.token, name: 'Семья с ошибкой', display_name: 'Имя не должно сохраниться' });
  assert.match(failed.error.message, /simulated category append failure/);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'families', mode: 'select' }).data.length, 0);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'family_members', mode: 'select' }).data.length, 0);
  assert.equal(h.call({ action: 'query', token: user.token, table: 'categories', mode: 'select' }).data.length, 0);
  assert.equal(h.context.rows_('profiles').find(row => row.id === user.user.id).display_name, profileBefore);
});


test('batch API cannot read, update or delete another family records', () => {
  const h = makeHarness();
  const owner = h.signup('batch-isolation-owner@example.com');
  const outsider = h.signup('batch-isolation-outsider@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Семья batch' }).data;
  const inserted = h.call({
    action: 'query', token: owner.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 12500, operation_date: '2026-11-10', description: 'Приватная запись' }
  });
  assert.equal(inserted.error, null, inserted.error?.message);
  const id = inserted.data[0].id;
  const filters = [{ column: 'id', op: 'eq', value: id }];
  const batch = h.call({
    action: 'batch', token: outsider.token,
    requests: [
      { action: 'query', table: 'transactions', mode: 'select', filters },
      { action: 'query', table: 'transactions', mode: 'update', filters, values: { description: 'Подмена через batch' } },
      { action: 'query', table: 'transactions', mode: 'delete', filters },
    ]
  });
  assert.equal(batch.error, null, batch.error?.message);
  assert.equal(batch.data[0].error, null);
  assert.deepEqual(batch.data[0].data, []);
  assert.equal(batch.data[1].error, null);
  assert.equal(batch.data[1].data, null);
  assert.equal(batch.data[2].error, null);
  assert.equal(batch.data[2].data, null);
  const ownerRead = h.call({ action: 'query', token: owner.token, table: 'transactions', mode: 'select', filters });
  assert.equal(ownerRead.data.length, 1);
  assert.equal(ownerRead.data[0].description, 'Приватная запись');
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
test('GET health endpoint reports API version 11',()=>{const h=makeHarness(),r=JSON.parse(h.context.doGet().getContent());assert.equal(r.version,11);});


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



test('goal contribution totals reject safe-integer overflow before writing rows', () => {
  const h = makeHarness();
  const user = h.signup('goal-total-overflow@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Проверка переполнения цели' }).data;
  const max = Number.MAX_SAFE_INTEGER;
  const goal = h.call({
    action: 'query', token: user.token, table: 'goals', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Резерв', target_kopecks: max }
  }).data[0];

  const first = h.call({
    action: 'query', token: user.token, table: 'goal_contributions', mode: 'insert', returning: true,
    values: { goal_id: goal.id, amount_kopecks: max - 1, contribution_date: '2026-11-10' }
  });
  assert.equal(first.error, null, first.error?.message);

  const overflowInsert = h.call({
    action: 'query', token: user.token, table: 'goal_contributions', mode: 'insert',
    values: { goal_id: goal.id, amount_kopecks: 2, contribution_date: '2026-11-10' }
  });
  assert.match(overflowInsert.error?.message || '', /превышает безопасный диапазон/);
  let contributions = h.call({ action: 'query', token: user.token, table: 'goal_contributions', mode: 'select' }).data;
  let savedGoal = h.call({ action: 'query', token: user.token, table: 'goals', mode: 'select' }).data[0];
  assert.equal(contributions.length, 1);
  assert.equal(savedGoal.saved_kopecks, max - 1);

  const overflowUpsert = h.call({
    action: 'query', token: user.token, table: 'goal_contributions', mode: 'upsert', onConflict: 'id',
    values: { id: 'overflow-upsert-001', goal_id: goal.id, amount_kopecks: 2, contribution_date: '2026-11-10' }
  });
  assert.match(overflowUpsert.error?.message || '', /превышает безопасный диапазон/);
  contributions = h.call({ action: 'query', token: user.token, table: 'goal_contributions', mode: 'select' }).data;
  assert.equal(contributions.length, 1);

  const smallGoal = h.call({
    action: 'query', token: user.token, table: 'goals', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Отпуск', target_kopecks: max }
  }).data[0];
  const smallA = h.call({
    action: 'query', token: user.token, table: 'goal_contributions', mode: 'insert', returning: true,
    values: { goal_id: smallGoal.id, amount_kopecks: 2, contribution_date: '2026-11-10' }
  }).data[0];
  h.call({
    action: 'query', token: user.token, table: 'goal_contributions', mode: 'insert',
    values: { goal_id: smallGoal.id, amount_kopecks: 1, contribution_date: '2026-11-10' }
  });
  const overflowUpdate = h.call({
    action: 'query', token: user.token, table: 'goal_contributions', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: smallA.id }],
    values: { amount_kopecks: max }
  });
  assert.match(overflowUpdate.error?.message || '', /превышает безопасный диапазон/);
  contributions = h.call({
    action: 'query', token: user.token, table: 'goal_contributions', mode: 'select',
    filters: [{ column: 'id', op: 'eq', value: smallA.id }]
  }).data;
  savedGoal = h.call({
    action: 'query', token: user.token, table: 'goals', mode: 'select',
    filters: [{ column: 'id', op: 'eq', value: smallGoal.id }]
  }).data[0];
  assert.equal(contributions[0].amount_kopecks, 2);
  assert.equal(savedGoal.saved_kopecks, 3);
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
  seedTable(h, 'transactions');
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

test('new registrations require 15 characters while existing shorter passwords remain valid', () => {
  const h = makeHarness();
  const short = h.call({ action: 'signup', email: 'short-password@example.com', password: '12345678' });
  assert.ok(short.error);
  assert.match(short.error.message, /15 символов/);

  const salt = 'legacy-short-password-salt';
  const email = 'existing-short-password@example.com';
  const id = 'legacy-short-password-user';
  h.context.authSheet_().appendRow([
    id, email, salt, h.context.hash_('12345678', salt), 'Existing user', h.context.now_()
  ]);
  const signin = h.call({ action: 'signin', email, password: '12345678' });
  assert.equal(signin.error, null, signin.error?.message);
  const row = h.context.authRows_().find(user => user.id === id);
  const parts = row.hash.split(String.fromCharCode(36));
  assert.equal(parts[0], 'p2');
  assert.equal(parts[1], '30000');
});
test('legacy integer kopecks stored as text are normalized to numbers when read', () => {
  const h = makeHarness();
  const user = h.signup('legacy-text-kopecks@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Старые копейки' }).data;
  const inserted = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 4510, operation_date: '2026-11-10' },
  });
  assert.equal(inserted.error, null, inserted.error?.message);
  const sheet = h.context.sheet_('transactions');
  sheet.getRange(2, 4, 1, 1).setValues([['4510']]);
  const read = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' });
  assert.equal(read.error, null, read.error?.message);
  assert.equal(read.data[0].amount_kopecks, 4510);
  assert.equal(typeof read.data[0].amount_kopecks, 'number');
});
test('authRows preserves physical sheet row numbers across blank rows before legacy hash migration', () => {
  const h = makeHarness();
  h.signup('first-auth-row@example.com');
  const second = h.signup('second-auth-row@example.com');
  const sheet = h.context.authSheet_();
  const secondRow = sheet.getRange(3, 1, 1, 6).getValues()[0];
  const legacy = h.context.hash_('correct-horse-battery', String(secondRow[2]));
  sheet.getRange(3, 4, 1, 1).setValue(legacy);
  sheet.getRange(2, 1, 1, 6).clearContent();

  const rows = h.context.authRows_();
  assert.equal(rows.find(row => row.id === second.user.id).row, 3);
  const signedIn = h.call({ action: 'signin', email: 'second-auth-row@example.com', password: 'correct-horse-battery' });
  assert.equal(signedIn.error, null, signedIn.error?.message);
  assert.ok(String(sheet.getRange(3, 4, 1, 1).getValues()[0][0]).startsWith('p2' + String.fromCharCode(36)));
  assert.equal(sheet.getRange(2, 4, 1, 1).getValues()[0][0], '');
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

test('password hash benchmark uses only dummy data and compares current and OWASP iteration targets', () => {
  const h = makeHarness();
  const calls = [];
  h.context.pbkdf2Hex_ = (password, salt, iterations) => {
    calls.push({ password, salt, iterations });
    return 'a'.repeat(64);
  };
  const results = h.context.benchmarkPasswordHash();
  assert.deepEqual(calls.map(call => call.iterations), [30000, 600000]);
  assert.ok(calls.every(call => call.password === 'local-only-pbkdf2-benchmark'));
  assert.ok(calls.every(call => call.salt === 'non-secret-fixed-benchmark-salt'));
  assert.deepEqual(Array.from(results, result => result.outputLength), [64, 64]);
  assert.ok(results.every(result => !('digest' in result)));
});

test('PBKDF2 stored hashes reject malformed parameters before expensive derivation', () => {
  const h = makeHarness();
  const malformed = [
    'p2$30000junk$' + 'a'.repeat(64),
    'p2$0$' + 'a'.repeat(64),
    'p2$-1$' + 'a'.repeat(64),
    'p2$1000001$' + 'a'.repeat(64),
    'p2$30000$' + 'a'.repeat(63),
    'p2$30000$' + 'g'.repeat(64),
    'p2$30000$' + 'a'.repeat(64) + '$extra',
  ];
  let derivations = 0;
  const original = h.context.pbkdf2Hex_;
  h.context.pbkdf2Hex_ = () => { derivations++; return 'a'.repeat(64); };
  for (const stored of malformed) assert.equal(h.context.passwordMatches_('password', 'salt', stored), false, stored);
  assert.equal(derivations, 0, 'malformed hashes must be rejected before PBKDF2');
  h.context.pbkdf2Hex_ = original;
});

test('signin normalizes email whitespace and letter case', () => {
  const h = makeHarness();
  h.signup('normalized-email@example.com');
  const result = h.call({ action: 'signin', email: '  NORMALIZED-EMAIL@EXAMPLE.COM  ', password: 'correct-horse-battery' });
  assert.equal(result.error, null, result.error?.message);
  assert.equal(typeof result.data.token, 'string');
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


test('Telegram one-time linking records transactions through the existing family authorization path', () => {
  const h = makeHarness();
  const owner = h.signup('telegram-owner@example.com');
  const partner = h.signup('telegram-partner@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Telegram семья' }).data;
  assert.equal(h.call({ action: 'joinFamily', token: partner.token, invite_code: family.invite_code }).error, null);

  const props = h.context.PropertiesService.getScriptProperties();
  props.setProperty('TELEGRAM_BACKEND_SECRET', 'test-backend-secret-0123456789abcdef01234567');
  const generated = h.call({ action: 'rpc', token: owner.token, name: 'create_telegram_link_code' });
  assert.equal(generated.error, null, generated.error?.message);
  assert.equal(generated.data.code.length, 12);

  const linked = h.call({
    action: 'telegramWebhook',
    telegramSecret: 'test-backend-secret-0123456789abcdef01234567',
    update: { update_id: 7001, message: {
      chat: { id: 700, type: 'private' }, from: { id: 700 },
      text: '/link ' + generated.data.code
    }}
  });
  assert.equal(linked.error, null, linked.error?.message);
  assert.match(linked.data.text, /успешно привязан/);
  assert.ok(linked.data.text.includes('\n'), 'Telegram replies should contain real line breaks');
  assert.equal(linked.data.text.includes('\\n'), false, 'Telegram replies must not contain escaped newline text');

  const added = h.call({
    action: 'telegramWebhook',
    telegramSecret: 'test-backend-secret-0123456789abcdef01234567',
    update: { update_id: 7002, message: {
      chat: { id: 700, type: 'private' }, from: { id: 700 },
      text: 'Проезд 45 рублей'
    }}
  });
  assert.equal(added.error, null, added.error?.message);
  assert.match(added.data.text, /45,00 ₽/);

  const transactions = h.call({ action: 'query', token: owner.token, table: 'transactions', mode: 'select' }).data;
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].type, 'expense');
  assert.equal(transactions[0].amount_kopecks, 4500);
  assert.equal(transactions[0].description, 'Проезд');
  const categories = h.call({ action: 'query', token: owner.token, table: 'categories', mode: 'select' }).data;
  assert.equal(categories.find(x => x.id === transactions[0].category_id).name, 'Общественный транспорт');

  // A Telegram retry with the same update_id returns the cached reply and does not append again.
  const retried = h.call({
    action: 'telegramWebhook',
    telegramSecret: 'test-backend-secret-0123456789abcdef01234567',
    update: { update_id: 7002, message: {
      chat: { id: 700, type: 'private' }, from: { id: 700 },
      text: 'Проезд 45 рублей'
    }}
  });
  assert.equal(retried.error, null, retried.error?.message);
  assert.equal(h.call({ action: 'query', token: partner.token, table: 'transactions', mode: 'select' }).data.length, 1);
  assert.equal(h.call({ action: 'query', token: owner.token, table: 'transactions', mode: 'select' }).data.length, 1);
});

test('Telegram webhook rejects an invalid backend secret and prevents reuse of a link code', () => {
  const h = makeHarness();
  const user = h.signup('telegram-code-owner@example.com');
  h.call({ action: 'createFamily', token: user.token, name: 'Одноразовый код' });
  h.context.PropertiesService.getScriptProperties().setProperty('TELEGRAM_BACKEND_SECRET', 'correct-secret-0123456789abcdef01234567');
  const generated = h.call({ action: 'rpc', token: user.token, name: 'create_telegram_link_code' });
  assert.equal(generated.error, null, generated.error?.message);

  const invalidSecret = h.call({
    action: 'telegramWebhook', telegramSecret: 'wrong-secret',
    update: { update_id: 7101, message: { chat: { id: 701, type: 'private' }, from: { id: 701 }, text: '/link ' + generated.data.code }}
  });
  assert.match(invalidSecret.error.message, /authentication failed/i);

  const linked = h.call({
    action: 'telegramWebhook', telegramSecret: 'correct-secret-0123456789abcdef01234567',
    update: { update_id: 7102, message: { chat: { id: 701, type: 'private' }, from: { id: 701 }, text: '/link ' + generated.data.code }}
  });
  assert.equal(linked.error, null, linked.error?.message);

  const reused = h.call({
    action: 'telegramWebhook', telegramSecret: 'correct-secret-0123456789abcdef01234567',
    update: { update_id: 7103, message: { chat: { id: 702, type: 'private' }, from: { id: 702 }, text: '/link ' + generated.data.code }}
  });
  assert.match(reused.error.message, /код не найден/i);
});


test('Telegram link tables cannot be forged through the public generic data API', () => {
  const h = makeHarness();
  const user = h.signup('telegram-table-guard@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Защита Telegram' }).data;
  const forgedLink = h.call({
    action: 'query', token: user.token, table: 'telegram_links', mode: 'insert',
    values: { family_id: family.id, user_id: user.user.id, telegram_user_id: '999999999', telegram_chat_id: '999999999' }
  });
  assert.match(forgedLink.error.message, /служебная Telegram-таблица/i);
  const forgedCode = h.call({
    action: 'query', token: user.token, table: 'telegram_link_codes', mode: 'insert',
    values: { family_id: family.id, user_id: user.user.id, code_hash: 'forged', expires_at: '2099-01-01T00:00:00.000Z' }
  });
  assert.match(forgedCode.error.message, /служебная Telegram-таблица/i);
});


test('Telegram salary expenses are assigned to the linked family member category', () => {
  const h = makeHarness();
  const owner = h.signup('telegram-salary-owner@example.com');
  const partner = h.signup('telegram-salary-partner@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Семья зарплат' }).data;
  h.call({ action: 'joinFamily', token: partner.token, invite_code: family.invite_code });

  h.context.PropertiesService.getScriptProperties().setProperty('TELEGRAM_BACKEND_SECRET', 'salary-secret-0123456789abcdef01234567');
  const generated = h.call({ action: 'rpc', token: partner.token, name: 'create_telegram_link_code' });
  assert.equal(generated.error, null, generated.error?.message);
  const link = h.call({
    action: 'telegramWebhook', telegramSecret: 'salary-secret-0123456789abcdef01234567',
    update: { update_id: 7201, message: { chat: { id: 720, type: 'private' }, from: { id: 720 }, text: '/link ' + generated.data.code }}
  });
  assert.equal(link.error, null, link.error?.message);

  const added = h.call({
    action: 'telegramWebhook', telegramSecret: 'salary-secret-0123456789abcdef01234567',
    update: { update_id: 7202, message: { chat: { id: 720, type: 'private' }, from: { id: 720 }, text: 'Доход 5000 рублей зарплата' }}
  });
  assert.equal(added.error, null, added.error?.message);
  const transactions = h.call({ action: 'query', token: partner.token, table: 'transactions', mode: 'select' }).data;
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].type, 'income');
  assert.equal(transactions[0].amount_kopecks, 500000);
  const categories = h.call({ action: 'query', token: partner.token, table: 'categories', mode: 'select' }).data;
  assert.equal(categories.find(x => x.id === transactions[0].category_id).name, 'Зарплата второго участника');
});


test('Telegram rejects ambiguous messages containing multiple numbers without writing a transaction', () => {
  const h = makeHarness();
  seedTable(h, 'transactions');
  const user = h.signup('telegram-ambiguous@example.com');
  h.call({ action: 'createFamily', token: user.token, name: 'Без неоднозначных операций' });
  h.context.PropertiesService.getScriptProperties().setProperty('TELEGRAM_BACKEND_SECRET', 'ambiguous-secret-0123456789abcdef01234567');
  const generated = h.call({ action: 'rpc', token: user.token, name: 'create_telegram_link_code' });
  assert.equal(generated.error, null, generated.error?.message);
  h.call({
    action: 'telegramWebhook', telegramSecret: 'ambiguous-secret-0123456789abcdef01234567',
    update: { update_id: 7301, message: { chat: { id: 730, type: 'private' }, from: { id: 730 }, text: '/link ' + generated.data.code }}
  });
  const ambiguous = h.call({
    action: 'telegramWebhook', telegramSecret: 'ambiguous-secret-0123456789abcdef01234567',
    update: { update_id: 7302, message: { chat: { id: 730, type: 'private' }, from: { id: 730 }, text: 'Продукты 45 и 50 рублей' }}
  });
  assert.match(ambiguous.error.message, /несколько чисел/i);
  const transactions = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data;
  assert.equal(transactions.length, 0);
});


test('transaction attribution defaults to author and permits only a member of the same family', () => {
  const h = makeHarness();
  const owner = h.signup('attribution-owner@example.com');
  const partner = h.signup('attribution-partner@example.com');
  const outsider = h.signup('attribution-outsider@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Учёт участников' }).data;
  h.call({ action: 'joinFamily', token: partner.token, invite_code: family.invite_code });

  const selectedPartner = h.call({
    action: 'query', token: owner.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 12500, operation_date: '2026-11-03', responsible_user_id: partner.user.id }
  });
  assert.equal(selectedPartner.error, null, selectedPartner.error?.message);
  assert.equal(selectedPartner.data[0].created_by, owner.user.id);
  assert.equal(selectedPartner.data[0].responsible_user_id, partner.user.id);

  const invalid = h.call({
    action: 'query', token: owner.token, table: 'transactions', mode: 'insert',
    values: { family_id: family.id, type: 'expense', amount_kopecks: 1000, operation_date: '2026-11-03', responsible_user_id: outsider.user.id }
  });
  assert.match(invalid.error.message, /ответственный участник/i);

  const defaulted = h.call({
    action: 'query', token: partner.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'income', amount_kopecks: 50000, operation_date: '2026-11-03' }
  });
  assert.equal(defaulted.error, null, defaulted.error?.message);
  assert.equal(defaulted.data[0].responsible_user_id, partner.user.id);
});

test('get_my_context returns names for both family participants', () => {
  const h = makeHarness();
  const owner = h.signup('context-owner@example.com');
  const partner = h.signup('context-partner@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Профили семьи' }).data;
  h.call({ action: 'ensureProfile', token: owner.token, display_name: 'Никита' });
  h.call({ action: 'joinFamily', token: partner.token, invite_code: family.invite_code });
  h.call({ action: 'ensureProfile', token: partner.token, display_name: 'Леся' });
  const context = h.call({ action: 'rpc', token: owner.token, name: 'get_my_context' });
  assert.equal(context.error, null, context.error?.message);
  assert.deepEqual(context.data.member_profiles.map(p => p.id).sort(), [owner.user.id, partner.user.id].sort());
  assert.ok(context.data.member_profiles.every(p => typeof p.display_name === 'string' && p.display_name.length > 0));
});

test('create_goal_with_purchase creates a linked goal and planned purchase', () => {
  const h = makeHarness();
  const user = h.signup('goal-purchase-link@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Связанные цели' }).data;
  const result = h.call({
    action: 'rpc', token: user.token, name: 'create_goal_with_purchase',
    params: { p_family_id: family.id, p_name: 'Телевизор', p_description: 'Для гостиной', p_target_kopecks: 7000000, p_target_date: '2027-03-01', p_priority: 2, p_create_purchase: true }
  });
  assert.equal(result.error, null, result.error?.message);
  const goal = h.call({ action: 'query', token: user.token, table: 'goals', mode: 'select' }).data.find(g => g.id === result.data.goal_id);
  const purchase = h.call({ action: 'query', token: user.token, table: 'planned_purchases', mode: 'select' }).data.find(p => p.id === result.data.purchase_id);
  assert.equal(goal.name, 'Телевизор');
  assert.equal(purchase.goal_id, goal.id);
  assert.equal(purchase.name, goal.name);
  assert.equal(purchase.estimated_kopecks, goal.target_kopecks);
  assert.equal(purchase.comment, goal.description);
});

test('supplemental category provisioning is idempotent', () => {
  const h = makeHarness();
  const user = h.signup('supplemental-category-migration@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Дополнительные категории' }).data;
  const first = h.call({ action: 'rpc', token: user.token, name: 'ensure_supplemental_categories', params: { p_family_id: family.id } });
  const second = h.call({ action: 'rpc', token: user.token, name: 'ensure_supplemental_categories', params: { p_family_id: family.id } });
  assert.equal(first.error, null, first.error?.message);
  assert.equal(second.error, null, second.error?.message);
  const categories = h.call({ action: 'query', token: user.token, table: 'categories', mode: 'select' }).data;
  assert.equal(categories.filter(c => !c.parent_id && c.name === 'Сигареты').length, 1);
  assert.equal(categories.filter(c => !c.parent_id && c.name === 'Кредиты').length, 1);
  assert.equal(categories.filter(c => c.name === 'Погашение основного долга').length, 1);
});

test('_auth refuses a mismatched header without changing credential rows', () => {
  const h = makeHarness();
  const spreadsheet = h.context.SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.insertSheet('_auth');
  const badHeaders = ['id', 'salt', 'email', 'password_hash', 'display_name', 'created_at'];
  const credentialRow = ['user-1', 'salt-value', 'user@example.com', 'hash-value', 'User', '2026-11-10'];
  sheet.getRange(1, 1, 1, badHeaders.length).setValues([badHeaders]);
  sheet.getRange(2, 1, 1, credentialRow.length).setValues([credentialRow]);

  assert.throws(() => h.context.authRows_(), /структура служебного листа _auth/);
  assert.deepEqual(sheet.getRange(1, 1, 1, badHeaders.length).getValues()[0], badHeaders);
  assert.deepEqual(sheet.getRange(2, 1, 1, credentialRow.length).getValues()[0], credentialRow);
});

test('read-only query refuses implicit schema migration and preserves legacy transaction rows', () => {
  const h = makeHarness();
  const user = h.signup('schema-additive@example.com');
  h.call({ action: 'createFamily', token: user.token, name: 'Миграция схемы' });
  const spreadsheet = h.context.SpreadsheetApp.getActiveSpreadsheet();
  const oldHeaders = ['id', 'family_id', 'type', 'amount_kopecks', 'operation_date', 'operation_time', 'category_id', 'account_id', 'to_account_id', 'description', 'created_by', 'updated_by', 'planned', 'parent_recurring_id', 'created_at', 'updated_at'];
  const sheet = spreadsheet.insertSheet('transactions');
  sheet.getRange(1, 1, 1, oldHeaders.length).setValues([oldHeaders]);
  const preservedRow = ['legacy-id', 'family-1', 'expense', 4500, '2026-11-03', '', '', '', '', 'Старый расход', 'user-1', 'user-1', false, '', '2026-11-03T10:00:00.000Z', '2026-11-03T10:00:00.000Z'];
  sheet.getRange(2, 1, 1, oldHeaders.length).setValues([preservedRow]);
  const result = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' });
  assert.match(result.error?.message || '', /требует обслуживания.*без автоматического изменения заголовков/);
  assert.deepEqual(sheet.getRange(1, 1, 1, oldHeaders.length).getValues()[0], oldHeaders);
  assert.equal(sheet.getRange(1, oldHeaders.length + 1, 1, 1).getValues()[0][0], '');
  assert.deepEqual(sheet.getRange(2, 1, 1, oldHeaders.length).getValues()[0], preservedRow);
});

test('doPost reports lock timeout without attempting to release an unacquired lock', () => {
  const h = makeHarness();
  const user = h.signup('lock-timeout@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Ожидание блокировки' }).data;
  h.resetLockStats();
  h.failNextLockWait();
  const response = h.call({
    action: 'rpc', token: user.token, name: 'get_table_revision',
    params: { p_table: 'transactions', p_family_id: family.id }
  });
  assert.ok(response.error);
  assert.match(response.error.message, /Injected lock timeout/);
  assert.deepEqual(h.lockStats(), { acquires: 1, releases: 0 });
});

test('partial non-contiguous update publishes a revision after the first range commits', () => {
  const h = makeHarness();
  const user = h.signup('partial-update-revision@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Частичное обновление' }).data;
  const inserted = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert', returning: true,
    values: [1, 2, 3].map(n => ({
      family_id: family.id, type: 'expense', amount_kopecks: 1000 + n,
      operation_date: '2026-11-10', description: 'initial-' + n
    }))
  });
  assert.equal(inserted.error, null, inserted.error?.message);
  const ids = inserted.data.map(row => row.id);
  const revision = () => h.call({
    action: 'rpc', token: user.token, name: 'get_table_revision',
    params: { p_table: 'transactions', p_family_id: family.id }
  });
  const before = revision();
  h.resetLockStats();
  h.failSetValuesAfter(2);
  const update = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'update',
    filters: [{ column: 'id', op: 'in', values: [ids[0], ids[2]] }],
    values: { description: 'updated' }
  });
  assert.ok(update.error);
  assert.match(update.error.message, /Injected setValues failure/);
  assert.deepEqual(h.lockStats(), { acquires: 1, releases: 1 });
  const after = revision();
  assert.notEqual(after.data, before.data);
  const rows = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data;
  assert.equal(rows.find(row => row.id === ids[0]).description, 'updated');
  assert.equal(rows.find(row => row.id === ids[2]).description, 'initial-3');
});

test('partial non-contiguous delete publishes a revision after the first range commits', () => {
  const h = makeHarness();
  const user = h.signup('partial-delete-revision@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Частичное удаление' }).data;
  const inserted = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert', returning: true,
    values: [1, 2, 3].map(n => ({
      family_id: family.id, type: 'expense', amount_kopecks: 2000 + n,
      operation_date: '2026-11-10', description: 'delete-' + n
    }))
  });
  assert.equal(inserted.error, null, inserted.error?.message);
  const ids = inserted.data.map(row => row.id);
  const revision = () => h.call({
    action: 'rpc', token: user.token, name: 'get_table_revision',
    params: { p_table: 'transactions', p_family_id: family.id }
  });
  const before = revision();
  h.failDeleteRowsAfter(2);
  const deleted = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'delete',
    filters: [{ column: 'id', op: 'in', values: [ids[0], ids[2]] }]
  });
  assert.ok(deleted.error);
  assert.match(deleted.error.message, /Injected deleteRows failure/);
  const after = revision();
  assert.notEqual(after.data, before.data);
  const rows = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data;
  assert.ok(rows.some(row => row.id === ids[0]));
  assert.ok(rows.some(row => row.id === ids[1]));
  assert.ok(!rows.some(row => row.id === ids[2]));
});

test('table revisions are isolated by family and reject cross-family reads', () => {
  const h = makeHarness();
  const userA = h.signup('revision-family-a@example.com');
  const userB = h.signup('revision-family-b@example.com');
  const familyA = h.call({ action: 'createFamily', token: userA.token, name: 'Семья A' }).data;
  const familyB = h.call({ action: 'createFamily', token: userB.token, name: 'Семья B' }).data;
  const read = (token, familyId) => h.call({
    action: 'rpc', token, name: 'get_table_revision',
    params: { p_table: 'transactions', p_family_id: familyId }
  });
  const beforeA = read(userA.token, familyA.id);
  const beforeB = read(userB.token, familyB.id);
  assert.equal(beforeA.error, null, beforeA.error?.message);
  assert.equal(beforeB.error, null, beforeB.error?.message);
  const denied = read(userA.token, familyB.id);
  assert.ok(denied.error);
  const insert = h.call({
    action: 'query', token: userA.token, table: 'transactions', mode: 'insert',
    values: { family_id: familyA.id, type: 'expense', amount_kopecks: 4500, operation_date: '2026-11-03' }
  });
  const afterA = read(userA.token, familyA.id);
  const afterB = read(userB.token, familyB.id);
  assert.equal(insert.error, null, insert.error?.message);
  assert.equal(afterA.error, null, afterA.error?.message);
  assert.equal(afterB.error, null, afterB.error?.message);
  assert.notEqual(afterA.data, beforeA.data);
  assert.equal(afterB.data, beforeB.data);
});

test('goal contribution writes refresh the owning family goals revision', () => {
  const h = makeHarness();
  const user = h.signup('revision-goal-contribution@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Ревизия целей' }).data;
  const goal = h.call({
    action: 'query', token: user.token, table: 'goals', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Резерв', target_kopecks: 100000, status: 'active' }
  });
  assert.equal(goal.error, null, goal.error?.message);
  const read = () => h.call({
    action: 'rpc', token: user.token, name: 'get_table_revision',
    params: { p_table: 'goals', p_family_id: family.id }
  });
  const before = read();
  const contribution = h.call({
    action: 'query', token: user.token, table: 'goal_contributions', mode: 'insert',
    values: { goal_id: goal.data[0].id, amount_kopecks: 2500, contribution_date: '2026-11-10' }
  });
  const after = read();
  assert.equal(contribution.error, null, contribution.error?.message);
  assert.equal(after.error, null, after.error?.message);
  assert.notEqual(after.data, before.data);
  const saved = h.call({ action: 'query', token: user.token, table: 'goals', mode: 'select' }).data[0];
  assert.equal(saved.saved_kopecks, 2500);
});

test('notification revisions are scoped to the authenticated user within a family', () => {
  const h = makeHarness();
  const owner = h.signup('revision-notif-owner@example.com');
  const partner = h.signup('revision-notif-partner@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Уведомления семьи' }).data;
  const joined = h.call({ action: 'joinFamily', token: partner.token, invite_code: family.invite_code });
  assert.equal(joined.error, null, joined.error?.message);
  const read = (token, userId) => h.call({
    action: 'rpc', token, name: 'get_table_revision',
    params: { p_table: 'notifications', p_family_id: family.id, p_user_id: userId }
  });
  const beforeOwner = read(owner.token, owner.user.id);
  const beforePartner = read(partner.token, partner.user.id);
  assert.equal(beforeOwner.error, null, beforeOwner.error?.message);
  assert.equal(beforePartner.error, null, beforePartner.error?.message);
  const denied = read(owner.token, partner.user.id);
  assert.ok(denied.error);
  const inserted = h.call({
    action: 'query', token: owner.token, table: 'notifications', mode: 'insert',
    values: { family_id: family.id, kind: 'test', title: 'Тест', body: 'Тест', read: false }
  });
  const afterOwner = read(owner.token, owner.user.id);
  const afterPartner = read(partner.token, partner.user.id);
  assert.equal(inserted.error, null, inserted.error?.message);
  assert.equal(afterOwner.error, null, afterOwner.error?.message);
  assert.equal(afterPartner.error, null, afterPartner.error?.message);
  assert.notEqual(afterOwner.data, beforeOwner.data);
  assert.equal(afterPartner.data, beforePartner.data);
});


test('recurring payments preserve the selected family participant when confirmed', () => {
  const h = makeHarness();
  const owner = h.signup('recurring-attribution-owner@example.com');
  const partner = h.signup('recurring-attribution-partner@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Ответственный за платёж' }).data;
  h.call({ action: 'joinFamily', token: partner.token, invite_code: family.invite_code });
  const created = h.call({
    action: 'query', token: owner.token, table: 'recurring_payments', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 150000, category_id: null, account_id: null, description: 'Аренда', start_date: '2026-11-03', next_due_date: '2026-11-03', frequency: 'monthly', remind: true, active: true, responsible_user_id: partner.user.id }
  });
  assert.equal(created.error, null, created.error?.message);
  const recurring = created.data[0];
  const confirmed = h.call({
    action: 'rpc', token: owner.token, name: 'confirm_recurring_payment',
    params: { p_recurring_id: recurring.id, p_expected_due_date: recurring.next_due_date, p_operation_date: '2026-11-03' }
  });
  assert.equal(confirmed.error, null, confirmed.error?.message);
  const transaction = h.call({ action: 'query', token: owner.token, table: 'transactions', mode: 'select' }).data[0];
  assert.equal(transaction.created_by, owner.user.id);
  assert.equal(transaction.responsible_user_id, partner.user.id);
});


test('bounded monthly transaction reads avoid full-sheet reads on a large ledger', () => {
  const h = makeHarness();
  const user = h.signup('selective-read@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Выборочное чтение' }).data;
  const values = Array.from({ length: 250 }, (_, index) => ({
    family_id: family.id,
    type: 'expense',
    amount_kopecks: 1000 + index,
    operation_date: index < 240 ? '2026-10-15' : '2026-11-03',
    description: 'Операция ' + index,
    planned: false,
  }));
  const inserted = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'insert', values });
  assert.equal(inserted.error, null, inserted.error?.message);

  const sheet = h.context.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('transactions');
  let fullSheetReads = 0;
  let dataRowRanges = 0;
  const originalGetDataRange = sheet.getDataRange.bind(sheet);
  const originalGetRange = sheet.getRange.bind(sheet);
  sheet.getDataRange = (...args) => { fullSheetReads++; return originalGetDataRange(...args); };
  sheet.getRange = (...args) => { if (args[0] >= 2) dataRowRanges++; return originalGetRange(...args); };

  const selected = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'select',
    filters: [
      { column: 'family_id', op: 'eq', value: family.id },
      { column: 'operation_date', op: 'gte', value: '2026-11-01' },
      { column: 'operation_date', op: 'lte', value: '2026-11-30' },
    ],
    orders: [{ column: 'operation_date', ascending: false }],
  });
  assert.equal(selected.error, null, selected.error?.message);
  assert.equal(selected.data.length, 10);
  assert.equal(selected.data.every(row => row.operation_date === '2026-11-03'), true);
  assert.equal(fullSheetReads, 0);
  assert.equal(dataRowRanges, 2);
});


test('request lock classifier marks only explicit read paths as read candidates', () => {
  const h = makeHarness();
  const classify = h.context.requestLockMode_;
  const readCases = [
    { action: 'getSession' },
    { action: 'getUser' },
    { action: 'query', table: 'transactions', mode: 'select' },
    { action: 'query', table: 'transactions' },
    { action: 'rpc', name: 'get_table_revision' },
    { action: 'rpc', name: 'get_telegram_link_status' },
    { action: 'rpc', name: 'get_my_context' },
  ];
  for (const request of readCases) {
    assert.equal(classify(request), 'read-candidate', JSON.stringify(request));
  }
});

test('request lock classifier keeps mutations and unknown actions fail-closed', () => {
  const h = makeHarness();
  const classify = h.context.requestLockMode_;
  const writeCases = [
    null,
    undefined,
    {},
    { action: 'signup' },
    { action: 'signin' },
    { action: 'signout' },
    { action: 'telegramWebhook' },
    { action: 'ensureProfile' },
    { action: 'createFamily' },
    { action: 'joinFamily' },
    { action: 'query', table: 'transactions', mode: 'insert' },
    { action: 'query', table: 'transactions', mode: 'update' },
    { action: 'query', table: 'transactions', mode: 'delete' },
    { action: 'query', table: 'transactions', mode: 'upsert' },
    { action: 'rpc', name: 'confirm_recurring_payment' },
    { action: 'rpc', name: 'unknown_rpc' },
    { action: 'unknown_action' },
  ];
  for (const request of writeCases) {
    assert.equal(classify(request), 'write', JSON.stringify(request));
  }
});

test('request lock classifier treats mixed or malformed batches as writes', () => {
  const h = makeHarness();
  const classify = h.context.requestLockMode_;
  assert.equal(classify({ action: 'batch', requests: [
    { action: 'query', table: 'transactions', mode: 'select' },
    { action: 'rpc', name: 'get_my_context' },
  ]}), 'read-candidate');
  assert.equal(classify({ action: 'batch', requests: [
    { action: 'query', table: 'transactions', mode: 'select' },
    { action: 'query', table: 'transactions', mode: 'insert' },
  ]}), 'write');
  assert.equal(classify({ action: 'batch', requests: [] }), 'write');
  assert.equal(classify({ action: 'batch', requests: 'not-an-array' }), 'write');
  assert.equal(classify({ action: 'batch', requests: [
    { action: 'query', table: 'transactions', mode: 'select' },
    { action: 'unrecognized' },
  ]}), 'write');
});


test('baseline: a read-only query currently acquires and releases the global ScriptLock', () => {
  const h = makeHarness();
  seedTable(h, 'transactions');
  const user = h.signup('lock-baseline@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Baseline блокировки' }).data;
  assert.ok(family?.id);
  h.resetLockStats();

  const selected = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' });
  assert.equal(selected.error, null, selected.error?.message);
  assert.deepEqual(h.lockStats(), { acquires: 1, releases: 1 });
});


test('all monetary fields reject coercible strings, booleans and fractional kopecks across insert, update and upsert', () => {
  const h = makeHarness();
  const user = h.signup('strict-money@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Строгие денежные поля' }).data;
  const goalResult = h.call({
    action: 'query', token: user.token, table: 'goals', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Цель для теста', target_kopecks: 50000 }
  });
  assert.equal(goalResult.error, null, goalResult.error?.message);
  const goalId = goalResult.data[0].id;

  const cases = [
    ['accounts', 'starting_balance_kopecks', { family_id: family.id, name: 'Наличные', kind: 'cash', starting_balance_kopecks: 123 }],
    ['transactions', 'amount_kopecks', { family_id: family.id, type: 'expense', amount_kopecks: 123, operation_date: '2026-11-10' }],
    ['recurring_payments', 'amount_kopecks', { family_id: family.id, type: 'expense', amount_kopecks: 123, description: 'Платёж', start_date: '2026-11-10', next_due_date: '2026-11-10', frequency: 'monthly', active: true }],
    ['budgets', 'limit_kopecks', { family_id: family.id, category_id: null, month_date: '2026-11-01', limit_kopecks: 123 }],
    ['goals', 'target_kopecks', { family_id: family.id, name: 'Вторая цель', target_kopecks: 123 }],
    ['goal_contributions', 'amount_kopecks', { goal_id: goalId, amount_kopecks: 123, contribution_date: '2026-11-10' }],
    ['planned_purchases', 'estimated_kopecks', { family_id: family.id, name: 'Покупка', estimated_kopecks: 123, status: 'planned' }],
    ['monthly_plans', 'planned_kopecks', { family_id: family.id, month_date: '2026-11-01', type: 'expense', planned_kopecks: 123 }],
  ];

  for (const [table, field, base] of cases) {
    const invalidInsert = h.call({
      action: 'query', token: user.token, table, mode: 'insert',
      values: { ...base, [field]: '123' },
    });
    assert.match(invalidInsert.error?.message || '', /целым числом копеек/, table + ' insert must reject numeric strings');

    const created = h.call({
      action: 'query', token: user.token, table, mode: 'insert', returning: true, values: base,
    });
    assert.equal(created.error, null, table + ' valid insert: ' + created.error?.message);
    const row = created.data[0];

    const invalidUpdate = h.call({
      action: 'query', token: user.token, table, mode: 'update',
      filters: [{ column: 'id', op: 'eq', value: row.id }],
      values: { [field]: true },
    });
    assert.match(invalidUpdate.error?.message || '', /целым числом копеек/, table + ' update must reject booleans');

    const upsertRow = { ...row, [field]: 1.5 };
    delete upsertRow.saved_kopecks;
    const invalidUpsert = h.call({
      action: 'query', token: user.token, table, mode: 'upsert',
      onConflict: 'id', values: upsertRow,
    });
    assert.match(invalidUpsert.error?.message || '', /целым числом копеек/, table + ' upsert must reject fractional kopecks');

    const after = h.call({ action: 'query', token: user.token, table, mode: 'select' });
    assert.equal(after.error, null, table + ' select after rejected writes');
    assert.equal(after.data.some(item => item.id === row.id && item[field] === 123), true, table + ' invalid writes must not alter stored value');
  }
});

test('kopecks validator rejects empty, null, non-finite, fractional and invalid-sign values', () => {
  const h = makeHarness();
  const validate = h.context.assertKopecks_;
  for (const value of ['123', '', null, true, NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validate(value, 'Сумма', { positive: true }), /целым числом копеек/, String(value));
  }
  assert.throws(() => validate(0, 'Сумма', { positive: true }), /положительным целым числом копеек/);
  assert.throws(() => validate(-1, 'Сумма', { positive: true }), /положительным целым числом копеек/);
  assert.doesNotThrow(() => validate(-1, 'Начальный остаток'));
  assert.doesNotThrow(() => validate(0, 'Начальный остаток'));
  assert.doesNotThrow(() => validate(undefined, 'Начальный остаток', { optional: true }));
  assert.throws(() => validate(null, 'Начальный остаток', { optional: true }), /целым числом копеек/);
});
test('monetary fields reject integers outside the JavaScript safe integer range', () => {
  const h = makeHarness();
  const user = h.signup('unsafe-money@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Границы копеек' }).data;
  const result = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert',
    values: { family_id: family.id, type: 'expense', amount_kopecks: Number.MAX_SAFE_INTEGER + 1, operation_date: '2026-11-10' },
  });
  assert.match(result.error?.message || '', /целым числом копеек/);
});

test('create_goal_with_purchase rejects numeric strings for target kopecks', () => {
  const h = makeHarness();
  seedTable(h, 'goals');
  const user = h.signup('strict-goal-rpc@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Строгий RPC' }).data;
  const result = h.call({
    action: 'rpc', token: user.token, name: 'create_goal_with_purchase',
    params: { p_family_id: family.id, p_name: 'Цель', p_target_kopecks: '10000', p_priority: 3, p_create_purchase: false },
  });
  assert.match(result.error?.message || '', /целым числом копеек/);
  const goals = h.call({ action: 'query', token: user.token, table: 'goals', mode: 'select' });
  assert.equal(goals.data.length, 0);
});


test('batch requests enforce the same strict kopecks validation as direct query requests', () => {
  const h = makeHarness();
  seedTable(h, 'transactions');
  seedTable(h, 'monthly_plans');
  const user = h.signup('strict-money-batch@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Денежный batch' }).data;
  const result = h.call({
    action: 'batch', token: user.token,
    requests: [
      { action: 'query', table: 'transactions', mode: 'insert', values: {
        family_id: family.id, type: 'expense', amount_kopecks: '2500', operation_date: '2026-11-10',
      }},
      { action: 'query', table: 'monthly_plans', mode: 'insert', values: {
        family_id: family.id, month_date: '2026-11-01', type: 'expense', planned_kopecks: 2500.5,
      }},
    ],
  });
  assert.equal(result.error, null, result.error?.message);
  assert.match(result.data[0].error?.message || '', /целым числом копеек/);
  assert.match(result.data[1].error?.message || '', /целым числом копеек/);
  const transactions = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' });
  const plans = h.call({ action: 'query', token: user.token, table: 'monthly_plans', mode: 'select' });
  assert.equal(transactions.data.length, 0);
  assert.equal(plans.data.length, 0);
});


test('transaction and related financial records reject categories of the wrong kind', () => {
  const h = makeHarness();
  const user = h.signup('category-kind-owner@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Типы категорий' }).data;
  const categories = h.call({ action: 'query', token: user.token, table: 'categories', mode: 'select' }).data;
  const incomeCategory = categories.find(c => c.kind === 'income' && c.parent_id);
  const expenseCategory = categories.find(c => c.kind === 'expense' && c.parent_id);
  assert.ok(incomeCategory);
  assert.ok(expenseCategory);
  const accountA = h.call({
    action: 'query', token: user.token, table: 'accounts', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Счёт A', kind: 'bank', starting_balance_kopecks: 0 },
  }).data[0];
  const accountB = h.call({
    action: 'query', token: user.token, table: 'accounts', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Счёт B', kind: 'cash', starting_balance_kopecks: 0 },
  }).data[0];

  for (const [type, categoryId] of [
    ['expense', incomeCategory.id],
    ['income', expenseCategory.id],
    ['transfer', expenseCategory.id],
  ]) {
    const values = { family_id: family.id, type, amount_kopecks: 1000, category_id: categoryId, operation_date: '2026-11-10' };
    if (type === 'transfer') { values.account_id = accountA.id; values.to_account_id = accountB.id; }
    const rejected = h.call({
      action: 'query', token: user.token, table: 'transactions', mode: 'insert', values,
    });
    assert.match(rejected.error?.message || '', /Тип категории не соответствует типу операции/);
  }

  const validExpense = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 1000, category_id: expenseCategory.id, operation_date: '2026-11-10' },
  });
  assert.equal(validExpense.error, null, validExpense.error?.message);

  const invalidUpdate = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: validExpense.data[0].id }],
    values: { category_id: incomeCategory.id },
  });
  assert.match(invalidUpdate.error?.message || '', /Тип категории не соответствует типу операции/);

  const invalidUpsert = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'upsert',
    onConflict: 'id',
    values: { ...validExpense.data[0], category_id: incomeCategory.id },
  });
  assert.match(invalidUpsert.error?.message || '', /Тип категории не соответствует типу операции/);
});

test('category hierarchy, recurring payments, budgets, monthly plans and planned purchases enforce category kinds', () => {
  const h = makeHarness();
  const user = h.signup('related-category-kind@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Связанные типы категорий' }).data;
  const categories = h.call({ action: 'query', token: user.token, table: 'categories', mode: 'select' }).data;
  const incomeRoot = categories.find(c => c.kind === 'income' && !c.parent_id);
  const incomeChild = categories.find(c => c.kind === 'income' && c.parent_id === incomeRoot.id);
  const expenseRoot = categories.find(c => c.kind === 'expense' && !c.parent_id);
  const expenseChild = categories.find(c => c.kind === 'expense' && c.parent_id === expenseRoot.id);
  assert.ok(incomeChild && expenseChild);

  const unknownCategoryKind = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'insert',
    values: { family_id: family.id, name: 'Категория с неизвестным типом', kind: 'other' },
  });
  assert.match(unknownCategoryKind.error?.message || '', /Неизвестный тип категории/);

  const unknownRecurringType = h.call({
    action: 'query', token: user.token, table: 'recurring_payments', mode: 'insert',
    values: { family_id: family.id, type: 'other', amount_kopecks: 1000, description: 'Платёж', start_date: '2026-11-10', next_due_date: '2026-11-10', frequency: 'monthly', active: true },
  });
  assert.match(unknownRecurringType.error?.message || '', /Неизвестный тип регулярного платежа/);

  const wrongChild = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'insert',
    values: { family_id: family.id, parent_id: incomeRoot.id, name: 'Неверная подкатегория', kind: 'expense' },
  });
  assert.match(wrongChild.error?.message || '', /Тип подкатегории должен совпадать/);

  const wrongParentEdit = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: incomeRoot.id }],
    values: { kind: 'expense' },
  });
  assert.match(wrongParentEdit.error?.message || '', /Нельзя менять тип категории/);

  const wrongRecurring = h.call({
    action: 'query', token: user.token, table: 'recurring_payments', mode: 'insert',
    values: { family_id: family.id, type: 'expense', amount_kopecks: 1000, category_id: incomeChild.id, description: 'Платёж', start_date: '2026-11-10', next_due_date: '2026-11-10', frequency: 'monthly', active: true },
  });
  assert.match(wrongRecurring.error?.message || '', /Тип категории не соответствует типу регулярного платежа/);

  const wrongBudget = h.call({
    action: 'query', token: user.token, table: 'budgets', mode: 'insert',
    values: { family_id: family.id, category_id: incomeChild.id, month_date: '2026-11-01', limit_kopecks: 1000 },
  });
  assert.match(wrongBudget.error?.message || '', /только категории расходов/);

  const wrongIncomePlan = h.call({
    action: 'query', token: user.token, table: 'monthly_plans', mode: 'insert',
    values: { family_id: family.id, month_date: '2026-11-01', category_id: expenseChild.id, type: 'income', planned_kopecks: 1000 },
  });
  assert.match(wrongIncomePlan.error?.message || '', /Тип категории не соответствует типу месячного плана/);

  const validSavingsPlan = h.call({
    action: 'query', token: user.token, table: 'monthly_plans', mode: 'insert',
    values: { family_id: family.id, month_date: '2026-11-01', category_id: expenseChild.id, type: 'savings', planned_kopecks: 1000 },
  });
  assert.equal(validSavingsPlan.error, null, validSavingsPlan.error?.message);

  const wrongPurchase = h.call({
    action: 'query', token: user.token, table: 'planned_purchases', mode: 'insert',
    values: { family_id: family.id, name: 'Покупка', estimated_kopecks: 1000, category_id: incomeChild.id, status: 'planned' },
  });
  assert.match(wrongPurchase.error?.message || '', /только к категории расходов/);
});


test('legacy category mismatches do not block unrelated edits to historical records', () => {
  const h = makeHarness();
  const user = h.signup('legacy-category-edit@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Старые категории' }).data;
  const categories = h.call({ action: 'query', token: user.token, table: 'categories', mode: 'select' }).data;
  const incomeCategory = categories.find(c => c.kind === 'income' && c.parent_id);
  const expenseCategory = categories.find(c => c.kind === 'expense' && c.parent_id);
  const created = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 1000, category_id: expenseCategory.id, operation_date: '2026-11-10' },
  });
  assert.equal(created.error, null, created.error?.message);

  const stored = h.context.rows_('transactions').find(row => row.id === created.data[0].id);
  stored.category_id = incomeCategory.id; // Simulate a historical mismatch from before server validation.
  h.context.updateRows_('transactions', [stored]);

  const unrelatedEdit = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: stored.id }],
    values: { description: 'Историческая запись' },
  });
  assert.equal(unrelatedEdit.error, null, unrelatedEdit.error?.message);
  const after = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data[0];
  assert.equal(after.category_id, incomeCategory.id);
  assert.equal(after.description, 'Историческая запись');
});


test('archived accounts cannot be assigned to new transactions or recurring payments', () => {
  const h = makeHarness();
  const user = h.signup('archived-account-assignment@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Архивные счета' }).data;
  const createAccount = name => h.call({
    action: 'query', token: user.token, table: 'accounts', mode: 'insert', returning: true,
    values: { family_id: family.id, name, kind: 'bank', starting_balance_kopecks: 0, archived: false },
  }).data[0];
  const source = createAccount('Архивный источник');
  const active = createAccount('Активный счёт');
  const destination = createAccount('Архивное назначение');
  const existingTransaction = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 1000, operation_date: '2026-11-10', account_id: source.id },
  }).data[0];
  const existingRecurring = h.call({
    action: 'query', token: user.token, table: 'recurring_payments', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 1000, account_id: source.id, description: 'Регулярный', start_date: '2026-11-10', next_due_date: '2026-11-10', frequency: 'monthly', active: true },
  }).data[0];
  for (const account of [source, destination]) {
    const archived = h.call({
      action: 'query', token: user.token, table: 'accounts', mode: 'update',
      filters: [{ column: 'id', op: 'eq', value: account.id }], values: { archived: true },
    });
    assert.equal(archived.error, null, archived.error?.message);
  }
  const updateTransaction = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: existingTransaction.id }], values: { description: 'Историческая операция' },
  });
  const updateRecurring = h.call({
    action: 'query', token: user.token, table: 'recurring_payments', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: existingRecurring.id }], values: { description: 'Исторический платёж' },
  });
  assert.equal(updateTransaction.error, null, updateTransaction.error?.message);
  assert.equal(updateRecurring.error, null, updateRecurring.error?.message);
  const rejected = [
    ['transactions', { family_id: family.id, type: 'expense', amount_kopecks: 2000, operation_date: '2026-11-11', account_id: source.id }],
    ['recurring_payments', { family_id: family.id, type: 'expense', amount_kopecks: 2000, account_id: source.id, description: 'Новый', start_date: '2026-11-11', next_due_date: '2026-11-11', frequency: 'monthly', active: true }],
    ['transactions', { family_id: family.id, type: 'transfer', amount_kopecks: 2000, operation_date: '2026-11-11', account_id: source.id, to_account_id: active.id }],
    ['transactions', { family_id: family.id, type: 'transfer', amount_kopecks: 2000, operation_date: '2026-11-11', account_id: active.id, to_account_id: destination.id }],
  ];
  for (const [table, values] of rejected) {
    const result = h.call({ action: 'query', token: user.token, table, mode: 'insert', values });
    assert.match(result.error?.message || '', /архивный счёт/ , table);
  }
});
test('archived categories cannot be assigned to new records but remain valid on existing records', () => {
  const h = makeHarness();
  const user = h.signup('archived-category-assignment@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Архивные категории' }).data;
  const root = h.call({ action: 'query', token: user.token, table: 'categories', mode: 'select' }).data
    .find(category => category.kind === 'expense' && !category.parent_id);
  const category = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'insert', returning: true,
    values: { family_id: family.id, parent_id: root.id, name: 'Архивная категория', kind: 'expense' },
  }).data[0];
  const created = {};
  created.transaction = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 1000, operation_date: '2026-11-10', category_id: category.id },
  }).data[0];
  created.recurring = h.call({
    action: 'query', token: user.token, table: 'recurring_payments', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 1000, category_id: category.id, description: 'Регулярный', start_date: '2026-11-10', next_due_date: '2026-11-10', frequency: 'monthly', active: true },
  }).data[0];
  created.budget = h.call({
    action: 'query', token: user.token, table: 'budgets', mode: 'insert', returning: true,
    values: { family_id: family.id, category_id: category.id, month_date: '2026-11-01', limit_kopecks: 10000 },
  }).data[0];
  created.plan = h.call({
    action: 'query', token: user.token, table: 'monthly_plans', mode: 'insert', returning: true,
    values: { family_id: family.id, category_id: category.id, month_date: '2026-11-01', type: 'expense', planned_kopecks: 10000 },
  }).data[0];
  created.purchase = h.call({
    action: 'query', token: user.token, table: 'planned_purchases', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Покупка', category_id: category.id, estimated_kopecks: 10000, status: 'planned' },
  }).data[0];
  const archived = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: category.id }], values: { archived: true },
  });
  assert.equal(archived.error, null, archived.error?.message);
  for (const [table, id, values] of [
    ['transactions', created.transaction.id, { description: 'Обновлено' }],
    ['recurring_payments', created.recurring.id, { description: 'Обновлено' }],
    ['budgets', created.budget.id, { limit_kopecks: 12000 }],
    ['monthly_plans', created.plan.id, { note: 'Обновлено' }],
    ['planned_purchases', created.purchase.id, { comment: 'Обновлено' }],
  ]) {
    const updated = h.call({
      action: 'query', token: user.token, table, mode: 'update',
      filters: [{ column: 'id', op: 'eq', value: id }], values,
    });
    assert.equal(updated.error, null, table + ' existing archived reference: ' + updated.error?.message);
  }
  const rejected = [
    ['transactions', { family_id: family.id, type: 'expense', amount_kopecks: 2000, operation_date: '2026-11-11', category_id: category.id }],
    ['recurring_payments', { family_id: family.id, type: 'expense', amount_kopecks: 2000, category_id: category.id, description: 'Новый', start_date: '2026-11-11', next_due_date: '2026-11-11', frequency: 'monthly', active: true }],
    ['budgets', { family_id: family.id, category_id: category.id, month_date: '2026-12-01', limit_kopecks: 20000 }],
    ['monthly_plans', { family_id: family.id, category_id: category.id, month_date: '2026-12-01', type: 'expense', planned_kopecks: 20000 }],
    ['planned_purchases', { family_id: family.id, name: 'Новая покупка', category_id: category.id, estimated_kopecks: 20000, status: 'planned' }],
  ];
  for (const [table, values] of rejected) {
    const result = h.call({ action: 'query', token: user.token, table, mode: 'insert', values });
    assert.match(result.error?.message || '', /архивную категорию/ , table);
  }
});
test('categories with references cannot be deleted, but can be archived', () => {
  const h = makeHarness();
  const user = h.signup('category-delete-guard@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Защита категорий' }).data;
  const root = h.call({ action: 'query', token: user.token, table: 'categories', mode: 'select' }).data
    .find(c => c.kind === 'expense' && !c.parent_id);
  const referenceCases = [
    ['transactions', { type: 'expense', amount_kopecks: 1000, operation_date: '2026-11-10' }],
    ['recurring_payments', { type: 'expense', amount_kopecks: 1000, description: 'Платёж', start_date: '2026-11-10', next_due_date: '2026-11-10', frequency: 'monthly', active: true }],
    ['budgets', { month_date: '2026-11-01', limit_kopecks: 1000 }],
    ['planned_purchases', { name: 'Покупка', estimated_kopecks: 1000, status: 'planned' }],
    ['monthly_plans', { month_date: '2026-11-01', type: 'expense', planned_kopecks: 1000 }],
  ];

  for (const [table, fields] of referenceCases) {
    const category = h.call({
      action: 'query', token: user.token, table: 'categories', mode: 'insert', returning: true,
      values: { family_id: family.id, parent_id: root.id, name: 'Категория ' + table, kind: 'expense' },
    });
    assert.equal(category.error, null, category.error?.message);
    const values = { ...fields, category_id: category.data[0].id };
    if (table !== 'goal_contributions') values.family_id = family.id;
    const inserted = h.call({ action: 'query', token: user.token, table, mode: 'insert', values });
    assert.equal(inserted.error, null, table + ' reference: ' + inserted.error?.message);

    const deleted = h.call({
      action: 'query', token: user.token, table: 'categories', mode: 'delete',
      filters: [{ column: 'id', op: 'eq', value: category.data[0].id }],
    });
    assert.match(deleted.error?.message || '', /Категория используется в связанных данных/);

    const archived = h.call({
      action: 'query', token: user.token, table: 'categories', mode: 'update',
      filters: [{ column: 'id', op: 'eq', value: category.data[0].id }],
      values: { archived: true },
    });
    assert.equal(archived.error, null, archived.error?.message);
  }

  const parentWithChild = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'insert', returning: true,
    values: { family_id: family.id, parent_id: root.id, name: 'Родитель с ребёнком', kind: 'expense' },
  }).data[0];
  const child = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'insert',
    values: { family_id: family.id, parent_id: parentWithChild.id, name: 'Дочерняя', kind: 'expense' },
  });
  assert.equal(child.error, null, child.error?.message);
  const parentDelete = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'delete',
    filters: [{ column: 'id', op: 'eq', value: parentWithChild.id }],
  });
  assert.match(parentDelete.error?.message || '', /Категория используется в связанных данных/);

  const unused = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'insert', returning: true,
    values: { family_id: family.id, parent_id: root.id, name: 'Неиспользуемая', kind: 'expense' },
  }).data[0];
  const safeDelete = h.call({
    action: 'query', token: user.token, table: 'categories', mode: 'delete',
    filters: [{ column: 'id', op: 'eq', value: unused.id }],
  });
  assert.equal(safeDelete.error, null, safeDelete.error?.message);
});


test('transaction inserts are idempotent for the same ID and exact payload', () => {
  const h = makeHarness();
  const owner = h.signup('transaction-idempotency-owner@example.com');
  const partner = h.signup('transaction-idempotency-partner@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Идемпотентные операции' }).data;
  h.call({ action: 'joinFamily', token: partner.token, invite_code: family.invite_code });
  const payload = {
    id: 'tx-idempotency-stable-001',
    family_id: family.id,
    type: 'expense',
    amount_kopecks: 4500,
    operation_date: '2026-11-10',
    operation_time: null,
    category_id: null,
    account_id: null,
    to_account_id: null,
    description: 'Проезд',
    responsible_user_id: owner.user.id,
    planned: false,
    parent_recurring_id: null,
  };
  const first = h.call({
    action: 'query', token: owner.token, table: 'transactions', mode: 'insert', returning: true, values: payload,
  });
  assert.equal(first.error, null, first.error?.message);
  const retry = h.call({
    action: 'query', token: owner.token, table: 'transactions', mode: 'insert', returning: true, values: payload,
  });
  assert.equal(retry.error, null, retry.error?.message);
  assert.equal(retry.data[0].id, first.data[0].id);
  assert.equal(retry.data[0].created_at, first.data[0].created_at);

  const changedPayload = h.call({
    action: 'query', token: owner.token, table: 'transactions', mode: 'insert',
    values: { ...payload, amount_kopecks: 4600 },
  });
  assert.match(changedPayload.error?.message || '', /таким ID уже существует|другие данные/);

  const differentAuthor = h.call({
    action: 'query', token: partner.token, table: 'transactions', mode: 'insert',
    values: payload,
  });
  assert.match(differentAuthor.error?.message || '', /таким ID уже существует|другие данные/);

  const separateLegitimateTransaction = h.call({
    action: 'query', token: owner.token, table: 'transactions', mode: 'insert',
    values: { ...payload, id: 'tx-idempotency-stable-002' },
  });
  assert.equal(separateLegitimateTransaction.error, null, separateLegitimateTransaction.error?.message);

  const all = h.call({ action: 'query', token: owner.token, table: 'transactions', mode: 'select' });
  assert.equal(all.data.length, 2);
});


test('Telegram retry after a transaction write but before update cache does not duplicate the operation', () => {
  const h = makeHarness();
  const user = h.signup('telegram-crash-window@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Повтор webhook' }).data;
  h.context.PropertiesService.getScriptProperties().setProperty('TELEGRAM_BACKEND_SECRET', 'crash-window-secret-0123456789abcdef');
  const generated = h.call({ action: 'rpc', token: user.token, name: 'create_telegram_link_code' });
  assert.equal(generated.error, null, generated.error?.message);
  const linked = h.call({
    action: 'telegramWebhook', telegramSecret: 'crash-window-secret-0123456789abcdef',
    update: { update_id: 7401, message: { chat: { id: 740, type: 'private' }, from: { id: 740 }, text: '/link ' + generated.data.code } },
  });
  assert.equal(linked.error, null, linked.error?.message);

  const props = h.context.PropertiesService.getScriptProperties();
  const originalSetProperty = props.setProperty;
  const originalGetScriptProperties = h.context.PropertiesService.getScriptProperties;
  h.context.PropertiesService.getScriptProperties = () => props;
  let failCacheWrite = true;
  props.setProperty = (key, value) => {
    if (key === 'telegram:update:7402' && failCacheWrite) {
      failCacheWrite = false;
      throw new Error('simulated crash before update cache');
    }
    return originalSetProperty(key, value);
  };
  const update = {
    update_id: 7402,
    message: {
      date: 1794312000,
      chat: { id: 740, type: 'private' },
      from: { id: 740 },
      text: 'Проезд 45 рублей',
    },
  };
  const firstAttempt = h.call({ action: 'telegramWebhook', telegramSecret: 'crash-window-secret-0123456789abcdef', update });
  assert.equal(firstAttempt.error, null, firstAttempt.error?.message);
  assert.match(firstAttempt.data.text, /Записал расход/);
  props.setProperty = originalSetProperty;
  h.context.PropertiesService.getScriptProperties = originalGetScriptProperties;

  const retry = h.call({ action: 'telegramWebhook', telegramSecret: 'crash-window-secret-0123456789abcdef', update });
  assert.equal(retry.error, null, retry.error?.message);
  const transactions = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data;
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].id, 'telegram_7402');
  assert.equal(transactions[0].amount_kopecks, 4500);
  assert.equal(transactions[0].operation_time, '2026-11-10T12:00:00.000Z');
});


test('transaction idempotency lookup scans only the ID column, not the full ledger', () => {
  const h = makeHarness();
  const user = h.signup('transaction-id-lookup@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Быстрый поиск ID' }).data;
  const seed = Array.from({ length: 250 }, (_, index) => ({
    family_id: family.id, type: 'expense', amount_kopecks: 1000 + index,
    operation_date: '2026-11-10', description: 'Старая операция ' + index,
  }));
  const seeded = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'insert', values: seed });
  assert.equal(seeded.error, null, seeded.error?.message);

  const sheet = h.context.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('transactions');
  let fullSheetReads = 0;
  let idColumnReads = 0;
  const originalGetDataRange = sheet.getDataRange.bind(sheet);
  const originalGetRange = sheet.getRange.bind(sheet);
  sheet.getDataRange = (...args) => { fullSheetReads++; return originalGetDataRange(...args); };
  sheet.getRange = (...args) => {
    if (args[0] >= 2 && args[1] === 1 && args[3] === 1) idColumnReads++;
    return originalGetRange(...args);
  };

  const inserted = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert',
    values: {
      id: 'tx-fast-id-lookup', family_id: family.id, type: 'expense', amount_kopecks: 2500,
      operation_date: '2026-11-10', description: 'Новая операция', planned: false,
    },
  });
  assert.equal(inserted.error, null, inserted.error?.message);
  assert.equal(fullSheetReads, 0);
  assert.equal(idColumnReads, 1);
});


test('Telegram refuses to record transfers as expenses and accepts an income without a description', () => {
  const h = makeHarness();
  const user = h.signup('telegram-transfer-income@example.com');
  h.call({ action: 'createFamily', token: user.token, name: 'Без ошибочных переводов' });
  h.context.PropertiesService.getScriptProperties().setProperty('TELEGRAM_BACKEND_SECRET', 'transfer-income-secret-0123456789abcdef');
  const generated = h.call({ action: 'rpc', token: user.token, name: 'create_telegram_link_code' });
  assert.equal(generated.error, null, generated.error?.message);
  const linked = h.call({
    action: 'telegramWebhook', telegramSecret: 'transfer-income-secret-0123456789abcdef',
    update: { update_id: 7501, message: { chat: { id: 750, type: 'private' }, from: { id: 750 }, text: '/link ' + generated.data.code } },
  });
  assert.equal(linked.error, null, linked.error?.message);

  for (const [update_id, text] of [[7502, 'Перевод 500 рублей'], [7503, 'Перевёл 500 рублей']]) {
    const result = h.call({
      action: 'telegramWebhook', telegramSecret: 'transfer-income-secret-0123456789abcdef',
      update: { update_id, message: { chat: { id: 750, type: 'private' }, from: { id: 750 }, text } },
    });
    assert.match(result.error?.message || '', /переводы через Telegram пока не поддерживаются/i);
  }

  const unknown = h.call({
    action: 'telegramWebhook', telegramSecret: 'transfer-income-secret-0123456789abcdef',
    update: { update_id: 7505, message: { chat: { id: 750, type: 'private' }, from: { id: 750 }, text: 'Что-то непонятное 500 рублей' } },
  });
  assert.match(unknown.error?.message || '', /не понял, это расход или доход/i);

  const noAmount = h.call({
    action: 'telegramWebhook', telegramSecret: 'transfer-income-secret-0123456789abcdef',
    update: { update_id: 7509, message: { chat: { id: 750, type: 'private' }, from: { id: 750 }, text: 'Проезд' } },
  });
  assert.match(noAmount.error?.message || '', /не нашёл сумму/i);

  const income = h.call({
    action: 'telegramWebhook', telegramSecret: 'transfer-income-secret-0123456789abcdef',
    update: { update_id: 7504, message: { chat: { id: 750, type: 'private' }, from: { id: 750 }, text: 'Доход 5000 рублей' } },
  });
  assert.equal(income.error, null, income.error?.message);
  assert.match(income.data.text, /Записал доход: 5000,00 ₽ — Доход/);

  const transactions = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data;
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].type, 'income');
  assert.equal(transactions[0].amount_kopecks, 500000);
  assert.equal(transactions[0].description, 'Доход');

  const salary = h.call({
    action: 'telegramWebhook', telegramSecret: 'transfer-income-secret-0123456789abcdef',
    update: { update_id: 7507, message: { chat: { id: 750, type: 'private' }, from: { id: 750 }, text: 'Зарплата 5000 рублей' } },
  });
  assert.equal(salary.error, null, salary.error?.message);
  assert.match(salary.data.text, /Записал доход: 5000,00 ₽/);

  const salaryWithPrefix = h.call({
    action: 'telegramWebhook', telegramSecret: 'transfer-income-secret-0123456789abcdef',
    update: { update_id: 7508, message: { chat: { id: 750, type: 'private' }, from: { id: 750 }, text: 'Доход 5000 рублей зарплата' } },
  });
  assert.equal(salaryWithPrefix.error, null, salaryWithPrefix.error?.message);

  const arrived = h.call({
    action: 'telegramWebhook', telegramSecret: 'transfer-income-secret-0123456789abcdef',
    update: { update_id: 7510, message: { chat: { id: 750, type: 'private' }, from: { id: 750 }, text: 'Поступило 500 рублей' } },
  });
  assert.equal(arrived.error, null, arrived.error?.message);
  assert.match(arrived.data.text, /Записал доход: 500,00 ₽/);

  const expense = h.call({
    action: 'telegramWebhook', telegramSecret: 'transfer-income-secret-0123456789abcdef',
    update: { update_id: 7506, message: { chat: { id: 750, type: 'private' }, from: { id: 750 }, text: 'Потратил 500 рублей' } },
  });
  assert.equal(expense.error, null, expense.error?.message);
  const updatedTransactions = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data;
  assert.equal(updatedTransactions.length, 5);
  const savedSalary = updatedTransactions.filter(row => row.type === 'income' && row.amount_kopecks === 500000);
  assert.equal(savedSalary.length, 3);
  assert.ok(savedSalary.every(row => row.type === 'income'));
  assert.ok(savedSalary.some(row => /зарплата/i.test(row.description)));
  const savedExpense = updatedTransactions.find(row => row.type === 'expense');
  assert.equal(savedExpense.amount_kopecks, 50000);
  assert.equal(savedExpense.description, 'Расход');
});


test('Telegram balance excludes planned operations and transfers from realized totals', () => {
  const h = makeHarness();
  const user = h.signup('telegram-balance-planned@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Фактический баланс Telegram' }).data;
  h.context.PropertiesService.getScriptProperties().setProperty('TELEGRAM_BACKEND_SECRET', 'balance-planned-secret-0123456789abcdef');
  const generated = h.call({ action: 'rpc', token: user.token, name: 'create_telegram_link_code' });
  assert.equal(generated.error, null, generated.error?.message);
  const linked = h.call({
    action: 'telegramWebhook', telegramSecret: 'balance-planned-secret-0123456789abcdef',
    update: { update_id: 7601, message: { chat: { id: 760, type: 'private' }, from: { id: 760 }, text: '/link ' + generated.data.code } },
  });
  assert.equal(linked.error, null, linked.error?.message);

  const RealDate = Date;
  h.context.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : ['2026-10-31T21:30:00.000Z'])); }
  };
  const originalFormatDate = h.context.Utilities.formatDate;
  h.context.Utilities.formatDate = (date, timezone, pattern) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(date));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    if (pattern === 'yyyy-MM') return values.year + '-' + values.month;
    if (pattern === 'yyyy-MM-dd') return values.year + '-' + values.month + '-' + values.day;
    return originalFormatDate(date, timezone, pattern);
  };
  const operationDate = h.context.Utilities.formatDate(new h.context.Date(), 'Europe/Moscow', 'yyyy-MM-dd');
  assert.equal(operationDate, '2026-11-01', 'test date is Oct 31 UTC but Nov 1 in Moscow');
  const addAccount = name => h.call({
    action: 'query', token: user.token, table: 'accounts', mode: 'insert', returning: true,
    values: { family_id: family.id, name, kind: 'bank', starting_balance_kopecks: 0 },
  }).data[0];
  const from = addAccount('Счёт списания');
  const to = addAccount('Счёт зачисления');
  const rows = [
    { type: 'income', amount_kopecks: 100000, description: 'Фактический доход', planned: false },
    { type: 'expense', amount_kopecks: 25000, description: 'Фактический расход', planned: false },
    { type: 'income', amount_kopecks: 50000, description: 'Плановый доход', planned: true },
    { type: 'expense', amount_kopecks: 15000, description: 'Плановый расход', planned: true },
    { type: 'transfer', amount_kopecks: 10000, description: 'Перевод', account_id: from.id, to_account_id: to.id, planned: false },
  ];
  const inserted = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert',
    values: rows.map(row => ({ ...row, family_id: family.id, operation_date: operationDate })),
  });
  assert.equal(inserted.error, null, inserted.error?.message);

  const balance = h.call({
    action: 'telegramWebhook', telegramSecret: 'balance-planned-secret-0123456789abcdef',
    update: { update_id: 7602, message: { chat: { id: 760, type: 'private' }, from: { id: 760 }, text: '/balance' } },
  });
  assert.equal(balance.error, null, balance.error?.message);
  assert.match(balance.data.text, /Доходы: 1000,00 ₽/);
  assert.match(balance.data.text, /Расходы: 250,00 ₽/);
  assert.match(balance.data.text, /Разница: 750,00 ₽/);
});


test('category kind cannot change while the category is referenced by financial records', () => {
  const h = makeHarness();
  const user = h.signup('category-kind-change@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Тип используемой категории' }).data;
  const cases = [
    ['transactions', { type: 'expense', amount_kopecks: 1000, operation_date: '2026-11-10' }],
    ['recurring_payments', { type: 'expense', amount_kopecks: 1000, description: 'Платёж', start_date: '2026-11-10', next_due_date: '2026-11-10', frequency: 'monthly', active: true }],
    ['budgets', { month_date: '2026-11-01', limit_kopecks: 1000 }],
    ['monthly_plans', { month_date: '2026-11-01', type: 'expense', planned_kopecks: 1000 }],
    ['planned_purchases', { name: 'Покупка', estimated_kopecks: 1000, status: 'planned' }],
  ];

  for (const [table, fields] of cases) {
    const categoryResult = h.call({
      action: 'query', token: user.token, table: 'categories', mode: 'insert', returning: true,
      values: { family_id: family.id, name: 'Категория ' + table, kind: 'expense', parent_id: null },
    });
    assert.equal(categoryResult.error, null, table + ' category creation: ' + categoryResult.error?.message);
    const category = categoryResult.data[0];
    const row = h.call({
      action: 'query', token: user.token, table, mode: 'insert', returning: true,
      values: { family_id: family.id, category_id: category.id, ...fields },
    });
    assert.equal(row.error, null, table + ' reference creation: ' + row.error?.message);

    const changed = h.call({
      action: 'query', token: user.token, table: 'categories', mode: 'update',
      filters: [{ column: 'id', op: 'eq', value: category.id }],
      values: { kind: 'income' },
    });
    assert.match(changed.error?.message || '', /нельзя менять тип категории, пока она используется/i, table + ' must block category kind changes');

    const saved = h.call({
      action: 'query', token: user.token, table: 'categories', mode: 'select',
      filters: [{ column: 'id', op: 'eq', value: category.id }],
    });
    assert.equal(saved.data[0].kind, 'expense', table + ' failed category update must not mutate the category');
  }
});


test('cross-family isolation covers every family-scoped table through direct select, update and delete', () => {
  const h = makeHarness();
  const owner = h.signup('matrix-owner@example.com');
  const outsider = h.signup('matrix-outsider@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Изолированная семья' }).data;
  const fixtures = [
    ['categories', { id: 'iso-category', family_id: family.id, name: 'Личная категория' }, { name: 'Подмена' }],
    ['accounts', { id: 'iso-account', family_id: family.id, name: 'Личный счёт' }, { name: 'Подмена' }],
    ['transactions', { id: 'iso-transaction', family_id: family.id, type: 'expense', amount_kopecks: 100, operation_date: '2026-10-29', description: 'Личная операция' }, { description: 'Подмена' }],
    ['recurring_payments', { id: 'iso-recurring', family_id: family.id, description: 'Личный платёж' }, { description: 'Подмена' }],
    ['budgets', { id: 'iso-budget', family_id: family.id, limit_kopecks: 1000 }, { limit_kopecks: 2000 }],
    ['goals', { id: 'iso-goal', family_id: family.id, name: 'Личная цель' }, { name: 'Подмена' }],
    ['planned_purchases', { id: 'iso-purchase', family_id: family.id, name: 'Личная покупка' }, { name: 'Подмена' }],
    ['monthly_plans', { id: 'iso-monthly-plan', family_id: family.id, note: 'Личный план' }, { note: 'Подмена' }],
  ];

  fixtures.forEach(([table, row]) => h.context.appendRows_(table, [row]));

  fixtures.forEach(([table, row, patch]) => {
    const filters = [{ column: 'id', op: 'eq', value: row.id }];
    const outsiderRead = h.call({ action: 'query', token: outsider.token, table, mode: 'select', filters });
    assert.equal(outsiderRead.error, null, outsiderRead.error?.message);
    assert.equal(outsiderRead.data.length, 0, table + ' leaked a foreign row on select');

    const outsiderUpdate = h.call({ action: 'query', token: outsider.token, table, mode: 'update', filters, values: patch });
    assert.equal(outsiderUpdate.error, null, outsiderUpdate.error?.message);
    const outsiderDelete = h.call({ action: 'query', token: outsider.token, table, mode: 'delete', filters });
    assert.equal(outsiderDelete.error, null, outsiderDelete.error?.message);

    const ownerRead = h.call({ action: 'query', token: owner.token, table, mode: 'select', filters });
    assert.equal(ownerRead.error, null, ownerRead.error?.message);
    assert.equal(ownerRead.data.length, 1, table + ' row was changed or deleted by another family');
  });
});


test('family-scoped RPCs reject foreign family IDs and foreign purchase or recurring records', () => {
  const h = makeHarness();
  const owner = h.signup('rpc-boundary-owner@example.com');
  const outsider = h.signup('rpc-boundary-outsider@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Основная семья' }).data;
  const foreignFamily = h.call({ action: 'createFamily', token: outsider.token, name: 'Другая семья' }).data;

  const foreignCategoryProvisioning = h.call({
    action: 'rpc', token: outsider.token, name: 'ensure_supplemental_categories',
    params: { p_family_id: family.id },
  });
  assert.match(foreignCategoryProvisioning.error?.message || '', /Нет доступа к этой семье/);

  const foreignGoalCreation = h.call({
    action: 'rpc', token: outsider.token, name: 'create_goal_with_purchase',
    params: { p_family_id: family.id, p_name: 'Чужая цель', p_target_kopecks: 100000, p_priority: 2, p_create_purchase: true },
  });
  assert.match(foreignGoalCreation.error?.message || '', /Нет доступа к этой семье/);

  const purchase = h.call({
    action: 'query', token: owner.token, table: 'planned_purchases', mode: 'insert', returning: true,
    values: { family_id: family.id, name: 'Чужая покупка', estimated_kopecks: 200000, status: 'planned' },
  }).data[0];
  const purchaseConfirmation = h.call({
    action: 'rpc', token: outsider.token, name: 'confirm_planned_purchase',
    params: { p_purchase_id: purchase.id, p_operation_date: '2026-11-10' },
  });
  assert.match(purchaseConfirmation.error?.message || '', /не найдена/);

  const recurring = h.call({
    action: 'query', token: owner.token, table: 'recurring_payments', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 9900, description: 'Чужая подписка', start_date: '2026-11-01', next_due_date: '2026-11-10', frequency: 'monthly', active: true },
  }).data[0];
  const recurringConfirmation = h.call({
    action: 'rpc', token: outsider.token, name: 'confirm_recurring_payment',
    params: { p_recurring_id: recurring.id, p_expected_due_date: recurring.next_due_date, p_operation_date: '2026-11-10' },
  });
  assert.match(recurringConfirmation.error?.message || '', /не найден/);

  const ownerRows = h.call({ action: 'query', token: owner.token, table: 'planned_purchases', mode: 'select' }).data;
  assert.equal(ownerRows.find(x => x.id === purchase.id).status, 'planned');
  const recurringRows = h.call({ action: 'query', token: owner.token, table: 'recurring_payments', mode: 'select' }).data;
  assert.equal(recurringRows.find(x => x.id === recurring.id).next_due_date, '2026-11-10');
  assert.notEqual(foreignFamily.id, family.id);
});

test('get_my_context exposes profiles only for members of the current user family', () => {
  const h = makeHarness();
  const owner = h.signup('context-isolation-owner@example.com');
  const partner = h.signup('context-isolation-partner@example.com');
  const outsider = h.signup('context-isolation-outsider@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Контекст семьи' }).data;
  h.call({ action: 'joinFamily', token: partner.token, invite_code: family.invite_code });
  h.call({ action: 'createFamily', token: outsider.token, name: 'Отдельная семья' });

  const context = h.call({ action: 'rpc', token: owner.token, name: 'get_my_context', params: {} });
  assert.equal(context.error, null, context.error?.message);
  const profileIds = context.data.member_profiles.map(x => x.id);
  assert.deepEqual(profileIds.sort(), [owner.user.id, partner.user.id].sort());
  assert.equal(profileIds.includes(outsider.user.id), false);
  assert.equal(context.data.family.id, family.id);
});


test('Telegram parses fractional ruble amounts exactly and rejects unsupported precision', () => {
  const h = makeHarness();
  const user = h.signup('telegram-fractional-money@example.com');
  h.call({ action: 'createFamily', token: user.token, name: 'Дробные суммы Telegram' });
  h.context.PropertiesService.getScriptProperties().setProperty('TELEGRAM_BACKEND_SECRET', 'fractional-money-secret-0123456789abcdef');
  const generated = h.call({ action: 'rpc', token: user.token, name: 'create_telegram_link_code' });
  assert.equal(generated.error, null, generated.error?.message);
  const linked = h.call({
    action: 'telegramWebhook', telegramSecret: 'fractional-money-secret-0123456789abcdef',
    update: { update_id: 7801, message: { chat: { id: 780, type: 'private' }, from: { id: 780 }, text: '/link ' + generated.data.code } },
  });
  assert.equal(linked.error, null, linked.error?.message);

  for (const [update_id, message, expected] of [
    [7802, 'Проезд 45,1 рублей', 4510],
    [7803, 'Кофе 45.10 рублей', 4510],
    [7804, 'Покупка 0,01 ₽', 1],
  ]) {
    const result = h.call({
      action: 'telegramWebhook', telegramSecret: 'fractional-money-secret-0123456789abcdef',
      update: { update_id, message: { chat: { id: 780, type: 'private' }, from: { id: 780 }, text: message } },
    });
    assert.equal(result.error, null, result.error?.message);
    assert.match(result.data.text, /Записал расход:/);
    const txs = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data;
    assert.equal(txs.find(row => row.id === 'telegram_' + update_id)?.amount_kopecks, expected);
  }

  for (const [update_id, message] of [
    [7805, 'Покупка 45,123 рублей'],
    [7806, 'Покупка 45.123 рублей'],
    [7807, 'Покупка 0 рублей'],
    [7808, 'Покупка -45 рублей'],
  ]) {
    const result = h.call({
      action: 'telegramWebhook', telegramSecret: 'fractional-money-secret-0123456789abcdef',
      update: { update_id, message: { chat: { id: 780, type: 'private' }, from: { id: 780 }, text: message } },
    });
    assert.ok(result.error, message);
  }

  const txs = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data;
  assert.equal(txs.length, 3);
  assert.deepEqual(txs.map(row => row.amount_kopecks).sort((a,b) => a-b), [1, 4510, 4510]);
});


test('Telegram link retry remains successful if update cache write fails after the link is saved', () => {
  const h = makeHarness();
  const user = h.signup('telegram-link-retry@example.com');
  h.call({ action: 'createFamily', token: user.token, name: 'Повтор привязки' });
  const props = h.context.PropertiesService.getScriptProperties();
  props.setProperty('TELEGRAM_BACKEND_SECRET', 'test-backend-secret-0123456789abcdef01234567');
  const generated = h.call({ action: 'rpc', token: user.token, name: 'create_telegram_link_code' });
  assert.equal(generated.error, null, generated.error?.message);
  const update = { update_id: 7301, message: {
    chat: { id: 730, type: 'private' }, from: { id: 730 }, text: '/link ' + generated.data.code
  }};
  const originalSetProperty = props.setProperty.bind(props);
  h.context.PropertiesService.getScriptProperties = () => props;
  let failCacheWrite = true;
  props.setProperty = (key, value) => {
    if (key === 'telegram:update:7301' && failCacheWrite) {
      failCacheWrite = false;
      throw new Error('simulated update cache write failure');
    }
    return originalSetProperty(key, value);
  };

  const first = h.call({ action: 'telegramWebhook', telegramSecret: 'test-backend-secret-0123456789abcdef01234567', update });
  assert.equal(first.error, null, first.error?.message);
  assert.match(first.data.text, /успешно привязан/);
  assert.equal(h.context.rows_('telegram_links').filter(row => row.telegram_user_id === '730').length, 1);
  assert.ok(h.context.rows_('telegram_link_codes').find(row => row.code_hash === h.context.telegramCodeHash_(generated.data.code)).used_at);

  const retry = h.call({ action: 'telegramWebhook', telegramSecret: 'test-backend-secret-0123456789abcdef01234567', update });
  assert.equal(retry.error, null, retry.error?.message);
  assert.match(retry.data.text, /успешно привязан/);
  assert.equal(h.context.rows_('telegram_links').filter(row => row.telegram_user_id === '730').length, 1);
});

test('Telegram expense retry after update cache failure reuses the stable transaction ID', () => {
  const h = makeHarness();
  const user = h.signup('telegram-expense-retry@example.com');
  h.call({ action: 'createFamily', token: user.token, name: 'Повтор расхода' });
  const props = h.context.PropertiesService.getScriptProperties();
  props.setProperty('TELEGRAM_BACKEND_SECRET', 'test-backend-secret-0123456789abcdef01234567');
  const generated = h.call({ action: 'rpc', token: user.token, name: 'create_telegram_link_code' });
  assert.equal(generated.error, null, generated.error?.message);
  const link = h.call({
    action: 'telegramWebhook',
    telegramSecret: 'test-backend-secret-0123456789abcdef01234567',
    update: { update_id: 7401, message: { chat: { id: 740, type: 'private' }, from: { id: 740 }, text: '/link ' + generated.data.code } }
  });
  assert.equal(link.error, null, link.error?.message);

  const originalSetProperty = props.setProperty.bind(props);
  h.context.PropertiesService.getScriptProperties = () => props;
  let failCacheWrite = true;
  props.setProperty = (key, value) => {
    if (key === 'telegram:update:7402' && failCacheWrite) {
      failCacheWrite = false;
      throw new Error('simulated update cache write failure');
    }
    return originalSetProperty(key, value);
  };
  const update = { update_id: 7402, message: {
    chat: { id: 740, type: 'private' }, from: { id: 740 }, date: 1794380000, text: 'Проезд 45 рублей'
  }};
  const first = h.call({ action: 'telegramWebhook', telegramSecret: 'test-backend-secret-0123456789abcdef01234567', update });
  assert.equal(first.error, null, first.error?.message);
  assert.match(first.data.text, /45,00 ₽/);
  const retry = h.call({ action: 'telegramWebhook', telegramSecret: 'test-backend-secret-0123456789abcdef01234567', update });
  assert.equal(retry.error, null, retry.error?.message);
  assert.match(retry.data.text, /45,00 ₽/);
  const transactions = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data;
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].id, 'telegram_7402');
  assert.equal(transactions[0].amount_kopecks, 4500);
});


test('Telegram replay cache has a documented 24-hour TTL and prunes expired entries after a malformed prune marker', () => {
  const h = makeHarness();
  const props = h.context.PropertiesService.getScriptProperties();
  const secret = 'telegram-retention-secret-0123456789abcdef';
  props.setProperty('TELEGRAM_BACKEND_SECRET', secret);
  const source = fs.readFileSync('google-apps-script/Code.gs', 'utf8');
  assert.ok(source.includes('const TELEGRAM_UPDATE_TTL_MS = 24 * 60 * 60 * 1000'));
  assert.ok(source.includes('const TELEGRAM_UPDATE_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000'));

  props.setProperty('telegram:last_prune', 'not-a-timestamp');
  props.setProperty('telegram:update:expired', JSON.stringify({ expires: Date.now() - 1000, reply: { skip: true } }));
  props.setProperty('telegram:update:live', JSON.stringify({ expires: Date.now() + 60_000, reply: { skip: true } }));
  const cleanup = h.call({ action: 'telegramWebhook', telegramSecret: secret, update: { update_id: 7501 } });
  assert.equal(cleanup.error, null, cleanup.error?.message);
  assert.equal(props.getProperty('telegram:update:expired'), null);
  assert.ok(props.getProperty('telegram:update:live'));

  const now = Date.now();
  const help = h.call({
    action: 'telegramWebhook', telegramSecret: secret,
    update: { update_id: 7502, message: { chat: { id: 750, type: 'private' }, from: { id: 750 }, text: '/help' } }
  });
  assert.equal(help.error, null, help.error?.message);
  const saved = JSON.parse(props.getProperty('telegram:update:7502'));
  assert.ok(saved.expires >= now + 24 * 60 * 60 * 1000 - 1000);
  assert.ok(saved.expires <= Date.now() + 24 * 60 * 60 * 1000 + 1000);
});


test('backup structure audit is read-only and validates all table headers plus hidden auth sheet', () => {
  const h = makeHarness();
  const names = ['profiles','families','family_members','categories','accounts','transactions','recurring_payments','budgets','goals','goal_contributions','planned_purchases','monthly_plans','notifications','telegram_links','telegram_link_codes'];
  names.forEach(name => h.context.sheet_(name));
  h.signup('backup-audit@example.com');
  const report = h.context.auditBackupStructure();
  assert.equal(report.allChecksPassed, true);
  assert.equal(report.expectedSheetCount, 16);
  assert.equal(report.presentSheetCount, 16);
  assert.equal(report.missingSheets.length, 0);
  assert.equal(report.headerMismatches.length, 0);
  assert.equal(report.authHidden, true);
  assert.equal(report.timezoneOk, true);
  assert.ok(report.sheets.find(sheet => sheet.name === 'transactions').dataRows >= 0);
});

test('backup structure audit reports missing/mismatched sheets without creating or repairing them', () => {
  const h = makeHarness();
  const names = ['profiles','families','family_members','categories','accounts','transactions','recurring_payments','budgets','goals','goal_contributions','planned_purchases','monthly_plans','notifications','telegram_links','telegram_link_codes'];
  names.forEach(name => h.context.sheet_(name));
  h.signup('backup-audit-damaged@example.com');
  const ss = h.context.SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheetByName('budgets').getRange(1,1).setValue('wrong-header');
  ss.deleteSheet(ss.getSheetByName('transactions'));
  const before = ss.getSheetByName('transactions');
  const report = h.context.auditBackupStructure();
  assert.equal(report.allChecksPassed, false);
  assert.ok(report.missingSheets.includes('transactions'));
  assert.ok(report.headerMismatches.includes('budgets'));
  assert.equal(ss.getSheetByName('transactions'), before);
  assert.equal(ss.getSheetByName('transactions'), null);
});


test('password hash benchmark is editor-only and uses dummy data without reading or writing credentials', () => {
  const source = fs.readFileSync('google-apps-script/Code.gs', 'utf8');
  const start = source.indexOf('function benchmarkPasswordHash()');
  const end = source.indexOf('\nfunction ', start + 10);
  const body = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(body, /local-only-pbkdf2-benchmark/);
  assert.match(body, /non-secret-fixed-benchmark-salt/);
  assert.match(body, /PW_ITERATIONS,600000/);
  assert.doesNotMatch(body, /authRows_|PropertiesService|appendRows_|setProperty/);
})


test('isolated Apps Script PBKDF2 runtime diagnostic measures 30000 and 600000 iterations', () => {
  const source = fs.readFileSync('google-apps-script/PBKDF2_RUNTIME_DIAGNOSTICS.gs', 'utf8')
  assert.match(source, /samples\(30000, 5\)/)
  assert.match(source, /samples\(600000, 3\)/)
  assert.match(source, /synthetic-runtime-benchmark-password/)
  assert.match(source, /synthetic-runtime-benchmark-salt/)
  assert.doesNotMatch(source, /authRows_|PropertiesService|SpreadsheetApp|appendRow|setValue|deleteRow/)
})


test('read-only requests revalidate headers even when the script cache is warm', () => {
  const h = makeHarness();
  const sheet = seedTable(h, 'transactions');
  h.context.sheet_('transactions'); // Populate the successful header cache.
  sheet.getRange(1, 1, 1, 1).setValue('tampered_header');
  vm.runInContext('READ_ONLY_REQUEST = true', h.context);
  assert.throws(() => h.context.sheet_('transactions'), /требует обслуживания.*без автоматического изменения заголовков/);
});

test('read-candidate requests fail closed instead of creating a missing sheet', () => {
  const h = makeHarness();
  vm.runInContext('READ_ONLY_REQUEST = true', h.context);
  assert.throws(() => h.context.sheet_('transactions'), /отсутствует.*без автоматического создания структуры/);
  assert.equal(h.context.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('transactions'), null);
  assert.equal(h.context.SHEET_WRITES, 0);
});

test('read-candidate requests fail closed on incomplete headers without repairing them', () => {
  const h = makeHarness();
  const ss = h.context.SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.insertSheet('transactions');
  const oldHeaders = JSON.parse(JSON.stringify(vm.runInContext('TABLES.transactions.slice(0, -1)', h.context)));
  sheet.getRange(1, 1, 1, oldHeaders.length).setValues([oldHeaders]);
  h.context.READ_ONLY_REQUEST = true;
  assert.throws(() => h.context.sheet_('transactions'), /требует обслуживания.*без автоматического изменения заголовков/);
  assert.deepEqual(sheet.getRange(1, 1, 1, oldHeaders.length).getValues()[0], oldHeaders);
  assert.equal(sheet.getDataRange().getValues()[0].length, oldHeaders.length);
  assert.equal(h.context.SHEET_WRITES, 0);
});
