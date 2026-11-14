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
    Date,
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
    failDeleteRowsAfter: offset => { failDeleteRowsAt = deleteRowsCalls + offset; },
    clearRowsCache: () => vm.runInContext('ROWS_CACHE = {}', context)
  };
}

function seedTable(h, name) {
  const headers = JSON.parse(JSON.stringify(vm.runInContext(`TABLES[${JSON.stringify(name)}]`, h.context)));
  const sheet = h.context.SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name)
    || h.context.SpreadsheetApp.getActiveSpreadsheet().insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sheet;
}

test('Apps Script manifest pins the server runtime and Moscow timezone', () => {
  const manifest = JSON.parse(fs.readFileSync('google-apps-script/appsscript.json', 'utf8'));
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.equal(manifest.timeZone, 'Europe/Moscow');
  assert.equal(manifest.exceptionLogging, 'STACKDRIVER');
  assert.deepEqual(manifest.dependencies, {});
});

test('date and time normalization uses the spreadsheet timezone at the month boundary', () => {
  const h = makeHarness();
  const originalFormatDate = h.context.Utilities.formatDate;
  h.context.Utilities.formatDate = (date, timezone, pattern) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(date));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    if (pattern === 'yyyy-MM-dd') return values.year + '-' + values.month + '-' + values.day;
    if (pattern === 'HH:mm') return values.hour + ':' + values.minute;
    return originalFormatDate(date, timezone, pattern);
  };

  const instant = new h.context.Date('2026-10-31T21:30:00.000Z');
  assert.equal(h.context.normal_(instant, 'operation_date'), '2026-11-01');
  assert.equal(h.context.normal_(instant, 'operation_time'), '00:30');
  assert.equal(h.context.normal_(instant, 'created_at'), '2026-10-31T21:30:00.000Z');
});

