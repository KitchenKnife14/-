/**
 * Real Apps Script probe: provision a disposable TEST user/family/account,
 * then race two optimistic updates against one transaction snapshot.
 * All fixture data is synthetic and removed in finally.
 *
 * Required Script Properties:
 * CONCURRENT_ROW_TEST_WEB_APP_URL
 * CONCURRENT_ROW_TEST_CONFIRM=ISOLATED_TEST_ONLY
 * Shared TEST allowlists are checked by IsolatedTestGuard.gs.
 */
function runConcurrentTransactionUpdateTest() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('CONCURRENT_ROW_TEST_WEB_APP_URL') || '').trim();
  var confirmation = String(props.getProperty('CONCURRENT_ROW_TEST_CONFIRM') || '');
  assertIsolatedGasTestEnvironment_(props, confirmation, url);

  var suffix = Utilities.getUuid().replace(/-/g, '').toLowerCase();
  var email = 'rowrace+' + suffix + '@example.test';
  var password = 'temporary-concurrency-probe-' + suffix;
  var familyName = 'TEST concurrency fixture ' + suffix;
  var userId = '', token = '', familyId = '', accountId = '';
  var transactionId = 'rowrace_' + suffix;
  var fixtureAttempted = false;
  var report = {test:'concurrent optimistic update of one transaction', fixture:'synthetic TEST-only'};
  var cleanupErrors = [];

  try {
    fixtureAttempted = true;
    var signup = concurrentRowTestPost_(url, {
      action:'signup', email:email, password:password, name:'Временный тестовый пользователь'
    });
    if (signup.error || !signup.data || !signup.data.token || !signup.data.user) {
      throw new Error('Не удалось создать временного тестового пользователя: ' +
        (signup.error && signup.error.message || 'неожиданный ответ'));
    }
    token = String(signup.data.token);
    userId = String(signup.data.user.id);

    var family = concurrentRowTestPost_(url, {
      action:'createFamily', token:token, name:familyName
    });
    if (family.error || !family.data || !family.data.id) {
      throw new Error('Не удалось создать временную TEST-семью: ' +
        (family.error && family.error.message || 'неожиданный ответ'));
    }
    familyId = String(family.data.id);

    accountId = 'rowrace_account_' + suffix;
    var account = concurrentRowTestPost_(url, {
      action:'query', token:token, table:'accounts', mode:'insert', returning:true,
      values:{
        id:accountId, family_id:familyId, name:'Временный тестовый счёт',
        kind:'bank', owner_user_id:userId, starting_balance_kopecks:0, archived:false
      }
    });
    if (account.error || !Array.isArray(account.data) || account.data.length !== 1 ||
        String(account.data[0].id) !== accountId) {
      throw new Error('Не удалось создать временный TEST-счёт: ' +
        (account.error && account.error.message || 'неожиданный ответ'));
    }

    var today = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd');
    var inserted = concurrentRowTestPost_(url, {
      action:'query', token:token, table:'transactions', mode:'insert', returning:true,
      values:{
        id:transactionId, family_id:familyId, type:'expense', amount_kopecks:137,
        operation_date:today, operation_time:'12:00', category_id:null,
        account_id:accountId, to_account_id:null,
        description:'Тест конкурентного изменения', planned:false
      }
    });
    if (inserted.error || !Array.isArray(inserted.data) || inserted.data.length !== 1 ||
        String(inserted.data[0].id) !== transactionId) {
      throw new Error('Не удалось создать тестовую операцию: ' +
        (inserted.error && inserted.error.message || 'неожиданный ответ'));
    }

    var selected = concurrentRowTestPost_(url, {
      action:'query', token:token, table:'transactions', mode:'select',
      filters:[{column:'id', op:'eq', value:transactionId}], limit:1
    });
    if (selected.error || !Array.isArray(selected.data) || selected.data.length !== 1) {
      throw new Error('Не удалось получить полный снимок тестовой операции.');
    }
    var snapshot = selected.data[0];
    var values = ['Конкурентное изменение A', 'Конкурентное изменение B'];
    var requests = values.map(function(description) {
      return {
        url:url, method:'post', contentType:'application/json', muteHttpExceptions:true,
        payload:JSON.stringify({
          action:'query', token:token, table:'transactions', mode:'update',
          filters:[{column:'id', op:'eq', value:transactionId}],
          values:{description:description}, expected:snapshot, returning:true
        })
      };
    });
    var responses = UrlFetchApp.fetchAll(requests);
    var results = responses.map(function(response, index) {
      return concurrentRowTestParse_(response, 'concurrent update ' + index);
    });
    var successes = results.filter(function(result) { return !result.error; });
    var stale = results.filter(function(result) {
      return result.error && /изменен|изменён|обновите данные/i.test(String(result.error.message || ''));
    });
    if (successes.length !== 1 || stale.length !== 1) {
      throw new Error('Ожидался один успешный update и один отказ по stale snapshot; получено success=' +
        successes.length + ', stale=' + stale.length + ', errors=' +
        results.map(function(r){return r.error && r.error.message || '';}).join(' | '));
    }
    var finalRows = concurrentRowTestPost_(url, {
      action:'query', token:token, table:'transactions', mode:'select',
      filters:[{column:'id', op:'eq', value:transactionId}], limit:1
    });
    if (finalRows.error || !Array.isArray(finalRows.data) || finalRows.data.length !== 1 ||
        values.indexOf(String(finalRows.data[0].description)) === -1) {
      throw new Error('Итоговая запись не содержит ни одного из двух допустимых изменений.');
    }
    report.successful_updates = 1;
    report.stale_updates_rejected = 1;
    report.result = 'PASS';
  } finally {
    if (fixtureAttempted) {
      try {
        // Resolve IDs even if an HTTP response was lost after the server committed.
        var authMatches = authRows_().filter(function(row) { return row.email === email; });
        if (!userId && authMatches.length === 1) userId = authMatches[0].id;
        var familyMatches = userId ? rows_('families').filter(function(row) {
          return String(row.created_by) === userId && String(row.name) === familyName;
        }) : [];
        if (!familyId && familyMatches.length === 1) familyId = String(familyMatches[0].id);

        if (transactionId) {
          var txRows = rows_('transactions').filter(function(row) { return String(row.id) === transactionId; });
          if (txRows.length) deleteRows_('transactions', txRows);
          if (rows_('transactions').some(function(row) { return String(row.id) === transactionId; })) {
            throw new Error('Тестовая операция осталась после очистки.');
          }
        }
        if (accountId) {
          var accountRows = rows_('accounts').filter(function(row) { return String(row.id) === accountId; });
          if (accountRows.length) deleteRows_('accounts', accountRows);
          if (rows_('accounts').some(function(row) { return String(row.id) === accountId; })) {
            throw new Error('Тестовый счёт остался после очистки.');
          }
        }
        if (familyId) {
          var categoryRows = rows_('categories').filter(function(row) { return String(row.family_id) === familyId; });
          if (categoryRows.length) deleteRows_('categories', categoryRows);
          var memberRows = rows_('family_members').filter(function(row) { return String(row.family_id) === familyId; });
          if (memberRows.length) deleteRows_('family_members', memberRows);
          var familyRows = rows_('families').filter(function(row) { return String(row.id) === familyId; });
          if (familyRows.length) deleteRows_('families', familyRows);
        }
        if (userId) {
          var profileRows = rows_('profiles').filter(function(row) { return String(row.id) === userId; });
          if (profileRows.length) deleteRows_('profiles', profileRows);
        }
        authMatches = authRows_().filter(function(row) { return row.email === email; });
        authMatches.forEach(function(row) { authSheet_().deleteRow(row.row); });
        var allProperties = props.getProperties();
        Object.keys(allProperties).forEach(function(key) {
          if (key.indexOf('session:') !== 0) return;
          try {
            var session = JSON.parse(allProperties[key]);
            if (String(session.userId) === userId) props.deleteProperty(key);
          } catch (_) {}
        });

        if ((transactionId && rows_('transactions').some(function(row) { return String(row.id) === transactionId; })) ||
            (accountId && rows_('accounts').some(function(row) { return String(row.id) === accountId; })) ||
            (familyId && (rows_('families').some(function(row) { return String(row.id) === familyId; }) ||
              rows_('family_members').some(function(row) { return String(row.family_id) === familyId; }) ||
              rows_('categories').some(function(row) { return String(row.family_id) === familyId; }))) ||
            (userId && rows_('profiles').some(function(row) { return String(row.id) === userId; })) ||
            authRows_().some(function(row) { return row.email === email; })) {
          throw new Error('После очистки обнаружены оставшиеся синтетические записи.');
        }
        report.cleanup = 'PASS';
      } catch (error) {
        cleanupErrors.push(String(error && error.message || error));
        report.cleanup = 'FAILED';
        report.cleanup_errors = cleanupErrors;
        report.manual_cleanup_email = email;
        report.manual_cleanup_family_id = familyId || null;
        report.manual_cleanup_account_id = accountId || null;
        report.manual_cleanup_transaction_id = transactionId;
      }
    }
  }
  if (cleanupErrors.length) {
    throw new Error('Очистка TEST-фикстуры не подтверждена: ' + cleanupErrors.join('; ') +
      '. Email: ' + email + ', family ID: ' + (familyId || 'unknown'));
  }
  Logger.log(JSON.stringify(report));
  return report;
}

function concurrentRowTestPost_(url, body) {
  return concurrentRowTestParse_(UrlFetchApp.fetch(url, {
    method:'post', contentType:'application/json', payload:JSON.stringify(body), muteHttpExceptions:true
  }), 'request');
}
function concurrentRowTestParse_(response, label) {
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error(label + ': HTTP ' + status);
  var parsed;
  try { parsed = JSON.parse(response.getContentText()); }
  catch (_) { throw new Error(label + ': ответ не является JSON'); }
  if (!parsed || typeof parsed !== 'object' ||
      !Object.prototype.hasOwnProperty.call(parsed, 'data') ||
      !Object.prototype.hasOwnProperty.call(parsed, 'error')) {
    throw new Error(label + ': некорректная форма API-ответа');
  }
  return parsed;
}
