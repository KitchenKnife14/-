/**
 * Real Google Apps Script concurrency probe for one shared monthly-plan row.
 * Run ONLY in an isolated TEST spreadsheet and TEST Apps Script deployment.
 * Requires two test users in the same test family and a dedicated test category.
 */
function runMonthlyPlanConcurrencyTest() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('MONTHLY_PLAN_TEST_WEB_APP_URL') || '').trim();
  var tokenA = String(props.getProperty('MONTHLY_PLAN_TEST_TOKEN_A') || '').trim();
  var tokenB = String(props.getProperty('MONTHLY_PLAN_TEST_TOKEN_B') || '').trim();
  var familyId = String(props.getProperty('MONTHLY_PLAN_TEST_FAMILY_ID') || '').trim();
  var categoryId = String(props.getProperty('MONTHLY_PLAN_TEST_CATEGORY_ID') || '').trim();
  var confirmation = String(props.getProperty('MONTHLY_PLAN_TEST_CONFIRM') || '');
  var productionScriptId = 'AKfycbxQLSZXG-R_AGZG5clVDGnMqd4_cwvwsPsf3_9mJ79Rnas7CZVeuIhtSi7FM5MMagkqqg';

  assertIsolatedGasTestEnvironment_(props, confirmation, url);
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet || !/test|тест/i.test(spreadsheet.getName())) throw new Error('Остановлено: нужна таблица TEST/ТЕСТ.');
  var match = url.match(/^https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec$/);
  if (!match || match[1] === productionScriptId) throw new Error('Остановлено: нужен отдельный TEST Web App URL.');
  if (!tokenA || !tokenB || !familyId || !categoryId) throw new Error('Не заданы два тестовых токена, family ID или выделенная category ID.');

  var month = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM') + '-01';
  var key = {family_id:familyId, month_date:month, category_id:categoryId, type:'expense'};
  var id = 'monthrace_' + Utilities.getUuid().replace(/-/g, '').toLowerCase();
  var created = false;
  var report = {test:'concurrent optimistic monthly-plan update', plan_id:id};
  var cleanupError = null;

  try {
    created = true;
    var inserted = monthlyPlanTestPost_(url, {
      action:'query', token:tokenA, table:'monthly_plans', mode:'upsert',
      onConflict:'family_id,month_date,category_id,type', returning:true,
      values:Object.assign({id:id, planned_kopecks:10000, note:'Исходный тестовый план'}, key)
    });
    if (inserted.error || !Array.isArray(inserted.data) || inserted.data.length !== 1 ||
        String(inserted.data[0].id) !== id) {
      throw new Error('Не удалось создать изолированный тестовый план: ' + (inserted.error && inserted.error.message || 'неожиданный ответ'));
    }

    var selected = monthlyPlanTestPost_(url, {
      action:'query', token:tokenA, table:'monthly_plans', mode:'select',
      filters:[{column:'id', op:'eq', value:id}], limit:1
    });
    if (selected.error || !Array.isArray(selected.data) || selected.data.length !== 1) throw new Error('Не удалось получить снимок тестового плана.');
    var snapshot = selected.data[0];

    var requests = [
      {token:tokenA, planned:12000, note:'Изменение участника A'},
      {token:tokenB, planned:15000, note:'Изменение участника B'}
    ].map(function(item) {
      return {
        url:url, method:'post', contentType:'application/json', muteHttpExceptions:true,
        payload:JSON.stringify({
          action:'query', token:item.token, table:'monthly_plans', mode:'upsert',
          onConflict:'family_id,month_date,category_id,type', expectedRows:[snapshot],
          values:Object.assign({planned_kopecks:item.planned, note:item.note}, key)
        })
      };
    });

    var results = UrlFetchApp.fetchAll(requests).map(function(response, index) {
      return monthlyPlanTestParse_(response, 'parallel update ' + index);
    });
    var successes = results.filter(function(result) { return !result.error; });
    var stale = results.filter(function(result) {
      return result.error && /изменён другим участником|изменен другим участником/i.test(String(result.error.message || ''));
    });
    if (successes.length !== 1 || stale.length !== 1) {
      throw new Error('Ожидался один успешный upsert и один отказ по устаревшему снимку; success=' +
        successes.length + ', stale=' + stale.length + ', errors=' +
        results.map(function(result) { return result.error && result.error.message || ''; }).join(' | '));
    }

    var final = monthlyPlanTestPost_(url, {
      action:'query', token:tokenA, table:'monthly_plans', mode:'select',
      filters:[{column:'id', op:'eq', value:id}], limit:1
    });
    if (final.error || !Array.isArray(final.data) || final.data.length !== 1) throw new Error('Итоговый план не найден.');
    var winner = final.data[0];
    if ([12000,15000].indexOf(Number(winner.planned_kopecks)) === -1) throw new Error('Итоговая сумма не совпадает ни с одним допустимым конкурентным изменением.');
    report.concurrent_requests = 2;
    report.successful_updates = 1;
    report.stale_updates_rejected = 1;
    report.final_amount_kopecks = Number(winner.planned_kopecks);
    report.result = 'PASS';
  } finally {
    if (created) {
      try {
        var deleted = monthlyPlanTestPost_(url, {
          action:'query', token:tokenA, table:'monthly_plans', mode:'delete',
          filters:[{column:'id', op:'eq', value:id}]
        });
        if (deleted.error) throw new Error(deleted.error.message || 'delete failed');
        var verify = monthlyPlanTestPost_(url, {
          action:'query', token:tokenA, table:'monthly_plans', mode:'select',
          filters:[{column:'id', op:'eq', value:id}], limit:1
        });
        if (verify.error || !Array.isArray(verify.data) || verify.data.length !== 0) throw new Error('Тестовый план остался после очистки.');
        report.cleanup = 'PASS';
      } catch (error) {
        cleanupError = String(error && error.message || error);
        report.cleanup = 'FAILED';
        report.cleanup_error = cleanupError;
        report.manual_cleanup_id = id;
      }
    }
  }
  if (cleanupError) throw new Error('Не подтверждена очистка тестового плана ' + id + ': ' + cleanupError);
  Logger.log(JSON.stringify(report));
  return report;
}

function monthlyPlanTestPost_(url, body) {
  return monthlyPlanTestParse_(UrlFetchApp.fetch(url, {
    method:'post', contentType:'application/json', payload:JSON.stringify(body), muteHttpExceptions:true
  }), 'query');
}
function monthlyPlanTestParse_(response, label) {
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error(label + ': HTTP ' + status);
  var parsed;
  try { parsed = JSON.parse(response.getContentText()); } catch (_) { throw new Error(label + ': ответ не является JSON'); }
  if (!parsed || typeof parsed !== 'object' || !Object.prototype.hasOwnProperty.call(parsed,'data') ||
      !Object.prototype.hasOwnProperty.call(parsed,'error')) throw new Error(label + ': некорректная форма API-ответа');
  return parsed;
}
