/**
 * Real concurrent Telegram update replay probe.
 * Run ONLY in a bound isolated TEST spreadsheet / TEST Apps Script project.
 * Uses an existing Telegram link in the test family; it does not call Telegram API.
 * It creates one synthetic expense and removes it, then clears its replay-cache key.
 */
function runTelegramUpdateConcurrencyTest() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('TELEGRAM_CONCURRENCY_TEST_WEB_APP_URL') || '').trim();
  var token = String(props.getProperty('TELEGRAM_CONCURRENCY_TEST_TOKEN') || '').trim();
  var backendSecret = String(props.getProperty('TELEGRAM_BACKEND_SECRET') || '').trim();
  var familyId = String(props.getProperty('TELEGRAM_CONCURRENCY_TEST_FAMILY_ID') || '').trim();
  var telegramUserId = String(props.getProperty('TELEGRAM_CONCURRENCY_TEST_USER_ID') || '').trim();
  var confirmation = String(props.getProperty('TELEGRAM_CONCURRENCY_TEST_CONFIRM') || '');
  var productionScriptId = 'AKfycbxQLSZXG-R_AGZG5clVDGnMqd4_cwvwsPsf3_9mJ79Rnas7CZVeuIhtSi7FM5MMagkqqg';

  assertIsolatedGasTestEnvironment_(props, confirmation, url);
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet || !/test|тест/i.test(spreadsheet.getName())) {
    throw new Error('Остановлено: активная таблица должна иметь TEST/ТЕСТ в названии.');
  }
  var match = url.match(/^https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec$/);
  if (!match || match[1] === productionScriptId) throw new Error('Нужен отдельный тестовый Apps Script Web App URL.');
  if (!token || backendSecret.length < 32 || !familyId || !telegramUserId) {
    throw new Error('Не заданы test token, backend secret, family ID или Telegram user ID.');
  }
  var link = rows_('telegram_links').find(function(row) {
    return String(row.telegram_user_id) === telegramUserId && String(row.family_id) === familyId;
  });
  if (!link) throw new Error('В тестовой семье нет Telegram-привязки для указанного тестового пользователя.');

  var updateId = 1500000000 + (Math.floor(Date.now() / 1000) % 500000000);
  var transactionId = 'telegram_' + updateId;
  var chatId = String(props.getProperty('TELEGRAM_CONCURRENCY_TEST_CHAT_ID') || telegramUserId);
  var update = {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      from: {id: Number(telegramUserId), is_bot: false, first_name: 'Test'},
      chat: {id: Number(chatId), type: 'private'},
      text: 'Расход 1 рубль Проверка повторной доставки'
    }
  };
  var requestOptions = {
    url: url, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({action:'telegramWebhook', telegramSecret:backendSecret, update:update})
  };
  var report = {test:'telegram update concurrent replay', update_id:updateId, transaction_id:transactionId};
  var cleanupError = null;
  try {
    var responses = UrlFetchApp.fetchAll([requestOptions, requestOptions]);
    var results = responses.map(function(response) { return telegramConcurrencyParse_(response); });
    if (results.some(function(result) { return result.error || !result.data; })) {
      throw new Error('Один из параллельных webhook-запросов завершился ошибкой.');
    }
    if (results[0].data.text !== results[1].data.text ||
        String(results[0].data.chat_id) !== String(results[1].data.chat_id)) {
      throw new Error('Параллельные запросы получили разные ответы.');
    }
    var rows = telegramConcurrencyPost_(url, token, {
      action:'query', table:'transactions', mode:'select',
      filters:[{column:'id', op:'eq', value:transactionId}], limit:2
    });
    if (rows.error || !Array.isArray(rows.data) || rows.data.length !== 1) {
      throw new Error('Ожидалась ровно одна операция, найдено: ' + (rows.data || []).length);
    }
    if (String(rows.data[0].family_id) !== familyId ||
        Number(rows.data[0].amount_kopecks) !== 100 ||
        String(rows.data[0].responsible_user_id) !== String(link.user_id)) {
      throw new Error('Созданная операция не соответствует тестовой семье, сумме или участнику.');
    }
    report.parallel_requests = 2;
    report.transaction_rows = rows.data.length;
    report.result = 'PASS';
  } finally {
    try {
      var deleted = telegramConcurrencyPost_(url, token, {
        action:'query', table:'transactions', mode:'delete',
        filters:[{column:'id', op:'eq', value:transactionId}]
      });
      if (deleted.error) throw new Error(deleted.error.message || 'transaction cleanup failed');
      var verify = telegramConcurrencyPost_(url, token, {
        action:'query', table:'transactions', mode:'select',
        filters:[{column:'id', op:'eq', value:transactionId}], limit:1
      });
      if (verify.error || !Array.isArray(verify.data) || verify.data.length !== 0) {
        throw new Error('Тестовая операция осталась после удаления.');
      }
      props.deleteProperty('telegram:update:' + updateId);
      report.cleanup = 'PASS';
    } catch (error) {
      cleanupError = String(error && error.message || error);
      report.cleanup = 'FAILED';
      report.cleanup_error = cleanupError;
      report.manual_cleanup_transaction_id = transactionId;
    }
  }
  if (cleanupError) throw new Error('Очистка не подтверждена. Проверьте операцию ' + transactionId + ': ' + cleanupError);
  Logger.log(JSON.stringify(report));
  return report;
}

function telegramConcurrencyPost_(url, token, body) {
  body.token = token;
  return telegramConcurrencyParse_(UrlFetchApp.fetch(url, {
    method:'post', contentType:'application/json', payload:JSON.stringify(body), muteHttpExceptions:true
  }));
}
function telegramConcurrencyParse_(response) {
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error('HTTP ' + status);
  var parsed;
  try { parsed = JSON.parse(response.getContentText()); }
  catch (_) { throw new Error('Ответ не является JSON'); }
  if (!parsed || typeof parsed !== 'object' ||
      !Object.prototype.hasOwnProperty.call(parsed,'data') ||
      !Object.prototype.hasOwnProperty.call(parsed,'error')) throw new Error('Некорректный API envelope');
  return parsed;
}
