/**
 * Self-contained live TEST-only Telegram duplicate-delivery probe.
 * Creates its own synthetic user/family/link, sends duplicate webhook updates
 * concurrently, removes the replay cache to simulate a lost response, retries,
 * verifies one transaction, then cleans every synthetic row and property.
 *
 * Required shared TEST properties:
 *   CONCURRENT_ROW_TEST_WEB_APP_URL
 *   CONCURRENT_ROW_TEST_CONFIRM=ISOLATED_TEST_ONLY
 * Shared allowlists:
 *   BACKEND_DIAGNOSTICS_ALLOWED_SCRIPT_ID
 *   GAS_TEST_ALLOWED_SPREADSHEET_ID
 *
 * TELEGRAM_BACKEND_SECRET is set temporarily to a synthetic value and restored.
 * No Telegram Bot API, Vercel, Production project or real Telegram account is used.
 */
function runTelegramUpdateConcurrencyTest() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('CONCURRENT_ROW_TEST_WEB_APP_URL') || '').trim();
  var confirmation = String(props.getProperty('CONCURRENT_ROW_TEST_CONFIRM') || '');
  assertIsolatedGasTestEnvironment_(props, confirmation, url);

  var suffix = Utilities.getUuid().replace(/-/g, '').toLowerCase();
  var email = 'telegram-replay+' + suffix + '@example.test';
  var password = 'temporary-telegram-replay-' + suffix;
  var familyName = 'TEST Telegram replay ' + suffix;
  var telegramUserId = String(900000000000000 + (parseInt(suffix.slice(0, 6), 16) % 1000000000));
  var chatId = telegramUserId;
  var linkUpdateId = 1300000000 + (Date.now() % 100000000);
  var transactionUpdateId = linkUpdateId + 1;
  var transactionId = 'telegram_' + transactionUpdateId;
  var userId = '', token = '', familyId = '', linkCode = '';
  var fixtureAttempted = false;
  var secretKey = 'TELEGRAM_BACKEND_SECRET';
  var pruneKey = 'telegram:last_prune';
  var oldSecret = props.getProperty(secretKey);
  var oldPrune = props.getProperty(pruneKey);
  var syntheticSecret = 'test-telegram-replay-' + suffix + '-secret';
  var report = {
    test: 'telegram duplicate concurrent delivery and retry',
    fixture: 'synthetic TEST-only'
  };
  var cleanupErrors = [];

  function restoreProperty(key, oldValue) {
    if (oldValue === null || oldValue === undefined) props.deleteProperty(key);
    else props.setProperty(key, String(oldValue));
  }

  function post(body) {
    return telegramReplayParse_(UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    }));
  }

  function webhookUpdate(updateId, text) {
    return {
      action: 'telegramWebhook',
      telegramSecret: syntheticSecret,
      update: {
        update_id: updateId,
        message: {
          message_id: updateId,
          date: Math.floor(Date.now() / 1000),
          from: { id: Number(telegramUserId), is_bot: false, first_name: 'TEST' },
          chat: { id: Number(chatId), type: 'private' },
          text: text
        }
      }
    };
  }

  try {
    // Prevent the production code's periodic replay-cache pruning from touching
    // unrelated TEST properties during this isolated probe.
    props.setProperty(secretKey, syntheticSecret);
    props.setProperty(pruneKey, String(Date.now()));

    fixtureAttempted = true;
    var signup = post({
      action: 'signup',
      email: email,
      password: password,
      name: 'Временный Telegram тест'
    });
    if (signup.error || !signup.data || !signup.data.token || !signup.data.user || !signup.data.user.id) {
      throw new Error('Не удалось создать синтетического пользователя: ' +
        (signup.error && signup.error.message || 'неожиданный ответ'));
    }
    token = String(signup.data.token);
    userId = String(signup.data.user.id);

    var family = post({ action: 'createFamily', token: token, name: familyName });
    if (family.error || !family.data || !family.data.id) {
      throw new Error('Не удалось создать синтетическую TEST-семью: ' +
        (family.error && family.error.message || 'неожиданный ответ'));
    }
    familyId = String(family.data.id);

    var generated = post({ action: 'rpc', token: token, name: 'create_telegram_link_code' });
    if (generated.error || !generated.data || !generated.data.code) {
      throw new Error('Не удалось создать одноразовый TEST link code: ' +
        (generated.error && generated.error.message || 'неожиданный ответ'));
    }
    linkCode = String(generated.data.code);

    var linked = post(webhookUpdate(linkUpdateId, '/link ' + linkCode));
    if (linked.error || !linked.data || !/успешно привязан/i.test(String(linked.data.text || ''))) {
      throw new Error('Не удалось создать синтетическую Telegram-привязку: ' +
        (linked.error && linked.error.message || linked.data && linked.data.text || 'неожиданный ответ'));
    }
    var linkRows = rows_('telegram_links').filter(function(row) {
      return String(row.telegram_user_id) === telegramUserId &&
        String(row.user_id) === userId && String(row.family_id) === familyId;
    });
    if (linkRows.length !== 1) throw new Error('Ожидалась одна синтетическая Telegram-привязка.');

    var updateBody = webhookUpdate(transactionUpdateId, 'Расход 1 рубль Проверка повторной доставки');
    var requestOptions = {
      url: url,
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(updateBody),
      muteHttpExceptions: true
    };
    var parallelResponses = UrlFetchApp.fetchAll([requestOptions, requestOptions]);
    var parallelResults = parallelResponses.map(function(response, index) {
      return telegramReplayParse_(response, 'parallel delivery ' + index);
    });
    parallelResults.forEach(function(result) {
      if (result.error || !result.data || !result.data.text) {
        throw new Error('Параллельная доставка вернула ошибку или пустой ответ: ' +
          (result.error && result.error.message || 'invalid response'));
      }
    });
    if (String(parallelResults[0].data.text) !== String(parallelResults[1].data.text) ||
        String(parallelResults[0].data.chat_id) !== String(parallelResults[1].data.chat_id)) {
      throw new Error('Параллельные доставки получили разные ответы.');
    }

    // Remove only this update's replay cache to simulate a committed transaction
    // whose webhook response/cache acknowledgement was lost.
    props.deleteProperty('telegram:update:' + transactionUpdateId);
    var retry = post(updateBody);
    if (retry.error || !retry.data || retry.data.text !== parallelResults[0].data.text) {
      throw new Error('Повтор после удаления replay cache не вернул исходный ответ: ' +
        (retry.error && retry.error.message || 'different response'));
    }

    var transactionRows = rows_('transactions').filter(function(row) {
      return String(row.id) === transactionId;
    });
    if (transactionRows.length !== 1) {
      throw new Error('Ожидалась одна операция после параллельной доставки и retry; найдено: ' +
        transactionRows.length);
    }
    var transaction = transactionRows[0];
    if (String(transaction.family_id) !== familyId ||
        String(transaction.created_by) !== userId ||
        String(transaction.responsible_user_id) !== userId ||
        Number(transaction.amount_kopecks) !== 100 ||
        transaction.type !== 'expense') {
      throw new Error('Сохранённая операция не соответствует синтетическому payload.');
    }

    report.parallel_requests = 2;
    report.retry_requests = 1;
    report.telegram_link_rows = linkRows.length;
    report.transaction_rows = transactionRows.length;
    report.amount_kopecks = Number(transaction.amount_kopecks);
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

        var txRows = rows_('transactions').filter(function(row) {
          return String(row.id) === transactionId;
        });
        if (txRows.length) deleteRows_('transactions', txRows);

        var telegramLinks = rows_('telegram_links').filter(function(row) {
          return String(row.telegram_user_id) === telegramUserId ||
            (userId && String(row.user_id) === userId);
        });
        if (telegramLinks.length) deleteRows_('telegram_links', telegramLinks);

        if (userId) {
          var codes = rows_('telegram_link_codes').filter(function(row) {
            return String(row.user_id) === userId;
          });
          if (codes.length) deleteRows_('telegram_link_codes', codes);
        }

        if (familyId) {
          var purchaseRows = rows_('planned_purchases').filter(function(row) {
            return String(row.family_id) === familyId;
          });
          if (purchaseRows.length) deleteRows_('planned_purchases', purchaseRows);
          var categoryRows = rows_('categories').filter(function(row) {
            return String(row.family_id) === familyId;
          });
          if (categoryRows.length) deleteRows_('categories', categoryRows);
          var accountRows = rows_('accounts').filter(function(row) {
            return String(row.family_id) === familyId;
          });
          if (accountRows.length) deleteRows_('accounts', accountRows);
          var memberRows = rows_('family_members').filter(function(row) {
            return String(row.family_id) === familyId;
          });
          if (memberRows.length) deleteRows_('family_members', memberRows);
          var familyRows = rows_('families').filter(function(row) {
            return String(row.id) === familyId;
          });
          if (familyRows.length) deleteRows_('families', familyRows);
        }

        if (userId) {
          var profileRows = rows_('profiles').filter(function(row) {
            return String(row.id) === userId;
          });
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
      } catch (error) {
        cleanupErrors.push(String(error && error.message || error));
      }
    }

    // Always remove this run's replay keys and restore the TEST project's prior
    // Telegram secret/prune marker, even when fixture cleanup itself fails.
    try { props.deleteProperty('telegram:update:' + linkUpdateId); } catch (error) {
      cleanupErrors.push('link replay cache: ' + String(error && error.message || error));
    }
    try { props.deleteProperty('telegram:update:' + transactionUpdateId); } catch (error) {
      cleanupErrors.push('transaction replay cache: ' + String(error && error.message || error));
    }
    try { restoreProperty(secretKey, oldSecret); } catch (error) {
      cleanupErrors.push('restore Telegram backend secret: ' + String(error && error.message || error));
    }
    try { restoreProperty(pruneKey, oldPrune); } catch (error) {
      cleanupErrors.push('restore Telegram prune marker: ' + String(error && error.message || error));
    }

    try {
      var remainingAuth = authRows_().some(function(row) { return String(row.email) === email; });
      var remainingFamily = familyId && rows_('families').some(function(row) { return String(row.id) === familyId; });
      var remainingUser = userId && rows_('profiles').some(function(row) { return String(row.id) === userId; });
      var remainingTx = rows_('transactions').some(function(row) { return String(row.id) === transactionId; });
      var remainingLinks = rows_('telegram_links').some(function(row) {
        return String(row.telegram_user_id) === telegramUserId ||
          (userId && String(row.user_id) === userId);
      });
      var remainingCodes = userId && rows_('telegram_link_codes').some(function(row) {
        return String(row.user_id) === userId;
      });
      var remainingMemberships = familyId && rows_('family_members').some(function(row) {
        return String(row.family_id) === familyId;
      });
      var remainingCategories = familyId && rows_('categories').some(function(row) {
        return String(row.family_id) === familyId;
      });
      var remainingAccounts = familyId && rows_('accounts').some(function(row) {
        return String(row.family_id) === familyId;
      });
      if (remainingAuth || remainingFamily || remainingUser || remainingTx || remainingLinks ||
          remainingCodes || remainingMemberships || remainingCategories || remainingAccounts) {
        throw new Error('После cleanup остались синтетические записи.');
      }
      report.cleanup = 'PASS';
    } catch (error) {
      cleanupErrors.push(String(error && error.message || error));
      report.cleanup = 'FAILED';
      report.cleanup_errors = cleanupErrors;
      report.manual_cleanup_email = email;
      report.manual_cleanup_user_id = userId || null;
      report.manual_cleanup_family_id = familyId || null;
      report.manual_cleanup_telegram_user_id = telegramUserId;
      report.manual_cleanup_transaction_id = transactionId;
    }
  }

  if (cleanupErrors.length) {
    throw new Error('Очистка TEST Telegram fixtures не подтверждена: ' +
      cleanupErrors.join('; ') + '. Synthetic email: ' + email +
      ', transaction ID: ' + transactionId);
  }
  Logger.log(JSON.stringify(report));
  return report;
}

function telegramReplayParse_(response, label) {
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error((label || 'request') + ': HTTP ' + status);
  var parsed;
  try { parsed = JSON.parse(response.getContentText()); }
  catch (_) { throw new Error((label || 'request') + ': ответ не является JSON'); }
  if (!parsed || typeof parsed !== 'object' ||
      !Object.prototype.hasOwnProperty.call(parsed, 'data') ||
      !Object.prototype.hasOwnProperty.call(parsed, 'error')) {
    throw new Error((label || 'request') + ': некорректная форма API-ответа');
  }
  return parsed;
}
