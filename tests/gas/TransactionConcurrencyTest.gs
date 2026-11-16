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
  function transactionConcurrencyFreshRows_(table) {
    delete ROWS_CACHE[table];
    return rows_(table);
  }
  function transactionConcurrencyRemoveRows_(table,predicate) {
    var matches=transactionConcurrencyFreshRows_(table).filter(predicate);
    if(matches.length)deleteRows_(table,matches);
    delete ROWS_CACHE[table];
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
        var authCleanup=monthlyPlanDeleteSyntheticAuthRows_([emailA,emailB]);
        if(authCleanup.remaining!==0) {
          throw new Error('Не удалось удалить точные synthetic auth rows: '+JSON.stringify(authCleanup));
        }

        var allProps=props.getProperties();
        Object.keys(allProps).forEach(function(key) {
          if(key.indexOf('session:')!==0)return;
          try {
            var session=JSON.parse(allProps[key]);
            if([userA,userB].filter(Boolean).indexOf(String(session.userId))!==-1)props.deleteProperty(key);
          } catch (_) {}
        });

        SpreadsheetApp.flush();
        var remainingAuth=authRows_().filter(function(row) {
          return String(row.email)===emailA||String(row.email)===emailB;
        }).length;
        var remainingFamily=transactionConcurrencyFreshRows_('families').some(function(row){return String(row.id)===familyId;});
        var remainingUsers=[userA,userB].filter(Boolean).some(function(uid) {
          return transactionConcurrencyFreshRows_('profiles').some(function(row){return String(row.id)===uid;});
        });
        var remainingTransactions=transactionConcurrencyFreshRows_('transactions').filter(function(row) {
          return String(row.id)===idA||String(row.id)===idB;
        }).map(function(row){return String(row.id);});
        var remainingMembers=familyId&&transactionConcurrencyFreshRows_('family_members').some(function(row){return String(row.family_id)===familyId;});
        var remainingCategories=familyId&&transactionConcurrencyFreshRows_('categories').some(function(row){return String(row.family_id)===familyId;});
        var remainingAccounts=familyId&&transactionConcurrencyFreshRows_('accounts').some(function(row){return String(row.family_id)===familyId;});
        if(remainingAuth||remainingFamily||remainingUsers||remainingTransactions.length||remainingMembers||remainingCategories||remainingAccounts) {
          throw new Error('После cleanup остались синтетические TEST-записи: '+JSON.stringify({
            auth:remainingAuth,family:!!remainingFamily,users:!!remainingUsers,
            transactions:remainingTransactions,members:!!remainingMembers,
            categories:!!remainingCategories,accounts:!!remainingAccounts,
            userA:userA||null,userB:userB||null,familyId:familyId||null
          }));
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

/**
 * One-time recovery for the exact synthetic transaction fixture left by the
 * failed 2026-11-16 TEST runtime acceptance batch. No other rows are eligible.
 */
function cleanupLatestFailedTransactionConcurrencyFixture() {
  var props=PropertiesService.getScriptProperties();
  var url=String(props.getProperty('CONCURRENT_ROW_TEST_WEB_APP_URL')||'').trim();
  var confirmation=String(props.getProperty('CONCURRENT_ROW_TEST_CONFIRM')||'');
  assertIsolatedGasTestEnvironment_(props,confirmation,url);
  var suffix='68700ec94e5e4ffc997323a9575ce8ad';
  var emailA='transaction-race-a+'+suffix+'@example.test';
  var emailB='transaction-race-b+'+suffix+'@example.test';
  var idA='txrace_a_'+suffix,idB='txrace_b_'+suffix;
  var familyName='TEST transaction race '+suffix;
  var authMatches=authRows_().filter(function(row) {
    return String(row.email)===emailA||String(row.email)===emailB;
  });
  var userA=authMatches.filter(function(row){return String(row.email)===emailA;});
  var userB=authMatches.filter(function(row){return String(row.email)===emailB;});
  var userIds=[userA.length===1?String(userA[0].id):'',userB.length===1?String(userB[0].id):''].filter(Boolean);
  delete ROWS_CACHE.families;
  var familyMatches=rows_('families').filter(function(row) {
    return String(row.name)===familyName&&(!userIds.length||userIds.indexOf(String(row.created_by))!==-1);
  });
  if(familyMatches.length>1)throw new Error('Recovery остановлен: найдено больше одной семьи с точным TEST-именем.');
  var familyId=familyMatches.length===1?String(familyMatches[0].id):'';
  function removeExact(table,predicate) {
    delete ROWS_CACHE[table];
    var matches=rows_(table).filter(predicate);
    if(matches.length)deleteRows_(table,matches);
    delete ROWS_CACHE[table];
  }
  removeExact('transactions',function(row){return String(row.id)===idA||String(row.id)===idB;});
  if(familyId) {
    ['categories','accounts','family_members'].forEach(function(table) {
      removeExact(table,function(row){return String(row.family_id)===familyId;});
    });
    removeExact('families',function(row){return String(row.id)===familyId;});
  }
  userIds.forEach(function(uid) {
    removeExact('profiles',function(row){return String(row.id)===uid;});
  });
  var authCleanup=monthlyPlanDeleteSyntheticAuthRows_([emailA,emailB]);
  var allProps=props.getProperties();
  Object.keys(allProps).forEach(function(key) {
    if(key.indexOf('session:')!==0)return;
    try {
      var session=JSON.parse(allProps[key]);
      if(userIds.indexOf(String(session.userId))!==-1)props.deleteProperty(key);
    } catch (_) {}
  });
  SpreadsheetApp.flush();
  var remainingAuth=authRows_().filter(function(row){return row.email===emailA||row.email===emailB;}).length;
  delete ROWS_CACHE.transactions;
  var remainingTransactions=rows_('transactions').filter(function(row){return String(row.id)===idA||String(row.id)===idB;}).map(function(row){return String(row.id);});
  delete ROWS_CACHE.families;
  var remainingFamily=!!(familyId&&rows_('families').some(function(row){return String(row.id)===familyId;}));
  var remainingUsers=[];
  userIds.forEach(function(uid){delete ROWS_CACHE.profiles;if(rows_('profiles').some(function(row){return String(row.id)===uid;}))remainingUsers.push(uid);});
  delete ROWS_CACHE.family_members;
  var remainingMembers=!!(familyId&&rows_('family_members').some(function(row){return String(row.family_id)===familyId;}));
  delete ROWS_CACHE.categories;
  var remainingCategories=!!(familyId&&rows_('categories').some(function(row){return String(row.family_id)===familyId;}));
  delete ROWS_CACHE.accounts;
  var remainingAccounts=!!(familyId&&rows_('accounts').some(function(row){return String(row.family_id)===familyId;}));
  if(authCleanup.remaining!==0||remainingAuth||remainingTransactions.length||remainingFamily||remainingUsers.length||remainingMembers||remainingCategories||remainingAccounts) {
    throw new Error('Recovery не завершён: '+JSON.stringify({
      auth:remainingAuth,transactions:remainingTransactions,family:remainingFamily,
      users:remainingUsers,members:remainingMembers,categories:remainingCategories,
      accounts:remainingAccounts,auth_cleanup:authCleanup
    }));
  }
  var report={
    test:'transaction concurrency failed fixture recovery',
    fixture:'exact synthetic TEST-only emails and transaction IDs',
    matched_auth_before:authMatches.length,deleted_auth:authCleanup.deleted,
    verified_remaining:{auth:false,transactions:[],family:false,users:[],members:false,categories:false,accounts:false},
    result:'PASS',cleanup:'PASS'
  };
  Logger.log(JSON.stringify(report));
  return report;
}
