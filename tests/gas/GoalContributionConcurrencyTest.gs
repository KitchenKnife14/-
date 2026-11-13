/**
 * Real GAS concurrency probe: two family members add separate contributions
 * to one shared goal at the same time. TEST spreadsheet/deployment only.
 */
function runGoalContributionConcurrencyTest() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('GOAL_TEST_WEB_APP_URL') || '').trim();
  var tokenA = String(props.getProperty('GOAL_TEST_TOKEN_A') || '').trim();
  var tokenB = String(props.getProperty('GOAL_TEST_TOKEN_B') || '').trim();
  var familyId = String(props.getProperty('GOAL_TEST_FAMILY_ID') || '').trim();
  var confirmation = String(props.getProperty('GOAL_TEST_CONFIRM') || '');
  var productionScriptId = 'AKfycbxQLSZXG-R_AGZG5clVDGnMqd4_cwvwsPsf3_9mJ79Rnas7CZVeuIhtSi7FM5MMagkqqg';
  assertIsolatedGasTestEnvironment_(props, confirmation, url);
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet || !/test|тест/i.test(spreadsheet.getName())) throw new Error('Остановлено: нужна таблица TEST/ТЕСТ.');
  var match = url.match(/^https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec$/);
  if (!match || match[1] === productionScriptId) throw new Error('Остановлено: нужен отдельный TEST Web App URL.');
  if (!tokenA || !tokenB || !familyId) throw new Error('Не заданы два тестовых токена и ID тестовой семьи.');

  var suffix = Utilities.getUuid().replace(/-/g, '').toLowerCase();
  var goalId = 'goalrace_' + suffix;
  var contributionA = 'goalrace_a_' + suffix;
  var contributionB = 'goalrace_b_' + suffix;
  var createdGoal = false, report = {test:'concurrent goal contributions', goal_id:goalId}, cleanupError = null;
  try {
    var goal = goalTestPost_(url, {
      action:'query', token:tokenA, table:'goals', mode:'insert', returning:true,
      values:{id:goalId, family_id:familyId, name:'Тест конкурентных пополнений', target_kopecks:100000, status:'active'}
    });
    if (goal.error || !Array.isArray(goal.data) || goal.data.length !== 1 || String(goal.data[0].id) !== goalId) {
      throw new Error('Не удалось создать тестовую цель: ' + (goal.error && goal.error.message || 'неожиданный ответ'));
    }
    createdGoal = true;
    var date = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd');
    var requests = [
      {token:tokenA, id:contributionA, amount:12500, note:'Параллельный взнос A'},
      {token:tokenB, id:contributionB, amount:27500, note:'Параллельный взнос B'}
    ].map(function(item) {
      return {
        url:url, method:'post', contentType:'application/json', muteHttpExceptions:true,
        payload:JSON.stringify({
          action:'query', token:item.token, table:'goal_contributions', mode:'insert', returning:true,
          values:{id:item.id, goal_id:goalId, amount_kopecks:item.amount, contribution_date:date, note:item.note}
        })
      };
    });
    var results = UrlFetchApp.fetchAll(requests).map(function(response, index) {
      return goalTestParse_(response, 'parallel contribution ' + index);
    });
    if (results.some(function(result) { return result.error || !Array.isArray(result.data) || result.data.length !== 1; })) {
      throw new Error('Один или оба параллельных взноса не сохранены: ' +
        results.map(function(result) { return result.error && result.error.message || ''; }).join(' | '));
    }
    var contributions = goalTestPost_(url, {
      action:'query', token:tokenA, table:'goal_contributions', mode:'select',
      filters:[{column:'goal_id', op:'eq', value:goalId}], limit:10
    });
    if (contributions.error || !Array.isArray(contributions.data) || contributions.data.length !== 2) {
      throw new Error('Ожидалось ровно два сохранённых взноса.');
    }
    var amounts = contributions.data.map(function(row) { return Number(row.amount_kopecks); }).sort(function(a,b) { return a-b; });
    if (amounts[0] !== 12500 || amounts[1] !== 27500) throw new Error('Суммы взносов не совпали с отправленными.');
    var refreshedGoal = goalTestPost_(url, {
      action:'query', token:tokenA, table:'goals', mode:'select',
      filters:[{column:'id', op:'eq', value:goalId}], limit:1
    });
    if (refreshedGoal.error || !Array.isArray(refreshedGoal.data) || refreshedGoal.data.length !== 1 ||
        Number(refreshedGoal.data[0].saved_kopecks) !== 40000) {
      throw new Error('Итог накоплений цели должен составлять 40000 копеек.');
    }
    report.concurrent_requests = 2;
    report.contributions_saved = 2;
    report.total_kopecks = 40000;
    report.result = 'PASS';
  } finally {
    if (createdGoal) {
      try {
        var removed = goalTestPost_(url, {
          action:'query', token:tokenA, table:'goal_contributions', mode:'delete',
          filters:[{column:'goal_id', op:'eq', value:goalId}]
        });
        if (removed.error) throw new Error(removed.error.message || 'contribution cleanup failed');
        var goalRemoved = goalTestPost_(url, {
          action:'query', token:tokenA, table:'goals', mode:'delete',
          filters:[{column:'id', op:'eq', value:goalId}]
        });
        if (goalRemoved.error) throw new Error(goalRemoved.error.message || 'goal cleanup failed');
        var verify = goalTestPost_(url, {
          action:'query', token:tokenA, table:'goals', mode:'select',
          filters:[{column:'id', op:'eq', value:goalId}], limit:1
        });
        if (verify.error || !Array.isArray(verify.data) || verify.data.length !== 0) throw new Error('Тестовая цель осталась после очистки.');
        report.cleanup = 'PASS';
      } catch (error) {
        cleanupError = String(error && error.message || error);
        report.cleanup = 'FAILED';
        report.cleanup_error = cleanupError;
        report.manual_cleanup_id = goalId;
      }
    }
  }
  if (cleanupError) throw new Error('Не подтверждена очистка тестовой цели ' + goalId + ': ' + cleanupError);
  Logger.log(JSON.stringify(report));
  return report;
}
function goalTestPost_(url, body) {
  return goalTestParse_(UrlFetchApp.fetch(url, {
    method:'post', contentType:'application/json', payload:JSON.stringify(body), muteHttpExceptions:true
  }), 'query');
}
function goalTestParse_(response, label) {
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error(label + ': HTTP ' + status);
  var parsed;
  try { parsed = JSON.parse(response.getContentText()); } catch (_) { throw new Error(label + ': ответ не является JSON'); }
  if (!parsed || typeof parsed !== 'object' || !Object.prototype.hasOwnProperty.call(parsed,'data') ||
      !Object.prototype.hasOwnProperty.call(parsed,'error')) throw new Error(label + ': некорректная форма API-ответа');
  return parsed;
}
