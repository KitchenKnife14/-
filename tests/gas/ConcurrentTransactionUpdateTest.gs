/**
 * Real Apps Script probe: two concurrent edits target the same transaction
 * using the same optimistic snapshot. Exactly one edit must commit; the stale
 * edit must be rejected instead of silently overwriting the winner.
 *
 * Run ONLY in an isolated TEST spreadsheet and TEST Apps Script deployment.
 */
function runConcurrentTransactionUpdateTest() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('CONCURRENT_ROW_TEST_WEB_APP_URL') || '').trim();
  var token = String(props.getProperty('CONCURRENT_ROW_TEST_TOKEN') || '').trim();
  var familyId = String(props.getProperty('CONCURRENT_ROW_TEST_FAMILY_ID') || '').trim();
  var accountId = String(props.getProperty('CONCURRENT_ROW_TEST_ACCOUNT_ID') || '').trim();
  var confirmation = String(props.getProperty('CONCURRENT_ROW_TEST_CONFIRM') || '');
  var productionScriptId = 'AKfycbxQLSZXG-R_AGZG5clVDGnMqd4_cwvwsPsf3_9mJ79Rnas7CZVeuIhtSi7FM5MMagkqqg';
  if (confirmation !== 'ISOLATED_TEST_ONLY') throw new Error('Тест не разрешён: подтвердите изолированную среду.');
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet || !/test|тест/i.test(spreadsheet.getName())) throw new Error('Остановлено: нужна таблица TEST/ТЕСТ.');
  var match = url.match(/^https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec$/);
  if (!match || match[1] === productionScriptId) throw new Error('Остановлено: нужен отдельный TEST Web App URL.');
  if (!token || !familyId || !accountId) throw new Error('Не заданы тестовые token, family ID или account ID.');

  var id = 'rowrace_' + Utilities.getUuid().replace(/-/g, '').toLowerCase();
  var today = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd');
  var created = false, cleanupError = null;
  var report = {test:'concurrent optimistic update of one transaction', transaction_id:id};
  try {
    created = true; // include ambiguous HTTP outcomes in cleanup
    var inserted = concurrentRowTestPost_(url, {
      action:'query', token:token, table:'transactions', mode:'insert', returning:true,
      values:{
        id:id, family_id:familyId, type:'expense', amount_kopecks:137,
        operation_date:today, operation_time:'12:00', category_id:null,
        account_id:accountId, to_account_id:null,
        description:'Тест конкурентного изменения', planned:false
      }
    });
    if (inserted.error || !Array.isArray(inserted.data) || inserted.data.length !== 1 ||
        String(inserted.data[0].id) !== id) throw new Error('Не удалось создать тестовую операцию: ' + (inserted.error && inserted.error.message || 'неожиданный ответ'));
    var snapshot = inserted.data[0];
    var values = ['Конкурентное изменение A', 'Конкурентное изменение B'];
    var requests = values.map(function(description) {
      return {
        url:url, method:'post', contentType:'application/json', muteHttpExceptions:true,
        payload:JSON.stringify({
          action:'query', token:token, table:'transactions', mode:'update',
          filters:[{column:'id', op:'eq', value:id}],
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
      filters:[{column:'id', op:'eq', value:id}], limit:1
    });
    if (finalRows.error || !Array.isArray(finalRows.data) || finalRows.data.length !== 1 ||
        values.indexOf(String(finalRows.data[0].description)) === -1) {
      throw new Error('Итоговая запись не содержит ни одного из двух допустимых изменений.');
    }
    report.successful_updates = 1;
    report.stale_updates_rejected = 1;
    report.final_description = finalRows.data[0].description;
    report.result = 'PASS';
  } finally {
    if (created) {
      try {
        var deleted = concurrentRowTestPost_(url, {
          action:'query', token:token, table:'transactions', mode:'delete',
          filters:[{column:'id', op:'eq', value:id}]
        });
        if (deleted.error) throw new Error(deleted.error.message || 'delete failed');
        var verify = concurrentRowTestPost_(url, {
          action:'query', token:token, table:'transactions', mode:'select',
          filters:[{column:'id', op:'eq', value:id}]
        });
        if (verify.error || !Array.isArray(verify.data) || verify.data.length !== 0) {
          throw new Error('Тестовая операция осталась после очистки.');
        }
        report.cleanup = 'PASS';
      } catch (error) {
        cleanupError = String(error && error.message || error);
        report.cleanup = 'FAILED';
        report.cleanup_error = cleanupError;
        report.manual_cleanup_id = id;
      }
    }
  }
  if (cleanupError) throw new Error('Очистка не подтверждена. Проверьте transaction ID ' + id + ': ' + cleanupError);
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
