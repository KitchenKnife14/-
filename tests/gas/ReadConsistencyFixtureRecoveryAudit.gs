/**
 * Family Cash M-04: read-only audit of the cancelled read-consistency TEST fixture.
 *
 * Standalone, temporary TEST-only tool. This file is NOT part of
 * RuntimeAcceptanceBundle.gs, and must NEVER be added to Production.
 * No calls to deleteRow(s), setValue(s), remove*, or deleteProperty.
 */
function auditCancelledReadConsistencyFixture() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('CONCURRENT_ROW_TEST_WEB_APP_URL') || '').trim();
  var confirmation = String(props.getProperty('CONCURRENT_ROW_TEST_CONFIRM') || '');
  var ss = assertIsolatedGasTestEnvironment_(props, confirmation, url);
  if (ss.getSpreadsheetTimeZone() !== 'Europe/Moscow') {
    throw new Error('STOP: unexpected TEST spreadsheet timezone');
  }

  function cells(sheetName, column) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error('STOP: missing TEST sheet: ' + sheetName);
    var last = sheet.getLastRow();
    if (last < 2) return [];
    return sheet.getRange(2, column, last - 1, 1)
      .getDisplayValues().map(function(row) { return String(row[0] || ''); });
  }
  function positions(values, predicate) {
    var found = [];
    values.forEach(function(value, index) {
      if (predicate(value)) found.push(index + 2);
    });
    return found;
  }
  function matching(table, column, value) {
    return positions(cells(table, column), function(item) { return item === value; });
  }
  function matchingPrefix(table, column, prefix) {
    return positions(cells(table, column), function(item) {
      return item.indexOf(prefix) === 0;
    });
  }
  function expectOne(rows, name) {
    if (rows.length !== 1) throw new Error('STOP: expected exactly one ' + name);
    return rows[0];
  }
  function at(values, row) { return String(values[row - 2] || ''); }
  function day(value) {
    var s = String(value || '');
    if (s.indexOf('2026-11-24') === 0 || s.indexOf('24.11.2026') === 0) return true;
    return false;
  }

  var emails = cells('_auth', 2);
  var authRows = positions(emails, function(email) {
    return /^read-consistency\+[0-9a-f]{32}@example\.test$/.test(email);
  });
  var authRow = expectOne(authRows, 'abandoned TEST auth');
  var email = at(emails, authRow);
  var suffix = email.slice('read-consistency+'.length, -'@example.test'.length);
  var userId = at(cells('_auth', 1), authRow);
  if (!userId || !day(at(cells('_auth', 6), authRow))) {
    throw new Error('STOP: unexpected synthetic auth identity/date');
  }
  var familyNames = cells('families', 2);
  var familyRows = positions(familyNames, function(name) {
    return name === 'TEST read consistency ' + suffix;
  });
  var familyRow = expectOne(familyRows, 'abandoned TEST family');
  var familyId = at(cells('families', 1), familyRow);
  if (!familyId || at(cells('families', 6), familyRow) !== userId ||
      !day(at(cells('families', 5), familyRow))) {
    throw new Error('STOP: family owner or date mismatch');
  }

  var membersByFamily = matching('family_members', 2, familyId);
  var membersByUser = matching('family_members', 3, userId);
  var memberRow = expectOne(membersByFamily, 'family_members by family');
  if (membersByUser.length !== 1 || membersByUser[0] !== memberRow) {
    throw new Error('STOP: membership mismatch');
  }
  var profiles = matching('profiles', 1, userId);
  expectOne(profiles, 'profile');
  var categoryRows = matching('categories', 2, familyId);
  if (categoryRows.length !== 87) {
    throw new Error('STOP: unexpected seeded category count');
  }
  var catDates = cells('categories', 10);
  if (categoryRows.some(function(row) { return !day(at(catDates, row)); })) {
    throw new Error('STOP: category created date mismatch');
  }
  for (var i = 1; i < categoryRows.length; i++) {
    if (categoryRows[i] !== categoryRows[i - 1] + 1) {
      throw new Error('STOP: synthetic categories are not contiguous');
    }
  }
  var expectedPurchaseId = 'readcheck_' + suffix;
  var expectedTransactionId = 'purchase_' + expectedPurchaseId;
  var purchaseRows = matching('planned_purchases', 1, expectedPurchaseId);
  var transactionRows = matching('transactions', 1, expectedTransactionId);
  var p = expectOne(purchaseRows, 'planned purchase');
  var t = expectOne(transactionRows, 'transaction');
  if (at(cells('planned_purchases', 2), p) !== familyId ||
      at(cells('transactions', 2), t) !== familyId) {
    throw new Error('STOP: synthetic financial row family mismatch');
  }
  if (matching('planned_purchases', 2, familyId).length !== 1 ||
      matching('transactions', 2, familyId).length !== 1) {
    throw new Error('STOP: additional purchase/transaction in this family');
  }

  var familyRefs = {
    accounts: matching('accounts', 2, familyId).length,
    recurring: matching('recurring_payments', 2, familyId).length,
    budgets: matching('budgets', 2, familyId).length,
    goals: matching('goals', 2, familyId).length,
    plans: matching('monthly_plans', 2, familyId).length,
    notifications: matching('notifications', 2, familyId).length,
    telegramLinks: matching('telegram_links', 5, familyId).length,
    telegramCodes: matching('telegram_link_codes', 3, familyId).length,
    telegramCodesByUser: matching('telegram_link_codes', 2, userId).length
  };
  if (Object.keys(familyRefs).some(function(key) { return familyRefs[key] !== 0; })) {
    throw new Error('STOP: unexpected additional related TEST rows');
  }
  if (matching('telegram_links', 4, userId).length) {
    throw new Error('STOP: unexpected Telegram account link');
  }
  var sessions = 0, matchingSessions = 0, invalidSessions = 0;
  var allProperties = props.getProperties();
  Object.keys(allProperties).forEach(function(key) {
    if (key.indexOf('session:') !== 0) return;
    sessions++;
    try {
      var data = JSON.parse(allProperties[key]);
      if (data && String(data.userId || '') === userId) matchingSessions++;
    } catch (_) { invalidSessions++; }
  });
  var report = {
    test: 'cancelled read-consistency TEST fixture audit',
    mode: 'READ_ONLY',
    status: invalidSessions === 0 ? 'READY_FOR_SEPARATE_CLEANUP' : 'BLOCKED_INVALID_SESSION',
    found: {
      auth: authRows.length, profiles: profiles.length, families: familyRows.length,
      familyMembers: membersByFamily.length, categories: categoryRows.length,
      purchases: purchaseRows.length, transactions: transactionRows.length
    },
    totalFixtureRows: authRows.length + profiles.length + familyRows.length +
      membersByFamily.length + categoryRows.length + purchaseRows.length + transactionRows.length,
    extraFamilyRefs: familyRefs,
    scriptPropertiesSessionCount: sessions,
    abandonedUserSessionCount: matchingSessions,
    unreadableSessionCount: invalidSessions
  };
  Logger.log(JSON.stringify(report));
  return report;
}
