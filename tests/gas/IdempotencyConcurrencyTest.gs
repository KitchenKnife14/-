/**
 * Run only from a bound, isolated TEST spreadsheet and TEST Apps Script project.
 * Never copy this file into the production Apps Script project.
 */
function runIdempotencyConcurrencyTest() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('IDEMPOTENCY_TEST_WEB_APP_URL') || '').trim();
  var token = String(props.getProperty('IDEMPOTENCY_TEST_TOKEN') || '').trim();
  var familyId = String(props.getProperty('IDEMPOTENCY_TEST_FAMILY_ID') || '').trim();
  var goalId = String(props.getProperty('IDEMPOTENCY_TEST_GOAL_ID') || '').trim();
  var confirmation = String(props.getProperty('IDEMPOTENCY_TEST_CONFIRM') || '');
  var productionScriptId = 'AKfycbxQLSZXG-R_AGZG5clVDGnMqd4_cwvwsPsf3_9mJ79Rnas7CZVeuIhtSi7FM5MMagkqqg';

  if (confirmation !== 'ISOLATED_TEST_ONLY') throw new Error('Тест не разрешён: подтвердите изолированную среду в Script Properties.');
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet || !/test|тест/i.test(spreadsheet.getName())) {
    throw new Error('Остановлено: активная таблица должна иметь TEST/ТЕСТ в названии.');
  }
  var match = url.match(/^https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec$/);
  if (!match || match[1] === productionScriptId) {
    throw new Error('Остановлено: нужен отдельный тестовый Apps Script Web App URL, не production URL.');
  }
  if (!token || !familyId || !goalId) throw new Error('Не заданы тестовые token, family ID или goal ID.');

  var goalBefore = idempotencyTestGetGoal_(url, token, familyId, goalId);
  var startBalance = Number(goalBefore.saved_kopecks || 0);
  if (!Number.isSafeInteger(startBalance) || startBalance < 0) throw new Error('У тестовой цели некорректный исходный остаток.');

  var contributionId = 'op_' + Utilities.getUuid().replace(/-/g, '').toLowerCase();
  var amount = 137;
  var payload = {
    id: contributionId, goal_id: goalId, amount_kopecks: amount,
    contribution_date: Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd'),
    note: 'Автотест идемпотентности ' + contributionId
  };
  var requestOptions = {
    url: url, method: 'post', contentType: 'application/json',
    payload: JSON.stringify({action:'query', token:token, table:'goal_contributions', mode:'insert', returning:true, values:payload}),
    muteHttpExceptions: true
  };

  var report = {test:'goal_contribution parallel idempotency', id:contributionId, amount_kopecks:amount};
  var cleanupError = null;
  try {
    var parallelResponses = UrlFetchApp.fetchAll([requestOptions, requestOptions]);
    var parallel = parallelResponses.map(function(response) { return idempotencyTestParseResponse_(response, 'parallel insert'); });
    if (parallel.some(function(result) { return !result.data || result.error; })) throw new Error('Один из параллельных insert-запросов завершился ошибкой.');
    if (parallel.some(function(result) {
      return !Array.isArray(result.data) || !result.data.length || String(result.data[0].id) !== contributionId;
    })) throw new Error('Параллельные ответы не вернули одну и ту же запись.');

    // Deliberately ignore the previous result and repeat with the same ID.
    var retry = idempotencyTestParseResponse_(UrlFetchApp.fetch(url, requestOptions), 'retry after discarded response');
    if (retry.error || !Array.isArray(retry.data) || !retry.data.length || String(retry.data[0].id) !== contributionId) {
      throw new Error('Повтор после условно потерянного ответа не вернул исходную запись.');
    }

    var rows = idempotencyTestPost_(url, {
      action:'query', token:token, table:'goal_contributions', mode:'select',
      filters:[{column:'goal_id', op:'eq', value:goalId}]
    });
    var matches = (rows.data || []).filter(function(row) { return String(row.id) === contributionId; });
    if (matches.length !== 1) throw new Error('Ожидалась ровно одна строка пополнения, найдено: ' + matches.length);

    var goalAfter = idempotencyTestGetGoal_(url, token, familyId, goalId);
    var expected = startBalance + amount;
    if (Number(goalAfter.saved_kopecks) !== expected) throw new Error('Баланс цели неверен: ожидалось ' + expected + ', получено ' + goalAfter.saved_kopecks);
    report.parallel_requests = 2;
    report.retry_requests = 1;
    report.rows_found = matches.length;
    report.balance_before_kopecks = startBalance;
    report.balance_after_kopecks = Number(goalAfter.saved_kopecks);
    report.result = 'PASS';
  } finally {
    try {
      var deleted = idempotencyTestPost_(url, {
        action:'query', token:token, table:'goal_contributions', mode:'delete',
        filters:[{column:'id', op:'eq', value:contributionId}]
      });
      if (deleted.error) throw new Error(deleted.error.message || 'delete failed');
      var restored = idempotencyTestGetGoal_(url, token, familyId, goalId);
      if (Number(restored.saved_kopecks) !== startBalance) throw new Error('Баланс тестовой цели не вернулся к исходному значению.');
      report.cleanup = 'PASS';
    } catch (error) {
      cleanupError = String(error && error.message || error);
      report.cleanup = 'FAILED';
      report.cleanup_error = cleanupError;
      report.manual_cleanup_id = contributionId;
    }
  }
  if (cleanupError) throw new Error('Очистка не подтверждена. ID для проверки: ' + contributionId + '. ' + cleanupError);
  Logger.log(JSON.stringify(report));
  return report;
}

function idempotencyTestGetGoal_(url, token, familyId, goalId) {
  var result = idempotencyTestPost_(url, {
    action:'query', token:token, table:'goals', mode:'select',
    filters:[{column:'id', op:'eq', value:goalId},{column:'family_id', op:'eq', value:familyId}],
    limit:1
  });
  if (result.error || !Array.isArray(result.data) || result.data.length !== 1) throw new Error('Тестовая цель не найдена или недоступна в указанной семье.');
  return result.data[0];
}
function idempotencyTestPost_(url, body) {
  return idempotencyTestParseResponse_(UrlFetchApp.fetch(url, {
    method:'post', contentType:'application/json', payload:JSON.stringify(body), muteHttpExceptions:true
  }), 'query');
}
function idempotencyTestParseResponse_(response, label) {
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error(label + ': HTTP ' + status);
  var parsed;
  try { parsed = JSON.parse(response.getContentText()); } catch (_) { throw new Error(label + ': ответ не является JSON'); }
  if (!parsed || typeof parsed !== 'object' || !Object.prototype.hasOwnProperty.call(parsed,'data') ||
      !Object.prototype.hasOwnProperty.call(parsed,'error')) throw new Error(label + ': некорректная форма API-ответа');
  return parsed;
}
