/**
 * Real GAS concurrency probe: two family members insert separate transactions
 * into the same sheet at the same time. TEST spreadsheet/deployment only.
 *
 * Script Properties:
 * TRANSACTION_CONCURRENCY_TEST_CONFIRM=ISOLATED_TEST_ONLY
 * TRANSACTION_CONCURRENCY_TEST_WEB_APP_URL=<test deployment /exec URL>
 * TRANSACTION_CONCURRENCY_TEST_TOKEN_A=<test user A session token>
 * TRANSACTION_CONCURRENCY_TEST_TOKEN_B=<test user B session token>
 * TRANSACTION_CONCURRENCY_TEST_FAMILY_ID=<shared test family ID>
 */
function runTransactionConcurrencyTest() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('TRANSACTION_CONCURRENCY_TEST_WEB_APP_URL') || '').trim();
  var tokenA = String(props.getProperty('TRANSACTION_CONCURRENCY_TEST_TOKEN_A') || '').trim();
  var tokenB = String(props.getProperty('TRANSACTION_CONCURRENCY_TEST_TOKEN_B') || '').trim();
  var familyId = String(props.getProperty('TRANSACTION_CONCURRENCY_TEST_FAMILY_ID') || '').trim();
  var confirmation = String(props.getProperty('TRANSACTION_CONCURRENCY_TEST_CONFIRM') || '');
  assertIsolatedGasTestEnvironment_(props, confirmation, url);
  if (!tokenA || !tokenB || !familyId) throw new Error('Не заданы два тестовых токена и ID тестовой семьи.');

  var suffix = Utilities.getUuid().replace(/-/g, '').toLowerCase();
  var idA = 'txrace_a_' + suffix;
  var idB = 'txrace_b_' + suffix;
  var date = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd');
  var report = {test:'concurrent transaction inserts by two family members', transaction_ids:[idA,idB]};
  var cleanupErrors = [];

  try {
    var requests = [
      {token:tokenA, id:idA, amount:12345, description:'Concurrent transaction A'},
      {token:tokenB, id:idB, amount:67890, description:'Concurrent transaction B'}
    ].map(function(item) {
      return {
        url:url, method:'post', contentType:'application/json', muteHttpExceptions:true,
        payload:JSON.stringify({
          action:'query', token:item.token, table:'transactions', mode:'insert', returning:true,
          values:{
            id:item.id, family_id:familyId, type:'expense', amount_kopecks:item.amount,
            operation_date:date, description:item.description
          }
        })
      };
    });

    var fetchAllStarted = Date.now();
    var parallelResponses = UrlFetchApp.fetchAll(requests);
    report.concurrentFetchAllMs = Date.now() - fetchAllStarted;
    var results = parallelResponses.map(function(response, index) {
      return transactionConcurrencyParse_(response, 'parallel insert ' + index);
    });
    if (results.some(function(result) {
      return result.error || !Array.isArray(result.data) || result.data.length !== 1;
    })) {
      throw new Error('Один или оба параллельных insert завершились ошибкой: ' +
        results.map(function(result) { return result.error && result.error.message || ''; }).join(' | '));
    }

    var rows = transactionConcurrencyPost_(url, tokenA, {
      action:'query', table:'transactions', mode:'select',
      filters:[{column:'id', op:'in', values:[idA,idB]}], limit:5
    });
    if (rows.error || !Array.isArray(rows.data) || rows.data.length !== 2) {
      throw new Error('После двух одновременных записей ожидались ровно две операции.');
    }
    var byId = {};
    rows.data.forEach(function(row) { byId[String(row.id)] = row; });
    if (!byId[idA] || !byId[idB] ||
        Number(byId[idA].amount_kopecks) !== 12345 ||
        Number(byId[idB].amount_kopecks) !== 67890 ||
        rows.data.some(function(row) { return String(row.family_id) !== familyId; })) {
      throw new Error('Сохранённые строки не совпадают с двумя отправленными запросами или семейным ID.');
    }
    report.concurrent_requests = 2;
    report.transactions_saved = 2;
    report.amounts_kopecks = [12345,67890];
    report.result = 'PASS';
  } finally {
    [idA,idB].forEach(function(id) {
      try {
        var removed = transactionConcurrencyPost_(url, tokenA, {
          action:'query', table:'transactions', mode:'delete',
          filters:[{column:'id', op:'eq', value:id}]
        });
        if (removed.error) throw new Error(removed.error.message || 'delete failed');
        var verify = transactionConcurrencyPost_(url, tokenA, {
          action:'query', table:'transactions', mode:'select',
          filters:[{column:'id', op:'eq', value:id}], limit:1
        });
        if (verify.error || !Array.isArray(verify.data) || verify.data.length !== 0) {
          throw new Error('Тестовая операция осталась после очистки.');
        }
      } catch (error) {
        cleanupErrors.push(id + ': ' + String(error && error.message || error));
      }
    });
    report.cleanup = cleanupErrors.length ? 'FAILED' : 'PASS';
    if (cleanupErrors.length) report.cleanup_errors = cleanupErrors;
  }
  if (cleanupErrors.length) throw new Error('Не подтверждена очистка тестовых операций: ' + cleanupErrors.join(' | '));
  Logger.log(JSON.stringify(report));
  return report;
}

function transactionConcurrencyPost_(url, token, body) {
  body.token = token;
  return transactionConcurrencyParse_(UrlFetchApp.fetch(url, {
    method:'post', contentType:'application/json', payload:JSON.stringify(body), muteHttpExceptions:true
  }), 'query');
}
function transactionConcurrencyParse_(response, label) {
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error(label + ': HTTP ' + status);
  var parsed;
  try { parsed = JSON.parse(response.getContentText()); }
  catch (_) { throw new Error(label + ': ответ не является JSON'); }
  if (!parsed || typeof parsed !== 'object' ||
      !Object.prototype.hasOwnProperty.call(parsed,'data') ||
      !Object.prototype.hasOwnProperty.call(parsed,'error')) {
    throw new Error(label + ': некорректная форма API-ответа');
  }
  return parsed;
}