test('DEBUG_INFO is enabled only by the exact flag and hideInfo removes the diagnostic field', () => {
  const h = makeHarness();
  h.context.Logger = { log: () => {} };
  const parse = output => JSON.parse(output.getContent());
  const props = h.context.PropertiesService.getScriptProperties();

  props.setProperty('DEBUG_INFO', 'true');
  assert.equal(Object.hasOwn(parse(h.context.doGet()), 'spreadsheet'), false);

  h.context.showInfo();
  const debug = parse(h.context.doGet());
  assert.deepEqual(Object.keys(debug).sort(), ['message', 'spreadsheet', 'status', 'version']);
  assert.equal(debug.spreadsheet, 'Семейный бюджет');

  h.context.hideInfo();
  const normal = parse(h.context.doGet());
  assert.deepEqual(Object.keys(normal).sort(), ['message', 'status', 'version']);
  assert.equal(normal.status, 'ok');
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
  const allowed = ['act', 'lockMs', 'totalMs', 'workMs', 'optimisticReadMs', 'pbkdf2Ms', 'readRetry', 'reads', 'writes', 'readMs', 'writeMs', 'revisionWriteFailures', 'consistencyMarkerWriteFailures'];
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

test('request metrics isolate PBKDF2 duration without logging credentials', () => {
  const h = makeHarness();
  const logs = [];
  h.context.console = { log: value => logs.push(String(value)) };
  const response = h.call({ action: 'signup', email: 'pbkdf2-metric@example.com', password: 'private-password-not-logged' });
  assert.equal(response.error, null, response.error?.message);
  const record = JSON.parse(logs.at(-1));
  assert.equal(record.act, 'signup');
  assert.equal(typeof record.pbkdf2Ms, 'number');
  assert.ok(record.pbkdf2Ms >= 0);
  assert.ok(!logs.join(' ').includes('private-password-not-logged'));
  assert.ok(!logs.join(' ').includes('pbkdf2-metric@example.com'));
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

test('expired sessions are rejected without mutating Script Properties during authentication', () => {
  const h = makeHarness();
  const user = h.signup('expired-session@example.com');
  const key = 'session:' + user.token;
  h.context.PropertiesService.getScriptProperties().setProperty(key, JSON.stringify({
    userId: user.user.id,
    expires: 0
  }));
  const response = h.call({ action: 'getSession', token: user.token });
  assert.match(response.error?.message || '', /Сессия завершена/);
  assert.ok(h.context.PropertiesService.getScriptProperties().getProperty(key));
});

test('malformed session records fail closed without mutating Script Properties on use', () => {
  const h = makeHarness();
  const user = h.signup('malformed-session@example.com');
  const props = h.context.PropertiesService.getScriptProperties();
  const key = 'session:' + user.token;
  const malformed = ['{not-json', 'null', JSON.stringify({ expires: Date.now() + 60_000 })];

  for (const value of malformed) {
    props.setProperty(key, value);
    const response = h.call({ action: 'getSession', token: user.token });
    assert.match(response.error?.message || '', /Сессия завершена/);
    assert.equal(props.getProperty(key), value);
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

test('joinFamily retry completes profile update after membership was already saved', () => {
  const h = makeHarness();
  const owner = h.signup('join-profile-owner@example.com');
  const partner = h.signup('join-profile-partner@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Повтор присоединения' }).data;
  const originalUpdate = h.context.updateRows_;
  let failOnce = true;
  h.context.updateRows_ = function(table, rows) {
    if (table === 'profiles' && failOnce) {
      failOnce = false;
      throw new Error('simulated profile update failure');
    }
    return originalUpdate(table, rows);
  };
  const args = {
    action: 'joinFamily', token: partner.token, invite_code: family.invite_code,
    display_name: 'Новое имя после повтора'
  };
  const first = h.call(args);
  assert.match(first.error?.message || '', /simulated profile update failure/);
  assert.equal(h.context.rows_('family_members').filter(row => row.user_id === partner.user.id).length, 1);
  assert.notEqual(h.context.rows_('profiles').find(row => row.id === partner.user.id).display_name, 'Участник семьи');

  const retry = h.call(args);
  assert.equal(retry.error, null, retry.error?.message);
  assert.equal(h.context.rows_('family_members').filter(row => row.user_id === partner.user.id).length, 1);
  assert.equal(h.context.rows_('profiles').find(row => row.id === partner.user.id).display_name, 'Новое имя после повтора');
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
  const recurringSeed0 = h.call({ action: 'query', token: user.token, table: 'recurring_payments', mode: 'select' }).data[0];
  const recurring = h.call({ action: 'query', token: user.token, table: 'recurring_payments', mode: 'select', filters: [{ column: 'id', op: 'eq', value: recurringSeed0.id }] }).data[0];
  const originalUpdate = h.context.updateRows_;
  let failOnce = true;
  h.context.updateRows_ = function(name, rows) {
    if (name === 'recurring_payments' && failOnce) { failOnce = false; throw new Error('simulated write failure'); }
    return originalUpdate(name, rows);
  };
  const args = { action: 'rpc', token: user.token, name: 'confirm_recurring_payment', params: {
    p_recurring_id: recurring.id, p_expected_due_date: '2026-10-28', p_operation_date: '2026-10-28', p_expected_recurring: recurring
  }};
  const failed = h.call(args);
  assert.match(failed.error.message, /simulated write failure/);
  const changedDateRetry = h.call({ ...args, params: { ...args.params, p_operation_date: '2026-10-29' } });
  assert.match(changedDateRetry.error?.message || '', /не соответствует .*регулярному платежу/);
  const retried = h.call(args);
  assert.equal(retried.error, null, retried.error?.message);
  const replayed = h.call(args);
  assert.equal(replayed.error, null, replayed.error?.message);
  const txs = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data;
  assert.equal(txs.length, 1);
  assert.equal(txs[0].id, `recurring_${recurring.id}_2026-10-28`);
  const after = h.call({ action: 'query', token: user.token, table: 'recurring_payments', mode: 'select' }).data[0];
  assert.equal(after.next_due_date, '2026-11-28');
});


test('recurring payment confirmation replay returns success after the full commit', () => {
  const h = makeHarness();
  const user = h.signup('recurring-full-replay@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Повтор регулярного платежа' }).data;
  const created = h.call({
    action: 'query', token: user.token, table: 'recurring_payments', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 12500, description: 'Интернет', start_date: '2026-10-31', next_due_date: '2026-10-31', frequency: 'monthly', active: true }
  });
  assert.equal(created.error, null, created.error?.message);
  const recurringSeed1 = h.call({ action: 'query', token: user.token, table: 'recurring_payments', mode: 'select', filters: [{ column: 'id', op: 'eq', value: created.data[0].id }] }).data[0];
  const recurring = h.call({ action: 'query', token: user.token, table: 'recurring_payments', mode: 'select', filters: [{ column: 'id', op: 'eq', value: recurringSeed1.id }] }).data[0];
  const args = { action: 'rpc', token: user.token, name: 'confirm_recurring_payment', params: {
    p_recurring_id: recurring.id, p_expected_due_date: '2026-10-31', p_operation_date: '2026-11-01', p_expected_recurring: recurring
  }};
  const first = h.call(args);
  assert.equal(first.error, null, first.error?.message);
  const laterEdit = h.call({
    action: 'query', token: user.token, table: 'recurring_payments', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: recurring.id }], values: { description: 'Интернет — новый тариф' }
  });
  assert.equal(laterEdit.error, null, laterEdit.error?.message);
  const replay = h.call(args);
  assert.equal(replay.error, null, replay.error?.message);
  assert.equal(replay.data, true);
  const txs = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select' }).data;
  assert.equal(txs.length, 1);
  assert.equal(txs[0].id, `recurring_${recurring.id}_2026-10-31`);
  const after = h.call({ action: 'query', token: user.token, table: 'recurring_payments', mode: 'select' }).data[0];
  assert.equal(after.next_due_date, '2026-11-30');
});

test('recurring confirmation rejects a stale snapshot after another family member edits the payment', () => {
  const h = makeHarness();
  const owner = h.signup('recurring-stale-owner@example.com');
  const partner = h.signup('recurring-stale-partner@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Устаревший регулярный платёж' }).data;
  assert.equal(h.call({ action: 'joinFamily', token: partner.token, invite_code: family.invite_code }).error, null);
  const recurringSeed2 = h.call({
    action: 'query', token: owner.token, table: 'recurring_payments', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 12500, description: 'Интернет', start_date: '2026-11-01', next_due_date: '2026-11-11', frequency: 'monthly', active: true }
  }).data[0];
  const recurring = h.call({ action: 'query', token: owner.token, table: 'recurring_payments', mode: 'select', filters: [{ column: 'id', op: 'eq', value: recurringSeed2.id }] }).data[0];
  const changed = h.call({
    action: 'query', token: partner.token, table: 'recurring_payments', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: recurring.id }], values: { amount_kopecks: 15000 }
  });
  assert.equal(changed.error, null, changed.error?.message);
  const stale = h.call({
    action: 'rpc', token: owner.token, name: 'confirm_recurring_payment',
    params: { p_recurring_id: recurring.id, p_expected_due_date: recurring.next_due_date, p_operation_date: '2026-11-11', p_expected_recurring: recurring }
  });
  assert.match(stale.error?.message || '', /изменён другим участником/i);
  assert.equal(h.call({ action: 'query', token: owner.token, table: 'transactions', mode: 'select' }).data.length, 0);
  const saved = h.call({ action: 'query', token: owner.token, table: 'recurring_payments', mode: 'select' }).data[0];
  assert.equal(saved.amount_kopecks, 15000);
  assert.equal(saved.next_due_date, '2026-11-11');
});

