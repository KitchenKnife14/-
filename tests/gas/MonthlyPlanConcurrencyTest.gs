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
      onConflict:'family_id,month_date,category_id,type',
      values:Object.assign({id:planId,planned_kopecks:10000,note:'Исходный TEST план'},key)
    },'insert monthly plan');
    // GAS query_(mode=upsert) intentionally returns data:null; verify persistence
    // with a separate authenticated read instead of expecting PostgREST returning rows.
    if(inserted.error) {
      throw new Error('Не удалось создать TEST monthly plan: '+inserted.error.message);
    }

    var selected=monthlyPlanPost_({
      action:'query',token:tokenA,table:'monthly_plans',mode:'select',
      filters:[{column:'id',op:'eq',value:planId}],limit:1
    },'read plan snapshot');
    if(selected.error||!Array.isArray(selected.data)||selected.data.length!==1||
       String(selected.data[0].id)!==planId||Number(selected.data[0].planned_kopecks)!==10000) {
      throw new Error('TEST monthly plan не сохранён или не совпадает с исходными данными: '+
        (selected.error&&selected.error.message||'запись не найдена/не совпадает'));
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
        var authCleanup=monthlyPlanDeleteSyntheticAuthRows_([emailA,emailB]);
        if(authCleanup.remaining!==0) {
          throw new Error('Не удалось удалить все точные synthetic auth rows: '+JSON.stringify(authCleanup));
        }

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
        SpreadsheetApp.flush();
        delete ROWS_CACHE.monthly_plans;
        delete ROWS_CACHE.families;
        delete ROWS_CACHE.profiles;
        SpreadsheetApp.flush();
        delete ROWS_CACHE.monthly_plans;
        delete ROWS_CACHE.families;
        delete ROWS_CACHE.profiles;
        remainingAuth=authRows_().some(function(row){return String(row.email)===emailA||String(row.email)===emailB;});
        remainingPlan=rows_('monthly_plans').some(function(row){return String(row.id)===planId;});
        remainingFamily=familyId&&rows_('families').some(function(row){return String(row.id)===familyId;});
        remainingUsers=[userA,userB].filter(Boolean).some(function(uid){return rows_('profiles').some(function(row){return String(row.id)===uid;});});
        if(remainingAuth||remainingPlan||remainingFamily||remainingUsers) {
          throw new Error('После cleanup остались синтетические TEST-записи: '+JSON.stringify({auth:!!remainingAuth,plan:!!remainingPlan,family:!!remainingFamily,users:!!remainingUsers,userA:userA||null,userB:userB||null,familyId:familyId||null,planId:planId}));
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


/**
 * Delete only the exact synthetic TEST auth emails. Row numbers are read from
 * the live _auth email column immediately before deletion and removed bottom-up.
 * This deliberately avoids stale row indexes captured by authRows_ earlier.
 */
function monthlyPlanDeleteSyntheticAuthRows_(emails) {
  var targets={};
  (emails||[]).forEach(function(email) {
    var normalized=String(email||'').trim().toLowerCase();
    if(normalized)targets[normalized]=true;
  });
  var sh=authSheet_();
  var last=sh.getLastRow();
  var values=last>=2?timedSheetRead_(function(){return sh.getRange(2,2,last-1,1).getValues();}):[];
  var rows=[];
  values.forEach(function(row,index) {
    var email=String(row[0]||'').trim().toLowerCase();
    if(targets[email])rows.push(index+2);
  });
  rows.sort(function(a,b){return b-a;}).forEach(function(rowNumber) {
    timedSheetWrite_(function(){sh.deleteRow(rowNumber);});
  });
  var afterLast=sh.getLastRow();
  var after=afterLast>=2?timedSheetRead_(function(){return sh.getRange(2,2,afterLast-1,1).getValues();}):[];
  var remaining=after.filter(function(row) {
    return !!targets[String(row[0]||'').trim().toLowerCase()];
  }).length;
  return {matched:rows.length,deleted:rows.length,remaining:remaining};
}

/**
 * One-time recovery for the exact synthetic fixture left by the failed
 * 2026-11-15 TEST monthly-plan run. No other auth rows are eligible.
 */
function cleanupLatestFailedMonthlyPlanFixture() {
  var props=PropertiesService.getScriptProperties();
  var url=String(props.getProperty('CONCURRENT_ROW_TEST_WEB_APP_URL')||'').trim();
  var confirmation=String(props.getProperty('CONCURRENT_ROW_TEST_CONFIRM')||'');
  assertIsolatedGasTestEnvironment_(props,confirmation,url);
  var suffix='c4c8cab147c74f1cb9d87540ef684349';
  var emails=[
    'monthly-plan-a+'+suffix+'@example.test',
    'monthly-plan-b+'+suffix+'@example.test'
  ];
  var before=authRows_().filter(function(row){return emails.indexOf(String(row.email).toLowerCase())!==-1;});
  var userIds=before.map(function(row){return String(row.id);});
  var cleanup=monthlyPlanDeleteSyntheticAuthRows_(emails);
  var allProps=props.getProperties();
  Object.keys(allProps).forEach(function(key) {
    if(key.indexOf('session:')!==0)return;
    try {
      var session=JSON.parse(allProps[key]);
      if(userIds.indexOf(String(session.userId))!==-1)props.deleteProperty(key);
    } catch (_) {}
  });
  var remaining=authRows_().filter(function(row){return emails.indexOf(String(row.email).toLowerCase())!==-1;});
  if(remaining.length||cleanup.remaining!==0) {
    throw new Error('Recovery не завершён: '+JSON.stringify({
      matched_before:before.length,deleted:cleanup.deleted,
      remaining_auth:remaining.length,emails:emails
    }));
  }
  var report={
    test:'monthly-plan failed fixture auth cleanup recovery',
    fixture:'exact synthetic TEST-only emails',
    matched_before:before.length,
    deleted:cleanup.deleted,
    verified_remaining:{auth:false},
    result:'PASS',
    cleanup:'PASS'
  };
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
