/**
 * Live signup/join concurrency probes.
 * Copy ONLY into a bound isolated TEST spreadsheet / TEST Apps Script project.
 */
function runDuplicateEmailSignupConcurrencyTest() {
  var props=PropertiesService.getScriptProperties();
  var url=String(props.getProperty('SIGNUP_CONCURRENCY_TEST_WEB_APP_URL')||'').trim();
  var confirmation=String(props.getProperty('SIGNUP_CONCURRENCY_TEST_CONFIRM')||'');
  var productionScriptId='AKfycbxQLSZXG-R_AGZG5clVDGnMqd4_cwvwsPsf3_9mJ79Rnas7CZVeuIhtSi7FM5MMagkqqg';
  if(confirmation!=='ISOLATED_TEST_ONLY')throw new Error('Тест не разрешён: подтвердите изолированную среду.');
  var spreadsheet=SpreadsheetApp.getActiveSpreadsheet();
  if(!spreadsheet||!/test|тест/i.test(spreadsheet.getName()))throw new Error('Активная таблица должна иметь TEST/ТЕСТ в названии.');
  var match=url.match(/^https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec$/);
  if(!match||match[1]===productionScriptId)throw new Error('Нужен отдельный тестовый GAS Web App URL.');
  var email='lockprobe+'+Utilities.getUuid().replace(/-/g,'').toLowerCase()+'@example.test';
  var password='concurrency-probe-password';
  var payload={action:'signup',email:email,password:password,name:'Тест конкурентной регистрации'};
  var options={url:url,method:'post',contentType:'application/json',payload:JSON.stringify(payload),muteHttpExceptions:true};
  var report={test:'duplicate email concurrent signup',email:email};
  var cleanupError=null;
  try{
    var responses=UrlFetchApp.fetchAll([options,options]);
    var results=responses.map(function(response,index){return signupConcurrencyParse_(response,'signup '+index);});
    var successes=results.filter(function(result){return !result.error&&result.data&&result.data.user;});
    var failures=results.filter(function(result){return result.error;});
    if(successes.length!==1||failures.length!==1)throw new Error('Ожидалась одна успешная регистрация и один отказ; получено success='+successes.length+', errors='+failures.length);
    if(!/уже существует/i.test(failures[0].error.message||''))throw new Error('Второй запрос отклонён не по причине существующего email.');
    var users=authRows_().filter(function(user){return user.email===email;});
    if(users.length!==1||users[0].id!==successes[0].data.user.id)throw new Error('В _auth должна остаться ровно одна учётная запись.');
    var profiles=rows_('profiles').filter(function(profile){return String(profile.id)===String(users[0].id);});
    if(profiles.length!==1)throw new Error('Ожидался ровно один профиль для зарегистрированного пользователя.');
    report.successful_signups=successes.length;
    report.rejected_duplicates=failures.length;
    report.auth_rows=users.length;
    report.profile_rows=profiles.length;
    report.result='PASS';
  }finally{
    try{
      var auth=authRows_().filter(function(user){return user.email===email;});
      auth.forEach(function(user){
        var profileRows=rows_('profiles').filter(function(profile){return String(profile.id)===String(user.id);});
        if(profileRows.length)deleteRows_('profiles',profileRows);
        var all=props.getProperties();
        Object.keys(all).forEach(function(key){
          if(key.indexOf('session:')===0){
            try{var session=JSON.parse(all[key]);if(String(session.userId)===String(user.id))props.deleteProperty(key);}catch(_){}
          }
        });
        var current=authRows_().find(function(item){return item.id===user.id;});
        if(current)authSheet_().deleteRow(current.row);
      });
      if(authRows_().some(function(user){return user.email===email;}))throw new Error('Тестовая учётная запись осталась в _auth.');
      report.cleanup='PASS';
    }catch(error){cleanupError=String(error&&error.message||error);report.cleanup='FAILED';report.cleanup_error=cleanupError;report.manual_cleanup_email=email;}
  }
  if(cleanupError)throw new Error('Очистка не подтверждена для '+email+': '+cleanupError);
  Logger.log(JSON.stringify(report));return report;
}