test('optimistic update rejects stale snapshots and preserves the newer row', () => {
  const h = makeHarness();
  const user = h.signup('stale-update@example.com');
  const family = h.call({ action: 'createFamily', token: user.token, name: 'Проверка устаревшей формы' }).data;
  const created = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 15000, operation_date: '2026-11-11', description: 'Исходное описание' }
  });
  assert.equal(created.error, null, created.error?.message);
  const staleSnapshot = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select', filters: [{ column: 'id', op: 'eq', value: created.data[0].id }] }).data[0];
  const newer = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: created.data[0].id }], values: { description: 'Изменено вторым участником' }
  });
  assert.equal(newer.error, null, newer.error?.message);
  const partialWrite = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: created.data[0].id }], expected: { id: created.data[0].id },
    values: { amount_kopecks: 18000 }
  });
  assert.match(partialWrite.error?.message || '', /неполный снимок/i);
  const staleWrite = h.call({
    action: 'query', token: user.token, table: 'transactions', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: created.data[0].id }], expected: staleSnapshot,
    values: { amount_kopecks: 20000 }
  });
  assert.match(staleWrite.error?.message || '', /изменена другим участником/i);
  const saved = h.call({ action: 'query', token: user.token, table: 'transactions', mode: 'select', filters: [{ column: 'id', op: 'eq', value: created.data[0].id }] });
  assert.equal(saved.data[0].description, 'Изменено вторым участником');
  assert.equal(saved.data[0].amount_kopecks, 15000);
});

