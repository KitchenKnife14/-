/**
 * Runs a real multi-execution read/write consistency probe.
 * Copy ONLY into a bound, isolated TEST spreadsheet / TEST Apps Script project.
 * It creates one uniquely identified planned purchase, confirms it while parallel
 * read batches query both the purchase and its generated transaction, then cleans up.
 */
function runReadConsistencyConcurrencyTest() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('READ_CONSISTENCY_TEST_WEB_APP_URL') || '').trim();
  var token = String(props.getProperty('READ_CONSISTENCY_TEST_TOKEN') || '').trim();
  var familyId = String(props.getProperty('READ_CONSISTENCY_TEST_FAMILY_ID') || '').trim();
  var confirmation = String(props.getProperty('READ_CONSISTENCY_TEST_CONFIRM') || '');
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
  if (!token || !familyId) throw new Error('Не заданы тестовые token или family ID.');

  var id = 'readcheck_' + Utilities.getUuid().replace(/-/g, '').toLowerCase();
  var transactionId = 'purchase_' + id;
  var today = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd');
  var created = false;
  var report = {test:'optimistic read/write consistency', purchase_id:id, transaction_id:transactionId};
  var cleanupError = null;

  try {
    var inserted = readConsistencyTestPost_(url, {
      action:'query', token:token, table:'planned_purchases', mode:'insert', returning:true,
      values:{
        id:id, family_id:familyId, name:'Диагностика согласованного чтения',
        category_id:null, estimated_kopecks:137, priority:3,
        desired_month:today.slice(0,7)+'-01', desired_date:today,
        url:'', comment:'Автоматический тест; запись будет удалена',
        status:'planned', goal_id:null, linked_transaction_id:''
      }
    });
    if (inserted.error || !Array.isArray(inserted.data) || inserted.data.length !== 1 ||
        String(inserted.data[0].id) !== id) {
      throw new Error('Не удалось создать изолированную тестовую покупку: ' + (inserted.error && inserted.error.message || 'неожиданный ответ'));
    }
    created = true;

    var writer = {
      url:url, method:'post', contentType:'application/json', muteHttpExceptions:true,
      payload:JSON.stringify({
        action:'rpc', token:token, name:'confirm_planned_purchase',
        params:{p_purchase_id:id, p_account_id:'', p_operation_date:today}
      })
    };
    var reader = {
      url:url, method:'post', contentType:'application/json', muteHttpExceptions:true,
      payload:JSON.stringify({
        action:'batch', token:token,
        requests:[
          {action:'query', table:'planned_purchases', mode:'select', filters:[{column:'id',op:'eq',value:id}], limit:1},
          {action:'query', table:'transactions', mode:'select', filters:[{column:'id',op:'eq',value:transactionId}], limit:1}
        ]
      })
    };
    var requests = [writer];
    for (var i=0;i<16;i++) requests.push(reader);
    var started = Date.now();
    var responses = UrlFetchApp.fetchAll(requests);
    var elapsed = Date.now()-started;
    var writerResult = readConsistencyTestParse_(responses[0], 'confirm planned purchase');
    if (writerResult.error) throw new Error('Запись не завершилась: ' + writerResult.error.message);

    var beforeCount=0,afterCount=0;
    for (var j=1;j<responses.length;j++) {
      var snapshot = readConsistencyTestParse_(responses[j], 'parallel read '+j);
      if (snapshot.error || !Array.isArray(snapshot.data) || snapshot.data.length !== 2 ||
          snapshot.data.some(function(item){return item.error;})) {
        throw new Error('Параллельное чтение '+j+' завершилось ошибкой.');
      }
      var purchases=snapshot.data[0].data,transactions=snapshot.data[1].data;
      if (!Array.isArray(purchases) || purchases.length!==1 || !Array.isArray(transactions)) {
        throw new Error('Параллельное чтение '+j+' вернуло неполный снимок.');
      }
      var isBefore=purchases[0].status==='planned'&&transactions.length===0;
      var isAfter=purchases[0].status==='bought'&&transactions.length===1;
      if (!isBefore&&!isAfter) {
        throw new Error('Обнаружен несогласованный снимок: статус покупки '+purchases[0].status+', операций '+transactions.length+'.');
      }
      if(isBefore)beforeCount++;else afterCount++;
    }

    var finalSnapshot=readConsistencyTestPost_(url,{
      action:'batch',token:token,
      requests:[
        {action:'query',table:'planned_purchases',mode:'select',filters:[{column:'id',op:'eq',value:id}],limit:1},
        {action:'query',table:'transactions',mode:'select',filters:[{column:'id',op:'eq',value:transactionId}],limit:1}
      ]
    });
    if(finalSnapshot.error||!Array.isArray(finalSnapshot.data)||finalSnapshot.data.length!==2||
       finalSnapshot.data[0].error||finalSnapshot.data[1].error||
       finalSnapshot.data[0].data[0].status!=='bought'||finalSnapshot.data[1].data.length!==1) {
      throw new Error('Итоговое состояние после подтверждения покупки некорректно.');
    }

    report.parallel_read_requests=16;
    report.before_snapshots=beforeCount;
    report.after_snapshots=afterCount;
    report.fetch_all_elapsed_ms=elapsed;
    report.result='PASS';
  } finally {
    if(created) {
      try {
        var deleteTransaction=readConsistencyTestPost_(url,{
          action:'query',token:token,table:'transactions',mode:'delete',
          filters:[{column:'id',op:'eq',value:transactionId}]
        });
        if(deleteTransaction.error) throw new Error(deleteTransaction.error.message||'transaction cleanup failed');
        var deletePurchase=readConsistencyTestPost_(url,{
          action:'query',token:token,table:'planned_purchases',mode:'delete',
          filters:[{column:'id',op:'eq',value:id}]
        });
        if(deletePurchase.error) throw new Error(deletePurchase.error.message||'purchase cleanup failed');
        var verify=readConsistencyTestPost_(url,{
          action:'batch',token:token,
          requests:[
            {action:'query',table:'planned_purchases',mode:'select',filters:[{column:'id',op:'eq',value:id}]},
            {action:'query',table:'transactions',mode:'select',filters:[{column:'id',op:'eq',value:transactionId}]}
          ]
        });
        if(verify.error||verify.data[0].error||verify.data[1].error||
           verify.data[0].data.length!==0||verify.data[1].data.length!==0) {
          throw new Error('Тестовые строки остались после очистки.');
        }
        report.cleanup='PASS';
      } catch(error) {
        cleanupError=String(error&&error.message||error);
        report.cleanup='FAILED';
        report.cleanup_error=cleanupError;
        report.manual_cleanup_ids=[id,transactionId];
      }
    } else report.cleanup='NOT_NEEDED';
  }
  if(cleanupError) throw new Error('Очистка не подтверждена. Проверьте ID '+id+' и '+transactionId+': '+cleanupError);
  Logger.log(JSON.stringify(report));
  return report;
}

function readConsistencyTestPost_(url,body) {
  return readConsistencyTestParse_(UrlFetchApp.fetch(url,{
    method:'post',contentType:'application/json',payload:JSON.stringify(body),muteHttpExceptions:true
  }),'request');
}
function readConsistencyTestParse_(response,label) {
  var status=response.getResponseCode();
  if(status<200||status>=300) throw new Error(label+': HTTP '+status);
  var parsed;
  try{parsed=JSON.parse(response.getContentText());}
  catch(_){throw new Error(label+': ответ не является JSON');}
  if(!parsed||typeof parsed!=='object'||!Object.prototype.hasOwnProperty.call(parsed,'data')||
     !Object.prototype.hasOwnProperty.call(parsed,'error')) throw new Error(label+': некорректная форма API-ответа');
  return parsed;
}
