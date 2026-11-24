/**
 * TEST-only recovery for the single abandoned 24 Nov 2026 read-consistency fixture.
 * Run manually in the existing isolated TEST editor; NEVER deploy this file.
 * No credentials or fixture contents are logged. Do not retry after uncertain execution.
 */
function planCancelledReadConsistencyCleanup_() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('CONCURRENT_ROW_TEST_WEB_APP_URL') || '').trim();
  var confirmation = String(props.getProperty('CONCURRENT_ROW_TEST_CONFIRM') || '');
  var ss = assertIsolatedGasTestEnvironment_(props, confirmation, url);
  if (!String(ScriptApp.getScriptId()).endsWith('KMTZTF') ||
      !String(ss.getId()).endsWith('bqT8qQ') || !url.endsWith('WsbCe/exec') ||
      ss.getName() !== 'Семейный бюджет Тестирование') {
    throw new Error('STOP: wrong confirmed TEST target');
  }
  if (ss.getSpreadsheetTimeZone() !== 'Europe/Moscow') {
    throw new Error('STOP: unexpected TEST spreadsheet timezone');
  }

  var schema = Object.assign({_auth:['id','email','salt','password_hash','display_name','created_at']}, TABLES);
  var snapshots = {};
  Object.keys(schema).forEach(function(name) {
    var sheet = ss.getSheetByName(name);
    var columns = schema[name];
    if (!sheet || sheet.getLastColumn() !== columns.length || sheet.getLastRow() < 1) {
      throw new Error('STOP: unexpected TEST schema: ' + name);
    }
    var data = sheet.getRange(1, 1, sheet.getLastRow(), columns.length).getDisplayValues();
    if (JSON.stringify(data[0]) !== JSON.stringify(columns)) {
      throw new Error('STOP: wrong TEST headers: ' + name);
    }
    snapshots[name] = {sheetId:sheet.getSheetId(), columns:columns, data:data};
  });
  function cells(sheetName, column) {
    return snapshots[sheetName].data.slice(1).map(function(row) { return String(row[column-1] || ''); });
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
  var sessionKeys = [], sessionValues = {};
  var allProperties = props.getProperties();
  Object.keys(allProperties).forEach(function(key) {
    if (key.indexOf('session:') !== 0) return;
    sessions++;
    sessionValues[key] = allProperties[key];
    try {
      var data = JSON.parse(allProperties[key]);
      if (data && String(data.userId || '') === userId) { matchingSessions++; sessionKeys.push(key); }
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
  if (report.status !== 'READY_FOR_SEPARATE_CLEANUP' || report.totalFixtureRows !== 93 ||
      sessions !== 7 || matchingSessions !== 1 || invalidSessions !== 0) {
    throw new Error('STOP: fixture or session counts changed since the approved audit');
  }
  var targets = {transactions:transactionRows, planned_purchases:purchaseRows,
    categories:categoryRows, family_members:membersByFamily, families:familyRows,
    profiles:profiles, _auth:authRows};
  var ids = new Set([userId, familyId, expectedPurchaseId, expectedTransactionId]);
  ['categories','family_members'].forEach(function(name) {
    var seen = new Set();
    targets[name].forEach(function(row) {
      var value = String(snapshots[name].data[row-1][0] || '');
      if (!value || seen.has(value) || ids.has(value)) throw new Error('STOP: fixture identifier collision');
      seen.add(value); ids.add(value);
    });
  });
  // Reject any unexpected external reference, including goal_contributions.
  Object.keys(snapshots).forEach(function(name) {
    var snap = snapshots[name], excluded = new Set(targets[name] || []);
    snap.data.slice(1).forEach(function(row,i) {
      if (excluded.has(i+2)) return;
      snap.columns.forEach(function(col,j) {
        if (/^(id|.*_id|created_by|updated_by)$/.test(col) && ids.has(String(row[j] || ''))) {
          throw new Error('STOP: unexpected reference outside fixture: ' + name);
        }
      });
    });
  });
  return {ss:ss, props:props, snapshots:snapshots, targets:targets,
    sessionKey:sessionKeys[0], sessionValues:sessionValues, report:report};
}

/**
 * Only entry point for the separate, owner-approved cleanup.
 * Backup + deleteDimension are one atomic Sheets API batch. Script Properties
 * are a separate store: the session is revoked only after verifying the sheets.
 * A failure/uncertain response must be investigated, never blindly retried.
 */
function cleanupCancelledReadConsistencyFixture() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('STOP: TEST writer still active');
  var stable = null;
  try {
    var plan = planCancelledReadConsistencyCleanup_();
    var ss = plan.ss, props = plan.props;
    var backupName = '_m04_fixture_backup_20261124';
    if (ss.getSheetByName(backupName)) throw new Error('STOP: recovery backup already exists; inspect before retry');
    var used = new Set(ss.getSheets().map(function(sheet){return sheet.getSheetId();}));
    var backupId = 1000000000;
    while (used.has(backupId)) backupId++;
    var requests = [{addSheet:{properties:{sheetId:backupId,title:backupName,hidden:true,
      gridProperties:{rowCount:100,columnCount:24}}}}];
    var labels = [], expectedBackup = [], expected = {};
    function normalized(rows) {
      var copy = rows.slice();
      while (copy.length > 1 && copy[copy.length-1].every(function(v){return v === '';})) copy.pop();
      return copy;
    }
    Object.keys(plan.snapshots).forEach(function(name) {
      var snap = plan.snapshots[name], rows = (plan.targets[name] || []).slice().sort(function(a,b){return a-b;});
      var remove = new Set(rows);
      expected[name] = normalized(snap.data.filter(function(_,index){return !remove.has(index+1);}));
      var i=0;
      while(i<rows.length) {
        var low=rows[i], high=low;
        while(i+1<rows.length && rows[i+1]===high+1){i++;high++;}
        var dest=expectedBackup.length;
        for(var r=low;r<=high;r++){
          labels.push({values:[{userEnteredValue:{stringValue:name}},{userEnteredValue:{numberValue:r}}]});
          expectedBackup.push([name,String(r)].concat(snap.data[r-1]));
        }
        requests.push({copyPaste:{source:{sheetId:snap.sheetId,startRowIndex:low-1,endRowIndex:high,
          startColumnIndex:0,endColumnIndex:snap.columns.length},destination:{sheetId:backupId,startRowIndex:dest,
          endRowIndex:dest+high-low+1,startColumnIndex:2,endColumnIndex:2+snap.columns.length},
          pasteType:'PASTE_NORMAL',pasteOrientation:'NORMAL'}});
        i++;
      }
    });
    if(expectedBackup.length!==93) throw new Error('STOP: wrong backup scope');
    requests.push({updateCells:{start:{sheetId:backupId,rowIndex:0,columnIndex:0},rows:labels,fields:'userEnteredValue'}});
    Object.keys(plan.targets).forEach(function(name) {
      var rows=plan.targets[name].slice().sort(function(a,b){return b-a;});
      var i=0;
      while(i<rows.length){
        var high=rows[i],low=high;
        while(i+1<rows.length && rows[i+1]===low-1){i++;low--;}
        requests.push({deleteDimension:{range:{sheetId:plan.snapshots[name].sheetId,dimension:'ROWS',
          startIndex:low-1,endIndex:high}}});i++;
      }
    });
    // Preserve optimistic-read protocol while the backend's ScriptLock is held.
    stable=beginWriteConsistency_();
    var response;
    try {
      response=UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(ss.getId())+':batchUpdate',{
        method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},
        payload:JSON.stringify({requests:requests,includeSpreadsheetInResponse:false}),muteHttpExceptions:true
      });
    } catch (_) { throw new Error('STOP: Sheets batch outcome uncertain; inspect backup and rows before retry'); }
    if(response.getResponseCode()!==200) {
      throw new Error('STOP: Sheets API HTTP '+response.getResponseCode()+'; no fallback, verify state before retry');
    }
    SpreadsheetApp.flush();
    var fresh=SpreadsheetApp.openById(ss.getId());
    if(fresh.getId()!==ss.getId()) throw new Error('STOP: verification target mismatch');
    Object.keys(expected).forEach(function(name){
      var sh=fresh.getSheetByName(name);
      if(!sh || sh.getLastRow()<1 || sh.getLastColumn()!==plan.snapshots[name].columns.length ||
          JSON.stringify(normalized(sh.getRange(1,1,sh.getLastRow(),plan.snapshots[name].columns.length).getDisplayValues()))!==JSON.stringify(expected[name])) {
        throw new Error('STOP: post-cleanup rows differ: '+name);
      }
    });
    var backup=fresh.getSheetByName(backupName);
    if(!backup || !backup.isSheetHidden() || backup.getLastRow()!==93) {
      throw new Error('STOP: backup verification failed; inspect before retry');
    }
    var backupValues=backup.getRange(1,1,93,24).getDisplayValues();
    expectedBackup.forEach(function(row,index){
      if(JSON.stringify(backupValues[index].slice(0,row.length))!==JSON.stringify(row)) throw new Error('STOP: backup contents differ');
    });
    // Do not delete unrelated sessions or expose their tokens.
    function sessionSnapshot() {
      var all=props.getProperties(), result={};
      Object.keys(all).filter(function(k){return k.indexOf('session:')===0;}).sort().forEach(function(k){result[k]=all[k];});
      return result;
    }
    function equalSessions(a,b) {
      var k=Object.keys(a).sort(), j=Object.keys(b).sort();
      return JSON.stringify(k)===JSON.stringify(j) && k.every(function(key){return a[key]===b[key];});
    }
    if(!equalSessions(sessionSnapshot(),plan.sessionValues)) throw new Error('STOP: sessions changed; inspect separately');
    props.deleteProperty(plan.sessionKey);
    delete plan.sessionValues[plan.sessionKey];
    if(!equalSessions(sessionSnapshot(),plan.sessionValues)) throw new Error('STOP: session cleanup unverified');
    var result={test:'cancelled read-consistency TEST fixture cleanup',status:'PASS',
      removedRows:93,removedSessions:1,preservedSessions:6,backupRows:93,
      verifiedApplicationSheets:Object.keys(expected).length,backupRetained:true};
    Logger.log(JSON.stringify(result));return result;
  } finally {
    if(stable) finishWriteConsistency_(stable);
    lock.releaseLock();
  }
}