test('delete rejects a stale row snapshot and reports an already removed row', () => {
  const h = makeHarness();
  const owner = h.signup('stale-delete-owner@example.com');
  const partner = h.signup('stale-delete-partner@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Удаление устаревшей записи' }).data;
  assert.equal(h.call({ action: 'joinFamily', token: partner.token, invite_code: family.invite_code }).error, null);
  const created = h.call({
    action: 'query', token: owner.token, table: 'transactions', mode: 'insert', returning: true,
    values: { family_id: family.id, type: 'expense', amount_kopecks: 12500, operation_date: '2026-11-11', description: 'Исходная покупка' }
  });
  assert.equal(created.error, null, created.error?.message);
  const snapshot = h.call({
    action: 'query', token: owner.token, table: 'transactions', mode: 'select',
    filters: [{ column: 'id', op: 'eq', value: created.data[0].id }]
  }).data[0];
  const changed = h.call({
    action: 'query', token: partner.token, table: 'transactions', mode: 'update',
    filters: [{ column: 'id', op: 'eq', value: snapshot.id }],
    values: { description: 'Изменено вторым участником' }
  });
  assert.equal(changed.error, null, changed.error?.message);

  const partialDelete = h.call({
    action: 'query', token: owner.token, table: 'transactions', mode: 'delete',
    filters: [{ column: 'id', op: 'eq', value: snapshot.id }], expected: { id: snapshot.id }
  });
  assert.match(partialDelete.error?.message || '', /неполный снимок/i);
  const staleDelete = h.call({
    action: 'query', token: owner.token, table: 'transactions', mode: 'delete',
    filters: [{ column: 'id', op: 'eq', value: snapshot.id }], expected: snapshot
  });
  assert.match(staleDelete.error?.message || '', /изменена другим участником/i);
  let saved = h.call({ action: 'query', token: owner.token, table: 'transactions', mode: 'select' }).data[0];
  assert.equal(saved.description, 'Изменено вторым участником');

  const removed = h.call({
    action: 'query', token: owner.token, table: 'transactions', mode: 'delete',
    filters: [{ column: 'id', op: 'eq', value: saved.id }], expected: saved
  });
  assert.equal(removed.error, null, removed.error?.message);
  const repeatedDelete = h.call({
    action: 'query', token: owner.token, table: 'transactions', mode: 'delete',
    filters: [{ column: 'id', op: 'eq', value: saved.id }], expected: saved
  });
  assert.match(repeatedDelete.error?.message || '', /уже удалена/i);
  assert.equal(h.call({ action: 'query', token: owner.token, table: 'transactions', mode: 'select' }).data.length, 0);
});