function runConcurrentFamilyJoinTest() {
  var props=PropertiesService.getScriptProperties();
  var url=String(props.getProperty('JOIN_CONCURRENCY_TEST_WEB_APP_URL')||'').trim();
  var token=String(props.getProperty('JOIN_CONCURRENCY_TEST_TOKEN')||'').trim();
  var familyId=String(props.getProperty('JOIN_CONCURRENCY_TEST_FAMILY_ID')||'').trim();
  var confirmation=String(props.getProperty('JOIN_CONCURRENCY_TEST_CONFIRM')||'');
  var productionScriptId='AKfycbxQLSZXG-R_AGZG5clVDGnMqd4_cwvwsPsf3_9mJ79Rnas7CZVeuIhtSi7FM5MMagkqqg';
  if(confirmation!=='ISOLATED_TEST_ONLY')throw new Error('Тест не разрешён: подтвердите изолированную среду.');
  var spreadsheet=SpreadsheetApp.getActiveSpreadsheet();
  if(!spreadsheet||!/test|тест/i.test(spreadsheet.getName()))throw new Error('Активная таблица должна иметь TEST/ТЕСТ в названии.');
  var match=url.match(/^https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec$/);
  if(!match||match[1]===productionScriptId)throw new Error('Нужен отдельный тестовый GAS Web App URL.');
  if(!token||!familyId)throw new Error('Нужны тестовый токен и ID семьи.');
  var user=requireUser_(token);
  var family=rows_('families').find(function(item){return String(item.id)===familyId;});
  if(!family)throw new Error('Тестовая семья не найдена.');
  var membersBefore=rows_('family_members');
  if(membersBefore.some(function(member){return String(member.user_id)===user.id;}))throw new Error('Тестовый пользователь уже состоит в семье; нужен отдельный пользователь без членства.');
  var existingMembers=membersBefore.filter(function(member){return String(member.family_id)===familyId;});
  if(existingMembers.length!==1)throw new Error('Тестовая семья должна содержать ровно одного владельца, иначе два участника не смогут присоединиться из-за лимита семьи.');
  var request={
    url:url,method:'post',contentType:'application/json',muteHttpExceptions:true,
    payload:JSON.stringify({action:'joinFamily',token:token,invite_code:family.invite_code})
  };
  var report={test:'same user concurrently joins one family twice',family_id:familyId,user_id:user.id};
  var cleanupError=null;
  try{
    var responses=UrlFetchApp.fetchAll([request,request]);
    var results=responses.map(function(response,index){return signupConcurrencyParse_(response,'join '+index);});
    if(results.some(function(result){return result.error||!result.data;}))throw new Error('Один из повторных join-запросов завершился ошибкой.');
    var joined=rows_('family_members').filter(function(member){
      return String(member.family_id)===familyId&&String(member.user_id)===user.id;
    });
    if(joined.length!==1)throw new Error('Ожидалась ровно одна запись членства, найдено: '+joined.length);
    report.parallel_requests=2;report.membership_rows=joined.length;report.result='PASS';
  }finally{
    try{
      var created=rows_('family_members').filter(function(member){
        return String(member.family_id)===familyId&&String(member.user_id)===user.id;
      });
      if(created.length)deleteRows_('family_members',created);
      var remaining=rows_('family_members').filter(function(member){
        return String(member.family_id)===familyId&&String(member.user_id)===user.id;
      });
      if(remaining.length)throw new Error('Тестовое членство осталось после очистки.');
      report.cleanup='PASS';
    }catch(error){cleanupError=String(error&&error.message||error);report.cleanup='FAILED';report.cleanup_error=cleanupError;report.manual_cleanup_user_id=user.id;}
  }
  if(cleanupError)throw new Error('Очистка не подтверждена: '+cleanupError);
  Logger.log(JSON.stringify(report));return report;
}

function signupConcurrencyParse_(response,label){
  var status=response.getResponseCode();if(status<200||status>=300)throw new Error(label+': HTTP '+status);
  var parsed;try{parsed=JSON.parse(response.getContentText());}catch(_){throw new Error(label+': ответ не JSON');}
  if(!parsed||typeof parsed!=='object'||!Object.prototype.hasOwnProperty.call(parsed,'data')||!Object.prototype.hasOwnProperty.call(parsed,'error'))throw new Error(label+': некорректный API envelope');
  return parsed;
}
