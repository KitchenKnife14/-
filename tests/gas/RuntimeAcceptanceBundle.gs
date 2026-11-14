/**
 * Single-file TEST GAS runtime acceptance bundle.
 * Generated from the maintained individual modules in tests/gas/.
 * Copy this one file into the isolated TEST Apps Script project.
 * Keep the existing IsolatedTestGuard.gs file; do not add the individual probe files separately.
 * Do not add this bundle to Production.
 */


/* ===== BUNDLE SECTION: tests/gas/TelegramUpdateConcurrencyTest.gs ===== */

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

  function telegramReplayPost_(body) {
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
    var signup = telegramReplayPost_({
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

    var family = telegramReplayPost_({ action: 'createFamily', token: token, name: familyName });
    if (family.error || !family.data || !family.data.id) {
      throw new Error('Не удалось создать синтетическую TEST-семью: ' +
        (family.error && family.error.message || 'неожиданный ответ'));
    }
    familyId = String(family.data.id);

    var generated = telegramReplayPost_({ action: 'rpc', token: token, name: 'create_telegram_link_code' });
    if (generated.error || !generated.data || !generated.data.code) {
      throw new Error('Не удалось создать одноразовый TEST link code: ' +
        (generated.error && generated.error.message || 'неожиданный ответ'));
    }
    linkCode = String(generated.data.code);

    var linked = telegramReplayPost_(webhookUpdate(linkUpdateId, '/link ' + linkCode));
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
    var retry = telegramReplayPost_(updateBody);
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


/* ===== BUNDLE SECTION: tests/gas/ReadConsistencyConcurrencyTest.gs ===== */

/**
 * Self-contained live TEST-only optimistic read/write consistency probe.
 * Creates its own synthetic user/family/purchase, confirms the purchase while
 * 16 parallel batch reads observe both purchase and transaction, then cleans up.
 *
 * Required shared TEST properties only:
 *   CONCURRENT_ROW_TEST_WEB_APP_URL
 *   CONCURRENT_ROW_TEST_CONFIRM=ISOLATED_TEST_ONLY
 * Shared allowlists:
 *   BACKEND_DIAGNOSTICS_ALLOWED_SCRIPT_ID
 *   GAS_TEST_ALLOWED_SPREADSHEET_ID
 *
 * No real family credentials or user IDs are required.
 */
function runReadConsistencyConcurrencyTest() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('CONCURRENT_ROW_TEST_WEB_APP_URL') || '').trim();
  var confirmation = String(props.getProperty('CONCURRENT_ROW_TEST_CONFIRM') || '');
  assertIsolatedGasTestEnvironment_(props, confirmation, url);

  var suffix = Utilities.getUuid().replace(/-/g, '').toLowerCase();
  var email = 'read-consistency+' + suffix + '@example.test';
  var password = 'temporary-read-consistency-' + suffix;
  var familyName = 'TEST read consistency ' + suffix;
  var id = 'readcheck_' + suffix;
  var transactionId = 'purchase_' + id;
  var today = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd');
  var month = today.slice(0, 7) + '-01';
  var userId = '', token = '', familyId = '';
  var fixtureAttempted = false;
  var report = {test:'optimistic read/write consistency', fixture:'synthetic TEST-only'};
  var cleanupErrors = [];

  function readConsistencyPost_(body, label) {
    return readConsistencyTestParse_(UrlFetchApp.fetch(url, {
      method:'post', contentType:'application/json',
      payload:JSON.stringify(body), muteHttpExceptions:true
    }), label || 'request');
  }
  function readConsistencyRemoveRows_(table, predicate) {
    var matches = rows_(table).filter(predicate);
    if (matches.length) deleteRows_(table, matches);
  }

  try {
    fixtureAttempted = true;
    var signup = readConsistencyPost_({
      action:'signup', email:email, password:password, name:'Временный тест чтения'
    }, 'signup');
    if (signup.error || !signup.data || !signup.data.token ||
        !signup.data.user || !signup.data.user.id) {
      throw new Error('Не удалось создать синтетического пользователя: ' +
        (signup.error && signup.error.message || 'неожиданный ответ'));
    }
    token = String(signup.data.token);
    userId = String(signup.data.user.id);

    var family = readConsistencyPost_({action:'createFamily', token:token, name:familyName}, 'create family');
    if (family.error || !family.data || !family.data.id) {
      throw new Error('Не удалось создать синтетическую TEST-семью: ' +
        (family.error && family.error.message || 'неожиданный ответ'));
    }
    familyId = String(family.data.id);

    var inserted = readConsistencyPost_({
      action:'query', token:token, table:'planned_purchases',
      mode:'insert', returning:true,
      values:{
        id:id, family_id:familyId, name:'Диагностика согласованного чтения',
        category_id:null, estimated_kopecks:137, priority:3,
        desired_month:month, desired_date:today, url:'',
        comment:'Автоматический TEST; запись будет удалена',
        status:'planned', responsible_user_id:userId, goal_id:null,
        linked_transaction_id:'', created_by:userId
      }
    }, 'insert planned purchase');
    if (inserted.error || !Array.isArray(inserted.data) ||
        inserted.data.length !== 1 || String(inserted.data[0].id) !== id) {
      throw new Error('Не удалось создать изолированную тестовую покупку: ' +
        (inserted.error && inserted.error.message || 'неожиданный ответ'));
    }

    // Fetch the complete persisted snapshot required by the stale-write guard.
    var snapshot = readConsistencyPost_({
      action:'query', token:token, table:'planned_purchases', mode:'select',
      filters:[{column:'id',op:'eq',value:id}], limit:1
    }, 'read purchase snapshot');
    if (snapshot.error || !Array.isArray(snapshot.data) || snapshot.data.length !== 1) {
      throw new Error('Не удалось прочитать полный snapshot планируемой покупки.');
    }
    var expectedPurchase = snapshot.data[0];
    var requiredColumns = [
      'id','family_id','name','category_id','estimated_kopecks','priority',
      'desired_month','desired_date','url','comment','status',
      'responsible_user_id','goal_id','linked_transaction_id','created_by','created_at'
    ];
    if (requiredColumns.some(function(column) {
      return !Object.prototype.hasOwnProperty.call(expectedPurchase, column);
    })) {
      throw new Error('API вернул неполный snapshot; тест остановлен без подтверждения покупки.');
    }

    var writer = {
      url:url, method:'post', contentType:'application/json', muteHttpExceptions:true,
      payload:JSON.stringify({
        action:'rpc', token:token, name:'confirm_planned_purchase',
        params:{
          p_purchase_id:id, p_account_id:'', p_operation_date:today,
          p_expected_purchase:expectedPurchase
        }
      })
    };
    var reader = {
      url:url, method:'post', contentType:'application/json', muteHttpExceptions:true,
      payload:JSON.stringify({
        action:'batch', token:token,
        requests:[
          {action:'query',table:'planned_purchases',mode:'select',
            filters:[{column:'id',op:'eq',value:id}],limit:1},
          {action:'query',table:'transactions',mode:'select',
            filters:[{column:'id',op:'eq',value:transactionId}],limit:1}
        ]
      })
    };
    var requests = [writer];
    for (var i=0;i<16;i++) requests.push(reader);
    var started = Date.now();
    var responses = UrlFetchApp.fetchAll(requests);
    var elapsed = Date.now()-started;
    var writerResult = readConsistencyTestParse_(responses[0], 'confirm planned purchase');
    if (writerResult.error) {
      throw new Error('Подтверждение покупки не завершилось: ' + writerResult.error.message);
    }

    var beforeCount=0, afterCount=0;
    for (var j=1;j<responses.length;j++) {
      var result = readConsistencyTestParse_(responses[j], 'parallel read '+j);
      if (result.error || !Array.isArray(result.data) || result.data.length !== 2 ||
          result.data.some(function(item){return item.error;})) {
        throw new Error('Параллельное чтение '+j+' завершилось ошибкой.');
      }
      var purchases=result.data[0].data, transactions=result.data[1].data;
      if (!Array.isArray(purchases) || purchases.length !== 1 || !Array.isArray(transactions)) {
        throw new Error('Параллельное чтение '+j+' вернуло неполный снимок.');
      }
      var isBefore=purchases[0].status==='planned' && transactions.length===0;
      var isAfter=purchases[0].status==='bought' && transactions.length===1;
      if (!isBefore && !isAfter) {
        throw new Error('Несогласованный снимок: статус покупки '+purchases[0].status+
          ', операций '+transactions.length+'.');
      }
      if (isBefore) beforeCount++; else afterCount++;
    }

    var finalSnapshot = readConsistencyPost_({
      action:'batch', token:token,
      requests:[
        {action:'query',table:'planned_purchases',mode:'select',
          filters:[{column:'id',op:'eq',value:id}],limit:1},
        {action:'query',table:'transactions',mode:'select',
          filters:[{column:'id',op:'eq',value:transactionId}],limit:1}
      ]
    }, 'final snapshot');
    if (finalSnapshot.error || !Array.isArray(finalSnapshot.data) ||
        finalSnapshot.data.length !== 2 || finalSnapshot.data[0].error ||
        finalSnapshot.data[1].error ||
        !finalSnapshot.data[0].data.length ||
        finalSnapshot.data[0].data[0].status !== 'bought' ||
        finalSnapshot.data[1].data.length !== 1) {
      throw new Error('Итоговое состояние после подтверждения покупки некорректно.');
    }

    report.parallel_read_requests=16;
    report.before_snapshots=beforeCount;
    report.after_snapshots=afterCount;
    report.fetch_all_elapsed_ms=elapsed;
    report.result='PASS';
  } finally {
    if (fixtureAttempted) {
      try {
        var authMatches = authRows_().filter(function(row){return String(row.email)===email;});
        if (!userId && authMatches.length===1) userId=String(authMatches[0].id);
        var familyMatches = userId ? rows_('families').filter(function(row) {
          return String(row.created_by)===userId && String(row.name)===familyName;
        }) : [];
        if (!familyId && familyMatches.length===1) familyId=String(familyMatches[0].id);

        readConsistencyRemoveRows_('transactions',function(row){return String(row.id)===transactionId;});
        readConsistencyRemoveRows_('planned_purchases',function(row){return String(row.id)===id;});
        if (familyId) {
          readConsistencyRemoveRows_('categories',function(row){return String(row.family_id)===familyId;});
          readConsistencyRemoveRows_('accounts',function(row){return String(row.family_id)===familyId;});
          readConsistencyRemoveRows_('family_members',function(row){return String(row.family_id)===familyId;});
          readConsistencyRemoveRows_('families',function(row){return String(row.id)===familyId;});
        }
        if (userId) {
          readConsistencyRemoveRows_('profiles',function(row){return String(row.id)===userId;});
          var allProps=props.getProperties();
          Object.keys(allProps).forEach(function(key) {
            if (key.indexOf('session:')!==0) return;
            try {
              var session=JSON.parse(allProps[key]);
              if (String(session.userId)===userId) props.deleteProperty(key);
            } catch (_) {}
          });
        }
        authMatches=authRows_().filter(function(row){return String(row.email)===email;});
        authMatches.forEach(function(row){authSheet_().deleteRow(row.row);});

        var remainingAuth=authRows_().some(function(row){return String(row.email)===email;});
        var remainingFamily=familyId && rows_('families').some(function(row){return String(row.id)===familyId;});
        var remainingUser=userId && rows_('profiles').some(function(row){return String(row.id)===userId;});
        var remainingPurchase=rows_('planned_purchases').some(function(row){return String(row.id)===id;});
        var remainingTx=rows_('transactions').some(function(row){return String(row.id)===transactionId;});
        if (remainingAuth || remainingFamily || remainingUser || remainingPurchase || remainingTx) {
          throw new Error('После cleanup остались синтетические записи.');
        }
        report.cleanup='PASS';
      } catch(error) {
        cleanupErrors.push(String(error && error.message || error));
        report.cleanup='FAILED';
        report.cleanup_errors=cleanupErrors;
        report.manual_cleanup_email=email;
        report.manual_cleanup_user_id=userId || null;
        report.manual_cleanup_family_id=familyId || null;
        report.manual_cleanup_purchase_id=id;
        report.manual_cleanup_transaction_id=transactionId;
      }
    } else report.cleanup='NOT_NEEDED';
  }
  if (cleanupErrors.length) {
    throw new Error('Очистка TEST read-consistency fixtures не подтверждена: '+
      cleanupErrors.join('; ')+'. Synthetic email: '+email+', purchase ID: '+id);
  }
  Logger.log(JSON.stringify(report));
  return report;
}

function readConsistencyTestParse_(response,label) {
  var status=response.getResponseCode();
  if(status<200||status>=300) throw new Error((label||'request')+': HTTP '+status);
  var parsed;
  try { parsed=JSON.parse(response.getContentText()); }
  catch (_) { throw new Error((label||'request')+': ответ не является JSON'); }
  if(!parsed || typeof parsed!=='object' ||
      !Object.prototype.hasOwnProperty.call(parsed,'data') ||
      !Object.prototype.hasOwnProperty.call(parsed,'error')) {
    throw new Error((label||'request')+': некорректная форма API-ответа');
  }
  return parsed;
}


/* ===== BUNDLE SECTION: tests/gas/MonthlyPlanConcurrencyTest.gs ===== */

/**
 * Self-contained real GAS concurrency probe for one shared monthly-plan row.
 * Creates two synthetic users, a TEST family and selects one seeded expense
 * category; both family members race an update against the same row snapshot.
 * All synthetic rows and sessions are removed in finally.
 *
 * Required shared TEST properties:
 *   CONCURRENT_ROW_TEST_WEB_APP_URL
 *   CONCURRENT_ROW_TEST_CONFIRM=ISOLATED_TEST_ONLY
 * Shared Script ID / Spreadsheet ID allowlists are enforced by the guard.
 */
function runMonthlyPlanConcurrencyTest() {
  var props=PropertiesService.getScriptProperties();
  var url=String(props.getProperty('CONCURRENT_ROW_TEST_WEB_APP_URL')||'').trim();
  var confirmation=String(props.getProperty('CONCURRENT_ROW_TEST_CONFIRM')||'');
  assertIsolatedGasTestEnvironment_(props,confirmation,url);

  var suffix=Utilities.getUuid().replace(/-/g,'').toLowerCase();
  var emailA='monthly-plan-a+'+suffix+'@example.test';
  var emailB='monthly-plan-b+'+suffix+'@example.test';
  var passwordA='temporary-monthly-plan-A-'+suffix;
  var passwordB='temporary-monthly-plan-B-'+suffix;
  var familyName='TEST monthly plan '+suffix;
  var userA='',userB='',tokenA='',tokenB='',familyId='',categoryId='';
  var planId='monthrace_'+suffix;
  var fixtureAttempted=false;
  var report={test:'concurrent optimistic monthly-plan update',fixture:'synthetic TEST-only'};
  var cleanupErrors=[];

  function monthlyPlanPost_(body,label) {
    return monthlyPlanTestParse_(UrlFetchApp.fetch(url,{
      method:'post',contentType:'application/json',
      payload:JSON.stringify(body),muteHttpExceptions:true
    }),label||'request');
  }
  function monthlyPlanRemoveRows_(table,predicate) {
    var matches=rows_(table).filter(predicate);
    if(matches.length)deleteRows_(table,matches);
  }

  try {
    fixtureAttempted=true;
    var signupA=monthlyPlanPost_({action:'signup',email:emailA,password:passwordA,name:'TEST участник A'},'signup A');
    if(signupA.error||!signupA.data||!signupA.data.token||!signupA.data.user||!signupA.data.user.id) {
      throw new Error('Не удалось создать TEST участника A: '+(signupA.error&&signupA.error.message||'неожиданный ответ'));
    }
    tokenA=String(signupA.data.token);
    userA=String(signupA.data.user.id);

    var family=monthlyPlanPost_({action:'createFamily',token:tokenA,name:familyName},'create family');
    if(family.error||!family.data||!family.data.id||!family.data.invite_code) {
      throw new Error('Не удалось создать TEST-семью: '+(family.error&&family.error.message||'неожиданный ответ'));
    }
    familyId=String(family.data.id);

    var signupB=monthlyPlanPost_({action:'signup',email:emailB,password:passwordB,name:'TEST участник B'},'signup B');
    if(signupB.error||!signupB.data||!signupB.data.token||!signupB.data.user||!signupB.data.user.id) {
      throw new Error('Не удалось создать TEST участника B: '+(signupB.error&&signupB.error.message||'неожиданный ответ'));
    }
    tokenB=String(signupB.data.token);
    userB=String(signupB.data.user.id);

    var joined=monthlyPlanPost_({
      action:'joinFamily',token:tokenB,invite_code:family.data.invite_code,
      display_name:'TEST участник B'
    },'join family');
    if(joined.error||!joined.data||String(joined.data.id)!==familyId) {
      throw new Error('Не удалось добавить второго TEST участника: '+(joined.error&&joined.error.message||'неожиданный ответ'));
    }

    var categories=monthlyPlanPost_({
      action:'query',token:tokenA,table:'categories',mode:'select',
      filters:[
        {column:'family_id',op:'eq',value:familyId},
        {column:'kind',op:'eq',value:'expense'}
      ],
      orders:[{column:'name',ascending:true}],limit:1
    },'select seeded category');
    if(categories.error||!Array.isArray(categories.data)||categories.data.length!==1||!categories.data[0].id) {
      throw new Error('В TEST-семье не найдена исходная категория расходов.');
    }
    categoryId=String(categories.data[0].id);

    var month=Utilities.formatDate(new Date(),'Europe/Moscow','yyyy-MM')+'-01';
    var key={family_id:familyId,month_date:month,category_id:categoryId,type:'expense'};
    var inserted=monthlyPlanPost_({
      action:'query',token:tokenA,table:'monthly_plans',mode:'upsert',
      onConflict:'family_id,month_date,category_id,type',returning:true,
      values:Object.assign({id:planId,planned_kopecks:10000,note:'Исходный TEST план'},key)
    },'insert monthly plan');
    if(inserted.error||!Array.isArray(inserted.data)||inserted.data.length!==1||
       String(inserted.data[0].id)!==planId) {
      throw new Error('Не удалось создать TEST monthly plan: '+(inserted.error&&inserted.error.message||'неожиданный ответ'));
    }

    var selected=monthlyPlanPost_({
      action:'query',token:tokenA,table:'monthly_plans',mode:'select',
      filters:[{column:'id',op:'eq',value:planId}],limit:1
    },'read plan snapshot');
    if(selected.error||!Array.isArray(selected.data)||selected.data.length!==1) {
      throw new Error('Не удалось получить snapshot TEST monthly plan.');
    }
    var snapshot=selected.data[0];

    var requests=[
      {token:tokenA,planned:12000,note:'Изменение участника A'},
      {token:tokenB,planned:15000,note:'Изменение участника B'}
    ].map(function(item) {
      return {
        url:url,method:'post',contentType:'application/json',muteHttpExceptions:true,
        payload:JSON.stringify({
          action:'query',token:item.token,table:'monthly_plans',mode:'upsert',
          onConflict:'family_id,month_date,category_id,type',expectedRows:[snapshot],
          values:Object.assign({planned_kopecks:item.planned,note:item.note},key)
        })
      };
    });

    var results=UrlFetchApp.fetchAll(requests).map(function(response,index) {
      return monthlyPlanTestParse_(response,'parallel update '+index);
    });
    var successes=results.filter(function(result){return !result.error;});
    var stale=results.filter(function(result) {
      return result.error&&/изменён другим участником|изменен другим участником/i.test(String(result.error.message||''));
    });
    if(successes.length!==1||stale.length!==1) {
      throw new Error('Ожидался один успешный upsert и один stale отказ; success='+successes.length+
        ', stale='+stale.length+', errors='+results.map(function(result){return result.error&&result.error.message||'';}).join(' | '));
    }

    var final=monthlyPlanPost_({
      action:'query',token:tokenA,table:'monthly_plans',mode:'select',
      filters:[{column:'id',op:'eq',value:planId}],limit:1
    },'read final plan');
    if(final.error||!Array.isArray(final.data)||final.data.length!==1) {
      throw new Error('Итоговый TEST monthly plan не найден.');
    }
    var winner=final.data[0];
    if([12000,15000].indexOf(Number(winner.planned_kopecks))===-1) {
      throw new Error('Итоговая сумма не совпадает ни с одним конкурентным изменением.');
    }
    report.concurrent_requests=2;
    report.successful_updates=1;
    report.stale_updates_rejected=1;
    report.final_amount_kopecks=Number(winner.planned_kopecks);
    report.result='PASS';
  } finally {
    if(fixtureAttempted) {
      try {
        var authMatches=authRows_().filter(function(row) {
          return String(row.email)===emailA||String(row.email)===emailB;
        });
        if(!userA) {
          var a=authMatches.filter(function(row){return String(row.email)===emailA;});
          if(a.length===1)userA=String(a[0].id);
        }
        if(!userB) {
          var b=authMatches.filter(function(row){return String(row.email)===emailB;});
          if(b.length===1)userB=String(b[0].id);
        }
        var familyMatches=userA?rows_('families').filter(function(row) {
          return String(row.created_by)===userA&&String(row.name)===familyName;
        }):[];
        if(!familyId&&familyMatches.length===1)familyId=String(familyMatches[0].id);

        monthlyPlanRemoveRows_('monthly_plans',function(row){return String(row.id)===planId;});
        if(familyId) {
          monthlyPlanRemoveRows_('categories',function(row){return String(row.family_id)===familyId;});
          monthlyPlanRemoveRows_('accounts',function(row){return String(row.family_id)===familyId;});
          monthlyPlanRemoveRows_('family_members',function(row){return String(row.family_id)===familyId;});
          monthlyPlanRemoveRows_('families',function(row){return String(row.id)===familyId;});
        }
        [userA,userB].filter(Boolean).forEach(function(uid) {
          monthlyPlanRemoveRows_('profiles',function(row){return String(row.id)===uid;});
        });
        authMatches.sort(function(a,b){return b.row-a.row;}).forEach(function(row){authSheet_().deleteRow(row.row);});

        var allProps=props.getProperties();
        Object.keys(allProps).forEach(function(key) {
          if(key.indexOf('session:')!==0)return;
          try {
            var session=JSON.parse(allProps[key]);
            if([userA,userB].filter(Boolean).indexOf(String(session.userId))!==-1)props.deleteProperty(key);
          } catch (_) {}
        });

        var remainingAuth=authRows_().some(function(row) {
          return String(row.email)===emailA||String(row.email)===emailB;
        });
        var remainingPlan=rows_('monthly_plans').some(function(row){return String(row.id)===planId;});
        var remainingFamily=familyId&&rows_('families').some(function(row){return String(row.id)===familyId;});
        var remainingUsers=[userA,userB].filter(Boolean).some(function(uid) {
          return rows_('profiles').some(function(row){return String(row.id)===uid;});
        });
        if(remainingAuth||remainingPlan||remainingFamily||remainingUsers) {
          throw new Error('После cleanup остались синтетические TEST-записи.');
        }
        report.cleanup='PASS';
      } catch(error) {
        cleanupErrors.push(String(error&&error.message||error));
        report.cleanup='FAILED';
        report.cleanup_errors=cleanupErrors;
        report.manual_cleanup_emails=[emailA,emailB];
        report.manual_cleanup_family_id=familyId||null;
        report.manual_cleanup_plan_id=planId;
      }
    } else report.cleanup='NOT_NEEDED';
  }
  if(cleanupErrors.length) {
    throw new Error('Очистка TEST monthly-plan fixtures не подтверждена: '+cleanupErrors.join('; ')+
      '. Plan ID: '+planId);
  }
  Logger.log(JSON.stringify(report));
  return report;
}

function monthlyPlanTestParse_(response,label) {
  var status=response.getResponseCode();
  if(status<200||status>=300)throw new Error((label||'request')+': HTTP '+status);
  var parsed;
  try{parsed=JSON.parse(response.getContentText());}
  catch(_){throw new Error((label||'request')+': ответ не является JSON');}
  if(!parsed||typeof parsed!=='object'||
     !Object.prototype.hasOwnProperty.call(parsed,'data')||
     !Object.prototype.hasOwnProperty.call(parsed,'error')) {
    throw new Error((label||'request')+': некорректная форма API-ответа');
  }
  return parsed;
}


/* ===== BUNDLE SECTION: tests/gas/TransactionConcurrencyTest.gs ===== */

/**
 * Self-contained live TEST-only concurrency probe: two synthetic family members
 * insert separate transactions in parallel. All fixture rows and sessions are
 * removed and verified in finally.
 *
 * Required shared TEST properties:
 *   CONCURRENT_ROW_TEST_WEB_APP_URL
 *   CONCURRENT_ROW_TEST_CONFIRM=ISOLATED_TEST_ONLY
 * Shared Script ID / Spreadsheet ID allowlists are enforced by the guard.
 */
function runTransactionConcurrencyTest() {
  var props=PropertiesService.getScriptProperties();
  var url=String(props.getProperty('CONCURRENT_ROW_TEST_WEB_APP_URL')||'').trim();
  var confirmation=String(props.getProperty('CONCURRENT_ROW_TEST_CONFIRM')||'');
  assertIsolatedGasTestEnvironment_(props,confirmation,url);

  var suffix=Utilities.getUuid().replace(/-/g,'').toLowerCase();
  var emailA='transaction-race-a+'+suffix+'@example.test';
  var emailB='transaction-race-b+'+suffix+'@example.test';
  var passwordA='temporary-transaction-race-A-'+suffix;
  var passwordB='temporary-transaction-race-B-'+suffix;
  var familyName='TEST transaction race '+suffix;
  var userA='',userB='',tokenA='',tokenB='',familyId='';
  var idA='txrace_a_'+suffix,idB='txrace_b_'+suffix;
  var date=Utilities.formatDate(new Date(),'Europe/Moscow','yyyy-MM-dd');
  var fixtureAttempted=false;
  var report={test:'concurrent transaction inserts by two synthetic family members',fixture:'synthetic TEST-only'};
  var cleanupErrors=[];

  function transactionConcurrencyPost_(body,label) {
    return transactionConcurrencyParse_(UrlFetchApp.fetch(url,{
      method:'post',contentType:'application/json',
      payload:JSON.stringify(body),muteHttpExceptions:true
    }),label||'request');
  }
  function transactionConcurrencyRemoveRows_(table,predicate) {
    var matches=rows_(table).filter(predicate);
    if(matches.length)deleteRows_(table,matches);
  }

  try {
    fixtureAttempted=true;
    var signupA=transactionConcurrencyPost_({action:'signup',email:emailA,password:passwordA,name:'TEST участник A'},'signup A');
    if(signupA.error||!signupA.data||!signupA.data.token||!signupA.data.user||!signupA.data.user.id) {
      throw new Error('Не удалось создать TEST участника A: '+(signupA.error&&signupA.error.message||'неожиданный ответ'));
    }
    tokenA=String(signupA.data.token);
    userA=String(signupA.data.user.id);

    var family=transactionConcurrencyPost_({action:'createFamily',token:tokenA,name:familyName},'create family');
    if(family.error||!family.data||!family.data.id||!family.data.invite_code) {
      throw new Error('Не удалось создать TEST-семью: '+(family.error&&family.error.message||'неожиданный ответ'));
    }
    familyId=String(family.data.id);

    var signupB=transactionConcurrencyPost_({action:'signup',email:emailB,password:passwordB,name:'TEST участник B'},'signup B');
    if(signupB.error||!signupB.data||!signupB.data.token||!signupB.data.user||!signupB.data.user.id) {
      throw new Error('Не удалось создать TEST участника B: '+(signupB.error&&signupB.error.message||'неожиданный ответ'));
    }
    tokenB=String(signupB.data.token);
    userB=String(signupB.data.user.id);

    var joined=transactionConcurrencyPost_({
      action:'joinFamily',token:tokenB,invite_code:family.data.invite_code,
      display_name:'TEST участник B'
    },'join family');
    if(joined.error||!joined.data||String(joined.data.id)!==familyId) {
      throw new Error('Не удалось добавить второго TEST участника: '+(joined.error&&joined.error.message||'неожиданный ответ'));
    }

    var requests=[
      {token:tokenA,id:idA,amount:12345,description:'TEST concurrent transaction A'},
      {token:tokenB,id:idB,amount:67890,description:'TEST concurrent transaction B'}
    ].map(function(item) {
      return {
        url:url,method:'post',contentType:'application/json',muteHttpExceptions:true,
        payload:JSON.stringify({
          action:'query',token:item.token,table:'transactions',mode:'insert',returning:true,
          values:{
            id:item.id,family_id:familyId,type:'expense',amount_kopecks:item.amount,
            operation_date:date,description:item.description
          }
        })
      };
    });

    var started=Date.now();
    var parallelResponses=UrlFetchApp.fetchAll(requests);
    report.concurrent_fetch_all_ms=Date.now()-started;
    var results=parallelResponses.map(function(response,index) {
      return transactionConcurrencyParse_(response,'parallel insert '+index);
    });
    if(results.some(function(result) {
      return result.error||!Array.isArray(result.data)||result.data.length!==1;
    })) {
      throw new Error('Один или оба параллельных insert завершились ошибкой: '+
        results.map(function(result){return result.error&&result.error.message||'';}).join(' | '));
    }

    var rows=transactionConcurrencyPost_({
      action:'query',token:tokenA,table:'transactions',mode:'select',
      filters:[{column:'id',op:'in',values:[idA,idB]}],limit:5
    },'verify transactions');
    if(rows.error||!Array.isArray(rows.data)||rows.data.length!==2) {
      throw new Error('После двух одновременных записей ожидались ровно две операции.');
    }
    var byId={};
    rows.data.forEach(function(row){byId[String(row.id)]=row;});
    if(!byId[idA]||!byId[idB]||
       Number(byId[idA].amount_kopecks)!==12345||
       Number(byId[idB].amount_kopecks)!==67890||
       rows.data.some(function(row){return String(row.family_id)!==familyId;})) {
      throw new Error('Сохранённые строки не совпадают с двумя запросами или семейным ID.');
    }
    report.concurrent_requests=2;
    report.transactions_saved=2;
    report.amounts_kopecks=[12345,67890];
    report.result='PASS';
  } finally {
    if(fixtureAttempted) {
      try {
        var authMatches=authRows_().filter(function(row) {
          return String(row.email)===emailA||String(row.email)===emailB;
        });
        if(!userA) {
          var a=authMatches.filter(function(row){return String(row.email)===emailA;});
          if(a.length===1)userA=String(a[0].id);
        }
        if(!userB) {
          var b=authMatches.filter(function(row){return String(row.email)===emailB;});
          if(b.length===1)userB=String(b[0].id);
        }
        var familyMatches=userA?rows_('families').filter(function(row) {
          return String(row.created_by)===userA&&String(row.name)===familyName;
        }):[];
        if(!familyId&&familyMatches.length===1)familyId=String(familyMatches[0].id);

        transactionConcurrencyRemoveRows_('transactions',function(row) {
          return String(row.id)===idA||String(row.id)===idB;
        });
        if(familyId) {
          transactionConcurrencyRemoveRows_('categories',function(row){return String(row.family_id)===familyId;});
          transactionConcurrencyRemoveRows_('accounts',function(row){return String(row.family_id)===familyId;});
          transactionConcurrencyRemoveRows_('family_members',function(row){return String(row.family_id)===familyId;});
          transactionConcurrencyRemoveRows_('families',function(row){return String(row.id)===familyId;});
        }
        [userA,userB].filter(Boolean).forEach(function(uid) {
          transactionConcurrencyRemoveRows_('profiles',function(row){return String(row.id)===uid;});
        });
        authMatches.sort(function(a,b){return b.row-a.row;}).forEach(function(row){authSheet_().deleteRow(row.row);});

        var allProps=props.getProperties();
        Object.keys(allProps).forEach(function(key) {
          if(key.indexOf('session:')!==0)return;
          try {
            var session=JSON.parse(allProps[key]);
            if([userA,userB].filter(Boolean).indexOf(String(session.userId))!==-1)props.deleteProperty(key);
          } catch (_) {}
        });

        var remainingAuth=authRows_().some(function(row) {
          return String(row.email)===emailA||String(row.email)===emailB;
        });
        var remainingFamily=familyId&&rows_('families').some(function(row){return String(row.id)===familyId;});
        var remainingUsers=[userA,userB].filter(Boolean).some(function(uid) {
          return rows_('profiles').some(function(row){return String(row.id)===uid;});
        });
        var remainingTransactions=rows_('transactions').some(function(row) {
          return String(row.id)===idA||String(row.id)===idB;
        });
        if(remainingAuth||remainingFamily||remainingUsers||remainingTransactions) {
          throw new Error('После cleanup остались синтетические TEST-записи.');
        }
        report.cleanup='PASS';
      } catch(error) {
        cleanupErrors.push(String(error&&error.message||error));
        report.cleanup='FAILED';
        report.cleanup_errors=cleanupErrors;
        report.manual_cleanup_emails=[emailA,emailB];
        report.manual_cleanup_family_id=familyId||null;
        report.manual_cleanup_transaction_ids=[idA,idB];
      }
    } else report.cleanup='NOT_NEEDED';
  }
  if(cleanupErrors.length) {
    throw new Error('Очистка TEST transaction-concurrency fixtures не подтверждена: '+
      cleanupErrors.join('; ')+'. Transaction IDs: '+idA+', '+idB);
  }
  Logger.log(JSON.stringify(report));
  return report;
}

function transactionConcurrencyParse_(response,label) {
  var status=response.getResponseCode();
  if(status<200||status>=300)throw new Error((label||'request')+': HTTP '+status);
  var parsed;
  try{parsed=JSON.parse(response.getContentText());}
  catch(_){throw new Error((label||'request')+': ответ не является JSON');}
  if(!parsed||typeof parsed!=='object'||
     !Object.prototype.hasOwnProperty.call(parsed,'data')||
     !Object.prototype.hasOwnProperty.call(parsed,'error')) {
    throw new Error((label||'request')+': некорректная форма API-ответа');
  }
  return parsed;
}


/* ===== BUNDLE SECTION: tests/gas/RuntimeAcceptanceBatch.gs ===== */

/**
 * One-click orchestrator for the pending isolated TEST GAS runtime probes.
 * Copy this file together with the four referenced probe files into TEST GAS.
 * Every probe creates and cleans its own synthetic fixtures.
 */
function runIsolatedRuntimeAcceptanceBatch() {
  var props=PropertiesService.getScriptProperties();
  var url=String(props.getProperty('CONCURRENT_ROW_TEST_WEB_APP_URL')||'').trim();
  var confirmation=String(props.getProperty('CONCURRENT_ROW_TEST_CONFIRM')||'');
  assertIsolatedGasTestEnvironment_(props,confirmation,url);

  var tests=[
    {name:'Telegram duplicate delivery and retry',run:function(){return runTelegramUpdateConcurrencyTest();}},
    {name:'Optimistic read/write consistency',run:function(){return runReadConsistencyConcurrencyTest();}},
    {name:'Monthly-plan concurrent stale update',run:function(){return runMonthlyPlanConcurrencyTest();}},
    {name:'Two-member transaction insert concurrency',run:function(){return runTransactionConcurrencyTest();}}
  ];
  var results=[];
  var stoppedForCleanup=false;

  tests.forEach(function(test) {
    if(stoppedForCleanup)return;
    resetRuntimeAcceptanceCaches_();
    try {
      var report=test.run();
      var passed=!!report&&report.result==='PASS'&&report.cleanup==='PASS';
      results.push({test:test.name,result:passed?'PASS':'FAIL',report:report||null});
      if(!passed&&report&&report.cleanup==='FAILED')stoppedForCleanup=true;
    } catch(error) {
      var message=String(error&&error.message||error);
      results.push({test:test.name,result:'FAIL',error:message});
      if(/cleanup|очистк/i.test(message))stoppedForCleanup=true;
    } finally {
      resetRuntimeAcceptanceCaches_();
    }
  });

  var passedCount=results.filter(function(item){return item.result==='PASS';}).length;
  var failedCount=results.length-passedCount;
  var output={
    test:'isolated TEST runtime acceptance batch',
    completed:results.length,
    passed:passedCount,
    failed:failedCount,
    stopped_for_cleanup_failure:stoppedForCleanup,
    result:failedCount===0&&results.length===tests.length?'PASS':'FAIL',
    tests:results
  };
  Logger.log(JSON.stringify(output));
  return output;
}


/**
 * Each probe talks to the Web App in a separate Apps Script execution, but
 * cleanup reads the spreadsheet directly in this orchestrator execution.
 * Clear per-execution caches between probes so later cleanup never sees a
 * stale snapshot left by an earlier probe.
 */
function resetRuntimeAcceptanceCaches_() {
  ROWS_CACHE = {};
  TZ_CACHE = null;
  SS_CACHE = null;
  SHEET_SCHEMA_VALIDATED = {};
}
