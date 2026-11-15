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
        throw new Error('Параллельное чтение '+j+' завершилось ошибкой: '+
          JSON.stringify({outerError:result.error||null,data:result.data||null}));
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