test('monthly plan upsert rejects stale snapshots and concurrent inserts', () => {
  const h = makeHarness();
  const owner = h.signup('monthly-plan-stale-owner@example.com');
  const partner = h.signup('monthly-plan-stale-partner@example.com');
  const family = h.call({ action: 'createFamily', token: owner.token, name: 'Конфликт месячного плана' }).data;
  assert.equal(h.call({ action: 'joinFamily', token: partner.token, invite_code: family.invite_code }).error, null);
  const key = { family_id: family.id, month_date: '2026-11-01', category_id: null, type: 'expense' };
  const created = h.call({ action: 'query', token: owner.token, table: 'monthly_plans', mode: 'upsert', returning: true, onConflict: 'family_id,month_date,category_id,type', values: { ...key, planned_kopecks: 10000, note: 'Исходный план' } });
  assert.equal(created.error, null, created.error?.message);
  const snapshot = h.call({ action: 'query', token: owner.token, table: 'monthly_plans', mode: 'select', filters: [{ column: 'family_id', op: 'eq', value: family.id }, { column: 'month_date', op: 'eq', value: key.month_date }, { column: 'type', op: 'eq', value: key.type }, { column: 'category_id', op: 'is', value: null }] }).data[0];
  const newer = h.call({ action: 'query', token: partner.token, table: 'monthly_plans', mode: 'upsert', onConflict: 'family_id,month_date,category_id,type', values: { ...key, planned_kopecks: 15000, note: 'Изменение второго участника' } });
  assert.equal(newer.error, null, newer.error?.message);
  const partial = h.call({ action: 'query', token: owner.token, table: 'monthly_plans', mode: 'upsert', onConflict: 'family_id,month_date,category_id,type', expectedRows: [{ ...key }], values: { ...key, planned_kopecks: 19000 } });
  assert.match(partial.error?.message || '', /неполный снимок/i);
  const stale = h.call({ action: 'query', token: owner.token, table: 'monthly_plans', mode: 'upsert', onConflict: 'family_id,month_date,category_id,type', expectedRows: [snapshot], values: { ...key, planned_kopecks: 20000, note: 'Устаревший план' } });
  assert.match(stale.error?.message || '', /изменён другим участником/i);
  const saved = h.call({ action: 'query', token: owner.token, table: 'monthly_plans', mode: 'select', filters: [{ column: 'family_id', op: 'eq', value: family.id }] }).data[0];
  assert.equal(saved.planned_kopecks, 15000);
  assert.equal(saved.note, 'Изменение второго участника');
  const key2 = { ...key, month_date: '2026-12-01' };
  const partnerInsert = h.call({ action: 'query', token: partner.token, table: 'monthly_plans', mode: 'upsert', onConflict: 'family_id,month_date,category_id,type', values: { ...key2, planned_kopecks: 5000 } });
  assert.equal(partnerInsert.error, null, partnerInsert.error?.message);
  const racedInsert = h.call({ action: 'query', token: owner.token, table: 'monthly_plans', mode: 'upsert', onConflict: 'family_id,month_date,category_id,type', expectedRows: [null], values: { ...key2, planned_kopecks: 7000 } });
  assert.match(racedInsert.error?.message || '', /создана другим участником/i);
});

test('PBKDF2-HMAC-SHA256 matches the standard one-iteration test vector', () => {
  const h = makeHarness();
  assert.equal(
    h.context.pbkdf2Hex_('password', 'salt', 1),
    '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b'
  );
});

