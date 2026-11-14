/**
 * Live TEST-only probe for idempotent goal contribution inserts.
 * Creates a synthetic user, family and goal; races duplicate requests,
 * retries the same request, verifies one row/one balance increment, then cleans up.
 *
 * Required Script Property:
 * GOAL_IDEMPOTENCY_TEST_WEB_APP_URL=<existing isolated TEST Web App /exec URL>
 *
 * Uses the shared allowlists:
 * BACKEND_DIAGNOSTICS_ALLOWED_SCRIPT_ID
 * GAS_TEST_ALLOWED_SPREADSHEET_ID
 */
function runGoalContributionIdempotencyRuntimeTest() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('GOAL_IDEMPOTENCY_TEST_WEB_APP_URL') || '').trim();
  var confirmation = String(props.getProperty('GOAL_IDEMPOTENCY_TEST_CONFIRM') || '');
  assertIsolatedGasTestEnvironment_(props, confirmation, url);

  var suffix = Utilities.getUuid().replace(/-/g, '').toLowerCase();
  var email = 'goal-idempotency+' + suffix + '@example.test';
  var password = 'temporary-goal-idempotency-' + suffix;
  var familyName = 'TEST goal idempotency ' + suffix;
  var goalId = 'goalidem_' + suffix;
  var contributionId = 'goalidem_contribution_' + suffix;
  var userId = '', token = '', familyId = '';
  var fixtureAttempted = false;
  var amount = 137;
  var report = {
    test: 'goal contribution duplicate parallel insert and retry',
    fixture: 'synthetic TEST-only',
    amount_kopecks: amount
  };
  var cleanupErrors = [];

  try {
    fixtureAttempted = true;
    var signup = goalIdempotencyPost_(url, {
      action:'signup', email:email, password:password, name:'Временный тест идемпотентности'
    });
    if (signup.error || !signup.data || !signup.data.token || !signup.data.user || !signup.data.user.id) {
      throw new Error('Не удалось создать временного пользователя: ' +
        (signup.error && signup.error.message || 'неожиданный ответ'));
    }
    token = String(signup.data.token);
    userId = String(signup.data.user.id);

    var family = goalIdempotencyPost_(url, {
      action:'createFamily', token:token, name:familyName
    });
    if (family.error || !family.data || !family.data.id) {
      throw new Error('Не удалось создать временную TEST-семью: ' +
        (family.error && family.error.message || 'неожиданный ответ'));
    }
    familyId = String(family.data.id);

    var goal = goalIdempotencyPost_(url, {
      action:'query', token:token, table:'goals', mode:'insert', returning:true,
      values:{
        id:goalId, family_id:familyId, name:'Временная цель для проверки идемпотентности',
        target_kopecks:100000, saved_kopecks:0, status:'active'
      }
    });
    if (goal.error || !Array.isArray(goal.data) || goal.data.length !== 1 ||
        String(goal.data[0].id) !== goalId || Number(goal.data[0].saved_kopecks) !== 0) {
      throw new Error('Не удалось создать чистую тестовую цель: ' +
        (goal.error && goal.error.message || 'неожиданный ответ'));
    }

    var today = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd');
    var payload = {
      action:'query', token:token, table:'goal_contributions', mode:'insert', returning:true,
      values:{
        id:contributionId, goal_id:goalId, amount_kopecks:amount,
        contribution_date:today, note:'Идемпотентный тест ' + suffix
      }
    };
    var requestOptions = {
      url:url, method:'post', contentType:'application/json',
      payload:JSON.stringify(payload), muteHttpExceptions:true
    };

    var parallelResponses = UrlFetchApp.fetchAll([requestOptions, requestOptions]);
    var parallelResults = parallelResponses.map(function(response, index) {
      return goalIdempotencyParse_(response, 'parallel duplicate insert ' + index);
    });
    parallelResults.forEach(function(result) {
      if (result.error || !Array.isArray(result.data) || result.data.length !== 1 ||
          String(result.data[0].id) !== contributionId) {
        throw new Error('Параллельные одинаковые insert-запросы не вернули одну и ту же запись: ' +
          (result.error && result.error.message || 'некорректный ответ'));
      }
    });

    // Simulate a lost first response: send the identical request once more.
    var retry = goalIdempotencyParse_(UrlFetchApp.fetch(url, requestOptions), 'retry after discarded response');
    if (retry.error || !Array.isArray(retry.data) || retry.data.length !== 1 ||
        String(retry.data[0].id) !== contributionId) {
      throw new Error('Повторный запрос не вернул исходную запись: ' +
        (retry.error && retry.error.message || 'некорректный ответ'));
    }

    var rows = goalIdempotencyPost_(url, {
      action:'query', token:token, table:'goal_contributions', mode:'select',
      filters:[{column:'goal_id', op:'eq', value:goalId}]
    });
    if (rows.error || !Array.isArray(rows.data)) throw new Error('Не удалось прочитать пополнения тестовой цели.');
    var matches = rows.data.filter(function(row) { return String(row.id) === contributionId; });
    if (matches.length !== 1) throw new Error('Ожидалась ровно одна строка пополнения, найдено: ' + matches.length);
    if (Number(matches[0].amount_kopecks) !== amount) throw new Error('Сумма сохранённого пополнения не совпала с запросом.');

    var refreshedGoal = goalIdempotencyPost_(url, {
      action:'query', token:token, table:'goals', mode:'select',
      filters:[{column:'id', op:'eq', value:goalId},{column:'family_id', op:'eq', value:familyId}],
      limit:1
    });
    if (refreshedGoal.error || !Array.isArray(refreshedGoal.data) || refreshedGoal.data.length !== 1 ||
        Number(refreshedGoal.data[0].saved_kopecks) !== amount) {
      throw new Error('Баланс цели должен увеличиться ровно один раз: ожидалось ' + amount +
        ', получено ' + (refreshedGoal.data && refreshedGoal.data[0] && refreshedGoal.data[0].saved_kopecks));
    }

    report.parallel_requests = 2;
    report.retry_requests = 1;
    report.rows_found = matches.length;
    report.balance_before_kopecks = 0;
    report.balance_after_kopecks = Number(refreshedGoal.data[0].saved_kopecks);
    report.result = 'PASS';
  } finally {
    if (fixtureAttempted) {
      try {
        // Recover IDs from persisted synthetic records if an HTTP response was lost.
        var authMatches = authRows_().filter(function(row) { return String(row.email) === email; });
        if (!userId && authMatches.length === 1) userId = String(authMatches[0].id);
        var familyMatches = userId ? rows_('families').filter(function(row) {
          return String(row.created_by) === userId && String(row.name) === familyName;
        }) : [];
        if (!familyId && familyMatches.length === 1) familyId = String(familyMatches[0].id);

        var contributionRows = rows_('goal_contributions').filter(function(row) {
          return String(row.id) === contributionId || (goalId && String(row.goal_id) === goalId);
        });
        if (contributionRows.length) deleteRows_('goal_contributions', contributionRows);

        if (goalId) {
          var goalRows = rows_('goals').filter(function(row) { return String(row.id) === goalId; });
          if (goalRows.length) deleteRows_('goals', goalRows);
        }
        if (familyId) {
          var purchaseRows = rows_('planned_purchases').filter(function(row) { return String(row.family_id) === familyId; });
          if (purchaseRows.length) deleteRows_('planned_purchases', purchaseRows);
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
        authMatches = authRows_().filter(function(row) { return String(row.email) === email; });
        authMatches.forEach(function(row) { authSheet_().deleteRow(row.row); });

        var allProperties = props.getProperties();
        Object.keys(allProperties).forEach(function(key) {
          if (key.indexOf('session:') !== 0) return;
          try {
            var session = JSON.parse(allProperties[key]);
            if (userId && String(session.userId) === userId) props.deleteProperty(key);
          } catch (_) {}
        });

        if (rows_('goal_contributions').some(function(row) {
              return String(row.id) === contributionId || String(row.goal_id) === goalId;
            }) ||
            rows_('goals').some(function(row) { return String(row.id) === goalId; }) ||
            (familyId && (rows_('families').some(function(row) { return String(row.id) === familyId; }) ||
              rows_('family_members').some(function(row) { return String(row.family_id) === familyId; }) ||
              rows_('categories').some(function(row) { return String(row.family_id) === familyId; }) ||
              rows_('planned_purchases').some(function(row) { return String(row.family_id) === familyId; }))) ||
            (userId && rows_('profiles').some(function(row) { return String(row.id) === userId; })) ||
            authRows_().some(function(row) { return String(row.email) === email; })) {
          throw new Error('После очистки остались синтетические записи.');
        }
        report.cleanup = 'PASS';
      } catch (error) {
        cleanupErrors.push(String(error && error.message || error));
        report.cleanup = 'FAILED';
        report.cleanup_errors = cleanupErrors;
        report.manual_cleanup_email = email;
        report.manual_cleanup_family_id = familyId || null;
        report.manual_cleanup_goal_id = goalId;
        report.manual_cleanup_contribution_id = contributionId;
      }
    }
  }

  if (cleanupErrors.length) {
    throw new Error('Очистка TEST-фикстуры не подтверждена: ' + cleanupErrors.join('; ') +
      '. Email: ' + email + ', goal ID: ' + goalId);
  }
  Logger.log(JSON.stringify(report));
  return report;
}

function goalIdempotencyPost_(url, body) {
  return goalIdempotencyParse_(UrlFetchApp.fetch(url, {
    method:'post', contentType:'application/json',
    payload:JSON.stringify(body), muteHttpExceptions:true
  }), 'request');
}

function goalIdempotencyParse_(response, label) {
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
