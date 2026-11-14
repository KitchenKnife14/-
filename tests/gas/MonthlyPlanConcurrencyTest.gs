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

  function post(body,label) {
    return monthlyPlanTestParse_(UrlFetchApp.fetch(url,{
      method:'post',contentType:'application/json',
      payload:JSON.stringify(body),muteHttpExceptions:true
    }),label||'request');
  }
  function removeRows(table,predicate) {
    var matches=rows_(table).filter(predicate);
    if(matches.length)deleteRows_(table,matches);
  }

  try {
    fixtureAttempted=true;
    var signupA=post({action:'signup',email:emailA,password:passwordA,name:'TEST участник A'},'signup A');
    if(signupA.error||!signupA.data||!signupA.data.token||!signupA.data.user||!signupA.data.user.id) {
      throw new Error('Не удалось создать TEST участника A: '+(signupA.error&&signupA.error.message||'неожиданный ответ'));
    }
    tokenA=String(signupA.data.token);
    userA=String(signupA.data.user.id);

    var family=post({action:'createFamily',token:tokenA,name:familyName},'create family');
    if(family.error||!family.data||!family.data.id||!family.data.invite_code) {
      throw new Error('Не удалось создать TEST-семью: '+(family.error&&family.error.message||'неожиданный ответ'));
    }
    familyId=String(family.data.id);

    var signupB=post({action:'signup',email:emailB,password:passwordB,name:'TEST участник B'},'signup B');
    if(signupB.error||!signupB.data||!signupB.data.token||!signupB.data.user||!signupB.data.user.id) {
      throw new Error('Не удалось создать TEST участника B: '+(signupB.error&&signupB.error.message||'неожиданный ответ'));
    }
    tokenB=String(signupB.data.token);
    userB=String(signupB.data.user.id);

    var joined=post({
      action:'joinFamily',token:tokenB,invite_code:family.data.invite_code,
      display_name:'TEST участник B'
    },'join family');
    if(joined.error||!joined.data||String(joined.data.id)!==familyId) {
      throw new Error('Не удалось добавить второго TEST участника: '+(joined.error&&joined.error.message||'неожиданный ответ'));
    }

    var categories=post({
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
    var inserted=post({
      action:'query',token:tokenA,table:'monthly_plans',mode:'upsert',
      onConflict:'family_id,month_date,category_id,type',returning:true,
      values:Object.assign({id:planId,planned_kopecks:10000,note:'Исходный TEST план'},key)
    },'insert monthly plan');
    if(inserted.error||!Array.isArray(inserted.data)||inserted.data.length!==1||
       String(inserted.data[0].id)!==planId) {
      throw new Error('Не удалось создать TEST monthly plan: '+(inserted.error&&inserted.error.message||'неожиданный ответ'));
    }

    var selected=post({
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

    var final=post({
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

        removeRows('monthly_plans',function(row){return String(row.id)===planId;});
        if(familyId) {
          removeRows('categories',function(row){return String(row.family_id)===familyId;});
          removeRows('accounts',function(row){return String(row.family_id)===familyId;});
          removeRows('family_members',function(row){return String(row.family_id)===familyId;});
          removeRows('families',function(row){return String(row.id)===familyId;});
        }
        [userA,userB].filter(Boolean).forEach(function(uid) {
          removeRows('profiles',function(row){return String(row.id)===uid;});
        });
        authMatches.forEach(function(row){authSheet_().deleteRow(row.row);});

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