test('PBKDF2 runtime benchmark is guarded against accidental production execution', () => {
  const source = fs.readFileSync('google-apps-script/PBKDF2_RUNTIME_DIAGNOSTICS.gs', 'utf8');
  assert.match(source, /PBKDF2_DIAGNOSTICS_CONFIRM/);
  assert.match(source, /PBKDF2_ALLOWED_SCRIPT_ID/);
  assert.match(source, /PBKDF2_ALLOWED_SPREADSHEET_ID/);
  assert.match(source, /ScriptApp\.getScriptId\(\)/);
  assert.match(source, /spreadsheet\.getId\(\)/);
  assert.match(source, /test\|тест/i);
  assert.doesNotMatch(source, /productionScriptId|AKfycb/);
  assert.doesNotMatch(source, /getSheetByName|getRange|appendRow|setValue|deleteRow/);
  assert.match(source, /pbkdf2_600000: samples\(600000, 3\)/);
});

test('PBKDF2 benchmark runtime guard rejects wrong project and spreadsheet before hashing', () => {
  const source = fs.readFileSync('google-apps-script/PBKDF2_RUNTIME_DIAGNOSTICS.gs', 'utf8');
  const properties = new Map();
  let hashCalls = 0;
  const logs = [];
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key) ?? null }) },
    ScriptApp: { getScriptId: () => 'TEST_SCRIPT_ID' },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getName: () => 'TEST Семейный бюджет', getId: () => 'TEST_SPREADSHEET_ID' }) },
    pbkdf2Hex_: () => { hashCalls++; return 'a'.repeat(64); },
    Logger: { log: value => logs.push(String(value)) },
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  assert.throws(() => context.runPbkdf2RuntimeDiagnostics(), /ISOLATED_TEST_ONLY/);
  assert.equal(hashCalls, 0);
  properties.set('PBKDF2_DIAGNOSTICS_CONFIRM', 'ISOLATED_TEST_ONLY');
  properties.set('PBKDF2_ALLOWED_SCRIPT_ID', 'WRONG_SCRIPT_ID');
  properties.set('PBKDF2_ALLOWED_SPREADSHEET_ID', 'TEST_SPREADSHEET_ID');
  assert.throws(() => context.runPbkdf2RuntimeDiagnostics(), /Script ID/);
  assert.equal(hashCalls, 0);
  properties.set('PBKDF2_ALLOWED_SCRIPT_ID', 'TEST_SCRIPT_ID');
  properties.set('PBKDF2_ALLOWED_SPREADSHEET_ID', 'WRONG_SPREADSHEET_ID');
  assert.throws(() => context.runPbkdf2RuntimeDiagnostics(), /ID таблицы/);
  assert.equal(hashCalls, 0);
  properties.set('PBKDF2_ALLOWED_SPREADSHEET_ID', 'TEST_SPREADSHEET_ID');

  const report = context.runPbkdf2RuntimeDiagnostics();
  assert.equal(report.pbkdf2_30000.samplesMs.length, 5);
  assert.equal(report.pbkdf2_600000.samplesMs.length, 3);
  assert.equal(hashCalls, 9);
  assert.equal(logs.length, 1);
});

test('shared GAS concurrency guard rejects missing and mismatched TEST allowlists', () => {
  const source = fs.readFileSync('tests/gas/IsolatedTestGuard.gs', 'utf8');
  const properties = new Map();
  const spreadsheet = { getName: () => 'TEST Семейный бюджет', getId: () => 'TEST_SHEET' };
  const context = {
    ScriptApp: { getScriptId: () => 'TEST_SCRIPT' },
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
  };
  context.PropertiesService = { getScriptProperties: () => ({ getProperty: key => properties.get(key) ?? null }) };
  vm.createContext(context);
  vm.runInContext(source, context);
  const url = 'https://script.google.com/macros/s/TEST_DEPLOYMENT/exec';

  assert.throws(() => context.assertIsolatedGasTestEnvironment_(context.PropertiesService.getScriptProperties(), '', url), /ISOLATED_TEST_ONLY/);
  properties.set('BACKEND_DIAGNOSTICS_ALLOWED_SCRIPT_ID', 'WRONG_SCRIPT');
  properties.set('GAS_TEST_ALLOWED_SPREADSHEET_ID', 'TEST_SHEET');
  assert.throws(() => context.assertIsolatedGasTestEnvironment_(context.PropertiesService.getScriptProperties(), 'ISOLATED_TEST_ONLY', url), /Script ID/);
  properties.set('BACKEND_DIAGNOSTICS_ALLOWED_SCRIPT_ID', 'TEST_SCRIPT');
  properties.set('GAS_TEST_ALLOWED_SPREADSHEET_ID', 'WRONG_SHEET');
  assert.throws(() => context.assertIsolatedGasTestEnvironment_(context.PropertiesService.getScriptProperties(), 'ISOLATED_TEST_ONLY', url), /TEST-таблицей/);
  properties.set('GAS_TEST_ALLOWED_SPREADSHEET_ID', 'TEST_SHEET');
  assert.throws(() => context.assertIsolatedGasTestEnvironment_(context.PropertiesService.getScriptProperties(), 'ISOLATED_TEST_ONLY', 'https://script.google.com/macros/s/AKfycbxQLSZXG-R_AGZG5clVDGnMqd4_cwvwsPsf3_9mJ79Rnas7CZVeuIhtSi7FM5MMagkqqg/exec'), /TEST Web App/);
  assert.equal(context.assertIsolatedGasTestEnvironment_(context.PropertiesService.getScriptProperties(), 'ISOLATED_TEST_ONLY', url).getId(), 'TEST_SHEET');
});

test('isolated GAS Telegram replay probe self-provisions fixtures and verifies concurrent delivery, lost-cache retry and cleanup', () => {
  const source = fs.readFileSync('tests/gas/TelegramUpdateConcurrencyTest.gs', 'utf8');
  assert.match(source, /runTelegramUpdateConcurrencyTest/);
  assert.match(source, /assertIsolatedGasTestEnvironment_/);
  assert.match(source, /CONCURRENT_ROW_TEST_WEB_APP_URL/);
  assert.match(source, /CONCURRENT_ROW_TEST_CONFIRM/);
  assert.match(source, /action: 'signup'/);
  assert.match(source, /createFamily/);
  assert.match(source, /create_telegram_link_code/);
  assert.match(source, /\/link /);
  assert.match(source, /fetchAll\(\[requestOptions, requestOptions\]\)/);
  assert.match(source, /telegram:update:' \+ transactionUpdateId/);
  assert.match(source, /retry_requests = 1/);
  assert.match(source, /transactionRows\.length !== 1/);
  assert.match(source, /restoreProperty\(secretKey, oldSecret\)/);
  assert.match(source, /restoreProperty\(pruneKey, oldPrune\)/);
  assert.match(source, /report\.cleanup = 'PASS'/);
  assert.match(source, /manual_cleanup_transaction_id/);
});

test('isolated GAS goal contribution concurrency probe checks two participants and cleanup', () => {
  const source = fs.readFileSync('tests/gas/GoalContributionConcurrencyTest.gs', 'utf8');
  assert.match(source, /runGoalContributionConcurrencyTest/);
  assert.match(source, /assertIsolatedGasTestEnvironment_/);
  assert.match(source, /GOAL_TEST_WEB_APP_URL/);
  assert.match(source, /GOAL_TEST_TOKEN_A/);
  assert.match(source, /GOAL_TEST_TOKEN_B/);
  assert.match(source, /fetchAll\(requests\)/);
  assert.match(source, /saved_kopecks\) !== 40000/);
  assert.match(source, /report\.cleanup = 'PASS'/);
  assert.match(source, /productionScriptId/);
});
