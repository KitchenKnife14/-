/**
 * Google Apps Script backend for the family budget app.
 * Bind this project to the spreadsheet "Семейный бюджет".
 *
 * Deploy as Web App, execute as owner. The frontend sends text/plain JSON to avoid
 * browser preflight; do not share the spreadsheet itself publicly.
 */
const TABLES = {
  profiles: ['id','display_name','avatar_color','timezone','created_at'],
  families: ['id','name','invite_code','currency','created_at','created_by'],
  family_members: ['id','family_id','user_id','role','joined_at'],
  categories: ['id','family_id','parent_id','name','kind','color','icon','archived','sort_order','created_at'],
  accounts: ['id','family_id','name','kind','owner_user_id','starting_balance_kopecks','archived','created_at'],
  transactions: ['id','family_id','type','amount_kopecks','operation_date','operation_time','category_id','account_id','to_account_id','description','created_by','updated_by','planned','parent_recurring_id','created_at','updated_at','responsible_user_id'],
  recurring_payments: ['id','family_id','type','amount_kopecks','category_id','account_id','description','start_date','end_date','frequency','custom_interval_days','next_due_date','remind','active','created_by','created_at','responsible_user_id'],
  budgets: ['id','family_id','category_id','month_date','limit_kopecks','warn_75','warn_90','warn_100'],
  goals: ['id','family_id','name','description','target_kopecks','saved_kopecks','target_date','priority','status','responsible_user_id','created_at'],
  goal_contributions: ['id','goal_id','amount_kopecks','contribution_date','note','created_by','created_at'],
  planned_purchases: ['id','family_id','name','category_id','estimated_kopecks','priority','desired_month','desired_date','url','comment','status','responsible_user_id','goal_id','linked_transaction_id','created_by','created_at'],
  monthly_plans: ['id','family_id','month_date','category_id','type','planned_kopecks','note'],
  notifications: ['id','family_id','user_id','kind','title','body','read','created_at'],
  telegram_links: ['id','telegram_user_id','telegram_chat_id','user_id','family_id','linked_at'],
  telegram_link_codes: ['id','user_id','family_id','code_hash','expires_at','used_at','created_at']
};
const AUTH_SHEET = '_auth';
const SESSION_TTL = 60 * 60 * 24 * 14;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const API_VERSION=11, BATCH_MAX=25;
let PBKDF2_MS=0; // суммарное время PBKDF2 внутри текущего запроса
let SS_CACHE=null, SHEET_READS=0, SHEET_WRITES=0, SHEET_READ_MS=0, SHEET_WRITE_MS=0, REVISION_WRITE_FAILURES=0; // метрики сервисных вызовов Sheets и ревизий на один запрос
function timedSheetRead_(fn){const t=Date.now();try{return fn();}finally{SHEET_READ_MS+=Date.now()-t;}}
function timedSheetWrite_(fn){const t=Date.now();try{return fn();}finally{SHEET_WRITE_MS+=Date.now()-t;}}
const DEFAULT_CATEGORIES=[{"name":"Жильё и обязательные платежи","kind":"expense","icon":"🏠","color":"#2563eb","children":[{"name":"Аренда квартиры","icon":"🔑","color":"#2563eb"},{"name":"Ипотека","icon":"🏦","color":"#2563eb"},{"name":"Коммунальные услуги","icon":"💡","color":"#2563eb"},{"name":"Интернет","icon":"🌐","color":"#2563eb"},{"name":"Мобильная связь","icon":"📱","color":"#2563eb"},{"name":"Обслуживание жилья","icon":"🧰","color":"#2563eb"},{"name":"Ремонт","icon":"🛠️","color":"#2563eb"},{"name":"Мебель и предметы интерьера","icon":"🛋️","color":"#2563eb"}]},{"name":"Продукты и питание","kind":"expense","icon":"🛒","color":"#16a34a","children":[{"name":"Продукты домой","icon":"🥦","color":"#16a34a"},{"name":"Кафе и рестораны","icon":"🍽️","color":"#16a34a"},{"name":"Доставка еды","icon":"🛵","color":"#16a34a"},{"name":"Кофе и перекусы на работе","icon":"☕","color":"#16a34a"}]},{"name":"Быт","kind":"expense","icon":"🧴","color":"#0891b2","children":[{"name":"Бытовая химия","icon":"🧼","color":"#0891b2"},{"name":"Средства гигиены","icon":"🪥","color":"#0891b2"},{"name":"Товары для дома","icon":"🏠","color":"#0891b2"},{"name":"Расходные материалы","icon":"📦","color":"#0891b2"},{"name":"Мелкие бытовые покупки","icon":"🧺","color":"#0891b2"}]},{"name":"Транспорт","kind":"expense","icon":"🚌","color":"#ea580c","children":[{"name":"Общественный транспорт","icon":"🚇","color":"#ea580c"},{"name":"Такси","icon":"🚕","color":"#ea580c"},{"name":"Бензин","icon":"⛽","color":"#ea580c"},{"name":"Обслуживание автомобиля","icon":"🚗","color":"#ea580c"},{"name":"Ремонт автомобиля","icon":"🔧","color":"#ea580c"},{"name":"Страхование и документы","icon":"📄","color":"#ea580c"},{"name":"Парковка","icon":"🅿️","color":"#ea580c"}]},{"name":"Здоровье","kind":"expense","icon":"🩺","color":"#dc2626","children":[{"name":"Врачи","icon":"👨‍⚕️","color":"#dc2626"},{"name":"Анализы и обследования","icon":"🧪","color":"#dc2626"},{"name":"Лекарства","icon":"💊","color":"#dc2626"},{"name":"Стоматология","icon":"🦷","color":"#dc2626"},{"name":"Медицинские процедуры","icon":"💉","color":"#dc2626"}]},{"name":"Личные расходы","kind":"expense","icon":"👕","color":"#7c3aed","children":[{"name":"Одежда и обувь","icon":"👕","color":"#7c3aed"},{"name":"Косметика","icon":"💄","color":"#7c3aed"},{"name":"Уход за собой","icon":"💆","color":"#7c3aed"},{"name":"Личные покупки","icon":"🛍️","color":"#7c3aed"}]},{"name":"Развлечения","kind":"expense","icon":"🎮","color":"#db2777","children":[{"name":"Кино и мероприятия","icon":"🎬","color":"#db2777"},{"name":"Игры","icon":"🎮","color":"#db2777"},{"name":"Подписки","icon":"📺","color":"#db2777"},{"name":"Музыка","icon":"🎵","color":"#db2777"},{"name":"Хобби","icon":"🎨","color":"#db2777"},{"name":"Путешествия и отдых","icon":"✈️","color":"#db2777"}]},{"name":"Техника","kind":"expense","icon":"💻","color":"#0f766e","children":[{"name":"Смартфоны","icon":"📱","color":"#0f766e"},{"name":"Компьютеры и комплектующие","icon":"💻","color":"#0f766e"},{"name":"Телевизоры","icon":"📺","color":"#0f766e"},{"name":"Бытовая техника","icon":"🔌","color":"#0f766e"},{"name":"Аудиотехника","icon":"🎧","color":"#0f766e"},{"name":"Аксессуары","icon":"🎮","color":"#0f766e"}]},{"name":"Семья и подарки","kind":"expense","icon":"🎁","color":"#c026d3","children":[{"name":"Подарки","icon":"🎁","color":"#c026d3"},{"name":"Праздники","icon":"🎉","color":"#c026d3"},{"name":"Совместные мероприятия","icon":"🥳","color":"#c026d3"},{"name":"Расходы на родственников","icon":"👨‍👩‍👧","color":"#c026d3"}]},{"name":"Финансовые операции","kind":"transfer","icon":"🔁","color":"#64748b","children":[{"name":"Погашение кредитов","icon":"💳","color":"#64748b"},{"name":"Проценты по кредитам","icon":"📈","color":"#64748b"},{"name":"Комиссии","icon":"💸","color":"#64748b"},{"name":"Банковские услуги","icon":"🏦","color":"#64748b"},{"name":"Переводы между счетами","icon":"🔁","color":"#64748b"}]},{"name":"Накопления","kind":"expense","icon":"🐷","color":"#059669","children":[{"name":"Резервный фонд","icon":"🛟","color":"#059669"},{"name":"Накопления на квартиру","icon":"🏢","color":"#059669"},{"name":"Накопления на автомобиль","icon":"🚙","color":"#059669"},{"name":"Накопления на крупные покупки","icon":"💰","color":"#059669"},{"name":"Другие цели","icon":"🎯","color":"#059669"}]},{"name":"Прочее","kind":"expense","icon":"📦","color":"#6b7280","children":[{"name":"Непредвиденные расходы","icon":"⚠️","color":"#6b7280"},{"name":"Неопределённая категория","icon":"❓","color":"#6b7280"}]},{"name":"Доходы","kind":"income","icon":"💵","color":"#16a34a","children":[{"name":"Зарплата первого участника","icon":"👨","color":"#16a34a"},{"name":"Зарплата второго участника","icon":"👩","color":"#16a34a"},{"name":"Премии","icon":"🌟","color":"#16a34a"},{"name":"Подработки","icon":"🛠️","color":"#16a34a"},{"name":"Возвраты и компенсации","icon":"↩️","color":"#16a34a"},{"name":"Доходы от продажи вещей","icon":"🏷️","color":"#16a34a"},{"name":"Проценты и инвестиционный доход","icon":"📈","color":"#16a34a"},{"name":"Прочие доходы","icon":"➕","color":"#16a34a"}]}];
// Кэш чтения листов на время ОДНОГО запроса (сбрасывается в doPost и после каждой записи).
let ROWS_CACHE = {};
let TZ_CACHE = null;
// Read-candidate requests must never provision or repair spreadsheet structure.
let READ_ONLY_REQUEST = false;
// Header validation is cached only inside one execution, never across requests.
let SHEET_SCHEMA_VALIDATED = {};
// Столбцы, которые должны оставаться текстом (иначе Google Sheets превращает даты/время в Date,
// а строки, начинающиеся с "=", в формулы).
const TEXT_COLS = ['created_at','updated_at','joined_at','linked_at','expires_at','used_at','operation_date','operation_time','start_date','end_date','next_due_date','month_date','target_date','desired_month','desired_date','contribution_date','description','name','note','comment','body','title','url','invite_code','display_name','telegram_user_id','telegram_chat_id','code_hash','responsible_user_id'];

function doGet() {
  const out={status:'ok', message:'Сервер работает', version:API_VERSION};
  // Имя таблицы показываем только если в свойствах скрипта задано DEBUG_INFO=1 (для проверки, что это тестовая таблица).
  if(PropertiesService.getScriptProperties().getProperty('DEBUG_INFO')==='1')out.spreadsheet=SpreadsheetApp.getActiveSpreadsheet().getName();
  return json_(out);
}
/**
 * Read candidates are strictly allow-listed above. Their handlers must remain side-effect-free.
 * All writes publish a short-lived "writing" marker while holding ScriptLock; readers accept
 * an optimistic result only when the same stable marker surrounds the entire read.
 */

function requestLockMode_(request){
  const isRead=request=>{
    if(!request||typeof request!=='object'||Array.isArray(request))return false;
    const action=String(request.action||'');
    if(action==='getSession'||action==='getUser')return true;
    if(action==='query')return !request.mode||request.mode==='select';
    if(action==='rpc')return ['get_table_revision','get_telegram_link_status','get_my_context'].includes(String(request.name||''));
    if(action==='batch'){
      if(!Array.isArray(request.requests)||request.requests.length===0)return false;
      return request.requests.every(isRead);
    }
    return false;
  };
  return isRead(request)?'read-candidate':'write';
}

const READ_CONSISTENCY_PROPERTY = 'api_read_consistency_v1';
let CONSISTENCY_MARKER_WRITE_FAILURES = 0;
function readConsistencyState_(){
  try{
    const value=PropertiesService.getScriptProperties().getProperty(READ_CONSISTENCY_PROPERTY);
    return value===null?'stable:0':String(value);
  }catch(_){return null;}
}
function isStableConsistencyState_(value){return typeof value==='string'&&/^stable:[A-Za-z0-9-]+$/.test(value);}
function beginWriteConsistency_(){
  const marker='writing:'+Utilities.getUuid();
  // The marker must be durable before any application data or session state is changed.
  PropertiesService.getScriptProperties().setProperty(READ_CONSISTENCY_PROPERTY,marker);
  return 'stable:'+marker.slice('writing:'.length);
}
function finishWriteConsistency_(stableState){
  if(!stableState)return;
  try{PropertiesService.getScriptProperties().setProperty(READ_CONSISTENCY_PROPERTY,stableState);}
  catch(_){CONSISTENCY_MARKER_WRITE_FAILURES++;}
}
function recoverConsistencyUnderLock_(){
  const current=readConsistencyState_();
  if(isStableConsistencyState_(current))return;
  // Owning ScriptLock proves that no conforming writer is still active. A leftover
  // "writing" marker therefore represents an execution that ended before finalizing.
  try{PropertiesService.getScriptProperties().setProperty(READ_CONSISTENCY_PROPERTY,'stable:'+Utilities.getUuid());}
  catch(_){CONSISTENCY_MARKER_WRITE_FAILURES++;}
}
function postResult_(req){
  try{
    if(req.action==='telegramWebhook')return {data:telegramWebhook_(req),error:null};
    if(req.action==='signup')return {data:signup_(req),error:null};
    if(req.action==='signin')return {data:signin_(req),error:null};
    if(req.action==='signout')return {data:signout_(req),error:null};
    if(req.action==='batch')return {data:batch_(req),error:null};
    const user=requireUser_(req.token);
    return {data:route_(req,user),error:null};
  }catch(err){return {data:null,error:{message:String(err&&err.message||err)}};}
}
function doPost(e) {
  const t0=Date.now();let req=null,lockMs=0,tLocked=t0,lockWaitStarted=t0,optimisticReadMs=0,readRetry=false,lockAcquired=false,lockAttempted=false,writeState=null;
  const lock=LockService.getScriptLock();
  try{
    ROWS_CACHE={};TZ_CACHE=null;SS_CACHE=null;READ_ONLY_REQUEST=false;SHEET_SCHEMA_VALIDATED={};
    PBKDF2_MS=0;SHEET_READS=0;SHEET_WRITES=0;SHEET_READ_MS=0;SHEET_WRITE_MS=0;REVISION_WRITE_FAILURES=0;CONSISTENCY_MARKER_WRITE_FAILURES=0;
    req=JSON.parse((e&&e.postData&&e.postData.contents)||'{}');
    READ_ONLY_REQUEST=requestLockMode_(req)==='read-candidate';
    if(!req.action)throw new Error('Не указано действие');
    if(READ_ONLY_REQUEST){
      // Optimistic read: no lock wait when no writer overlaps this request.
      const before=readConsistencyState_();
      if(isStableConsistencyState_(before)){
        const readStarted=Date.now();
        const result=postResult_(req);
        optimisticReadMs+=Date.now()-readStarted;
        const after=readConsistencyState_();
        if(after===before)return json_(result);
      }
      // A writer overlapped the read, or the marker could not be trusted. Discard
      // the entire result and retry once while holding the same lock as writers.
      readRetry=true;
      lockAttempted=true;lockWaitStarted=Date.now();lock.waitLock(20000);lockAcquired=true;
      tLocked=Date.now();lockMs=tLocked-lockWaitStarted;
      // Never reuse rows cached by the discarded optimistic attempt.
      ROWS_CACHE={};TZ_CACHE=null;SHEET_SCHEMA_VALIDATED={};
      try{recoverConsistencyUnderLock_();return json_(postResult_(req));}
      finally{lock.releaseLock();}
    }
    lockAttempted=true;lockWaitStarted=Date.now();lock.waitLock(20000);lockAcquired=true;
    tLocked=Date.now();lockMs=tLocked-lockWaitStarted;
    try{
      writeState=beginWriteConsistency_();
      return json_(postResult_(req));
    }finally{
      finishWriteConsistency_(writeState);
      lock.releaseLock();
    }
  }catch(err){
    if(lockAttempted&&!lockAcquired)lockMs=Date.now()-lockWaitStarted;
    try{if(lock.hasLock())lock.releaseLock();}catch(_){}
    return json_({data:null,error:{message:String(err&&err.message||err)}});
  }finally{
    READ_ONLY_REQUEST=false;
    const ended=Date.now();
    try{
      const action=req&&req.action;
      const loggedAction=typeof action==='string'&&['telegramWebhook','signup','signin','signout','batch','getSession','getUser','ensureProfile','createFamily','joinFamily','query','rpc'].includes(action)?action:'unknown';
      console.log(JSON.stringify({act:loggedAction,n:req&&req.requests?req.requests.length:undefined,lockMs,workMs:lockAcquired?ended-tLocked:optimisticReadMs,optimisticReadMs,pbkdf2Ms:PBKDF2_MS,readRetry,totalMs:ended-t0,reads:SHEET_READS,writes:SHEET_WRITES,readMs:SHEET_READ_MS,writeMs:SHEET_WRITE_MS,revisionWriteFailures:REVISION_WRITE_FAILURES,consistencyMarkerWriteFailures:CONSISTENCY_MARKER_WRITE_FAILURES}));
    }catch(_){}
  }
}
function batch_(req){
 const list=req.requests;if(!Array.isArray(list)||!list.length)throw new Error('Пустой пакет запросов');
 if(list.length>BATCH_MAX)throw new Error('Слишком много запросов в пакете');
 const user=requireUser_(req.token);
 return list.map(r=>{try{if(!r||!r.action||['signup','signin','signout','batch'].includes(r.action))throw new Error('Действие недоступно в пакете');return{data:route_(r,user),error:null}}catch(err){return{data:null,error:{message:String(err&&err.message||err)}}}});
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function ss_(){ if(SS_CACHE) return SS_CACHE; const s=SpreadsheetApp.getActiveSpreadsheet(); if(!s) throw new Error('Скрипт должен быть привязан к таблице бюджета'); return SS_CACHE=s; }
function sheet_(name) {
  if (!TABLES[name]) throw new Error('Неизвестная таблица: '+name);
  const ss=ss_(); let sh=ss.getSheetByName(name);
  if (!sh) {
    if (READ_ONLY_REQUEST) throw new Error('Лист '+name+' отсутствует; чтение остановлено без автоматического создания структуры');
    sh=ss.insertSheet(name); SHEET_WRITES++; timedSheetWrite_(()=>sh.getRange(1,1,1,TABLES[name].length).setValues([TABLES[name]])); sh.setFrozenRows(1); formatSheet_(sh,name);
  }
  // Validate once per execution for both reads and writes. A persistent cache can hide
  // manual schema changes for hours and allow writes against shifted columns.
  if (SHEET_SCHEMA_VALIDATED[name]) return sh;
  SHEET_READS++;
  const header=timedSheetRead_(()=>sh.getRange(1,1,1,TABLES[name].length).getValues())[0];
  let used=header.length;
  while(used>0&&(header[used-1]===''||header[used-1]===null))used--;
  const current=header.slice(0,used), expected=TABLES[name];
  if(current.join('|')!==expected.join('|')){
    if (READ_ONLY_REQUEST) throw new Error('Структура листа '+name+' требует обслуживания; чтение остановлено без автоматического изменения заголовков');
    // Only append missing trailing columns when every existing column is an exact prefix.
    // Never reorder, clear or overwrite existing data.
    const safePrefix=current.length<expected.length&&current.every((value,index)=>value===expected[index]);
    if(!safePrefix)throw new Error('Не совпадает структура листа '+name+'; автоматическое изменение небезопасно');
    const missing=expected.slice(current.length);
    timedSheetWrite_(()=>sh.getRange(1,current.length+1,1,missing.length).setValues([missing]));
    SHEET_WRITES++;
  }
  SHEET_SCHEMA_VALIDATED[name] = true;
  return sh;
}
function rows_(name) {
  if(ROWS_CACHE[name]) return ROWS_CACHE[name];
  return ROWS_CACHE[name]=readRows_(name);
}
function readRows_(name) {
  SHEET_READS++;
  const sh=sheet_(name), last=sh.getLastRow();
  if(last<2)return [];
  // Read only the schema-defined body: skip the header and ignore unrelated
  // trailing columns that may exist in a manually edited spreadsheet.
  const values=timedSheetRead_(()=>sh.getRange(2,1,last-1,TABLES[name].length).getValues());
  return values.map((r,i)=>({values:r,row:i+2})).filter(x=>x.values.some(v=>v!==''&&v!==null)).map(({values:r,row})=>{
    const o={}; TABLES[name].forEach((k,j)=>o[k]=normal_(r[j],k));if((name==='categories'||name==='accounts')&&(o.archived===''||o.archived===null))o.archived=false;o.__row=row;return o;
  });
}
function tz_(){ if(!TZ_CACHE) TZ_CACHE=ss_().getSpreadsheetTimeZone()||'Europe/Moscow'; return TZ_CACHE; }
// Если Google Sheets всё же превратил текст в Date, восстанавливаем осмысленное значение по имени столбца.
const KOPECK_COLUMNS_ = new Set([
  'amount_kopecks','starting_balance_kopecks','limit_kopecks',
  'target_kopecks','saved_kopecks','estimated_kopecks','planned_kopecks'
]);
function normal_(v,col) {
  if(v instanceof Date){
    if(col==='operation_time') return Utilities.formatDate(v,tz_(),'HH:mm');
    if(/_at$/.test(col||'')) return v.toISOString();
    return Utilities.formatDate(v,tz_(),'yyyy-MM-dd');
  }
  // Google Sheets normally returns numeric cells as numbers, but legacy/imported
  // integer kopecks may be stored as text. Normalize only exact safe integers.
  if(KOPECK_COLUMNS_.has(col)&&typeof v==='string'&&/^-?\d+$/.test(v.trim())){
    const numeric=Number(v.trim());
    if(Number.isSafeInteger(numeric))return numeric;
  }
  return v;
}
function safeCell_(value) {
  // setValues treats strings beginning with '=' as formulas even when the cell is formatted as text.
  // A leading apostrophe makes Sheets store the content as literal text.
  return typeof value==='string' && value.startsWith('=') ? "'"+value : value;
}
function tableRevisionKey_(table,familyId,userId){
  const base='table_revision:v2:'+table+':'+encodeURIComponent(String(familyId));
  return table==='notifications'?base+':'+encodeURIComponent(String(userId)):base;
}
function touchTableRevision_(name,data){
  try{
    const rows=Array.isArray(data)?data:[];
    const props=PropertiesService.getScriptProperties();
    const keys=new Set();
    rows.forEach(row=>{
      if(!row)return;
      let familyId='';
      if(name==='families')familyId=String(row.id||'');
      else if(name==='goal_contributions'){
        const goal=rows_('goals').find(g=>String(g.id)===String(row.goal_id));
        familyId=goal?String(goal.family_id||''):'';
      }else familyId=String(row.family_id||'');
      if(!familyId)return;
      if(name==='notifications'){
        const userId=String(row.user_id||'');
        if(userId)keys.add(tableRevisionKey_(name,familyId,userId));
      }else keys.add(tableRevisionKey_(name,familyId));
    });
    if(!keys.size)return;
    const revision=String(Date.now())+':'+Utilities.getUuid();
    // A committed data write must not be reported as failed only because its
    // revision marker could not be stored. Continue other keys and expose a
    // count in the request's aggregate diagnostic log instead of failing silently.
    keys.forEach(key=>{
      let stored=false;
      // PropertiesService failures can be transient. Retry once without changing
      // the already-committed data-write result or introducing mutation replay.
      for(let attempt=0;attempt<2&&!stored;attempt++){
        try{props.setProperty(key,revision);stored=true;}
        catch(_){}
      }
      if(!stored)REVISION_WRITE_FAILURES++;
    });
  }catch(_){REVISION_WRITE_FAILURES++;}
}
function appendRows_(name, data) {
  if (!data.length) return;
  const sh=sheet_(name), cols=TABLES[name], start=sh.getLastRow()+1;
  const need=start+data.length-1;
  if(sh.getMaxRows()<need){sh.insertRowsAfter(sh.getMaxRows(),need-sh.getMaxRows()+500);formatSheet_(sh,name);}
  delete ROWS_CACHE[name];
  timedSheetWrite_(()=>sh.getRange(start,1,data.length,cols.length).setValues(data.map(o=>cols.map(k=>safeCell_(o[k]===undefined||o[k]===null?'':o[k])))));
  SHEET_WRITES++;
  touchTableRevision_(name,data);
}
function updateRows_(name, data) {
  if (!data.length) return;
  const sh=sheet_(name), cols=TABLES[name];
  const byRow=new Map(data.filter(r=>Number.isInteger(r.__row)).map(r=>[r.__row,r]));
  const sorted=[...byRow.values()].sort((a,b)=>a.__row-b.__row);
  if(!sorted.length)return;
  delete ROWS_CACHE[name];
  let group=[],wrote=false;
  const flush=()=>{
    if(!group.length)return;
    timedSheetWrite_(()=>sh.getRange(group[0].__row,1,group.length,cols.length).setValues(group.map(o=>cols.map(k=>safeCell_(o[k]===undefined||o[k]===null?'':o[k])))));
    wrote=true;
    group=[];
  };
  try{
    sorted.forEach(row=>{if(group.length&&row.__row!==group[group.length-1].__row+1)flush();group.push(row);});
    flush();
  }finally{
    // A later non-contiguous write can fail after earlier groups have committed.
    // Publish a revision for any successful partial write so clients reload the actual state.
    if(wrote){SHEET_WRITES++;touchTableRevision_(name,data);}
  }
}
function deleteRows_(name, data) {
  const rowNumbers=[...new Set(data.map(r=>Number(r.__row)).filter(n=>Number.isInteger(n)&&n>=2))].sort((a,b)=>b-a);
  if(!rowNumbers.length)return;
  const sh=sheet_(name);
  delete ROWS_CACHE[name];
  let i=0,wrote=false;
  try{
    while(i<rowNumbers.length){
      const high=rowNumbers[i];let low=high;i++;
      while(i<rowNumbers.length&&rowNumbers[i]===low-1){low=rowNumbers[i];i++;}
      timedSheetWrite_(()=>sh.deleteRows(low,high-low+1));
      wrote=true;
    }
  }finally{
    if(wrote){SHEET_WRITES++;touchTableRevision_(name,data);}
  }
}
function writeRows_(name, data) {
  SHEET_WRITES++;
  const sh=sheet_(name), cols=TABLES[name];
  delete ROWS_CACHE[name];
  // Лист по умолчанию содержит 1000 строк; без расширения запись большего числа строк падает.
  const need=data.length+1; if(sh.getMaxRows()<need){ sh.insertRowsAfter(sh.getMaxRows(), need-sh.getMaxRows()+500); formatSheet_(sh,name); }
  let wrote=false;
  try{
    if(data.length){timedSheetWrite_(()=>sh.getRange(2,1,data.length,cols.length).setValues(data.map(o=>cols.map(k=>safeCell_(o[k]===undefined||o[k]===null?'':o[k])))));wrote=true;}
    const last=sh.getLastRow();
    if(last>data.length+1){timedSheetWrite_(()=>sh.getRange(data.length+2,1,last-data.length-1,cols.length).clearContent());wrote=true;}
  }finally{
    if(wrote)touchTableRevision_(name,data);
  }
}
function now_(){return new Date().toISOString();}
function id_(){return Utilities.getUuid();}
function code_(){return Utilities.getUuid().replace(/-/g,'').slice(0,12).toUpperCase();}
function authSheet_(){
  const expected=['id','email','salt','password_hash','display_name','created_at'];
  const ss=ss_(); let sh=ss.getSheetByName(AUTH_SHEET);
  if(!sh){
    if(READ_ONLY_REQUEST)throw new Error('Служебный лист _auth отсутствует; чтение остановлено без автоматического создания структуры');
    sh=ss.insertSheet(AUTH_SHEET);SHEET_WRITES++;timedSheetWrite_(()=>sh.getRange(1,1,1,expected.length).setValues([expected]));sh.hideSheet();formatAuth_(sh);return sh;
  }
  // _auth is positional and contains credential material: never guess, reorder or auto-repair its schema.
  const header=timedSheetRead_(()=>sh.getRange(1,1,1,expected.length).getValues())[0];
  if(header.join('|')!==expected.join('|'))throw new Error('Не совпадает структура служебного листа _auth; автоматическое изменение небезопасно');
  return sh;
}
function authRows_(){SHEET_READS++;const sh=authSheet_(),v=timedSheetRead_(()=>sh.getDataRange().getValues());return v.slice(1).map((r,i)=>({r,row:i+2})).filter(x=>x.r[0]).map(({r,row})=>({id:String(r[0]),email:String(r[1]).toLowerCase(),salt:String(r[2]),hash:String(r[3]),name:String(r[4]),created_at:String(r[5]),row}));}
function hash_(password,salt){let digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,salt+':'+password,Utilities.Charset.UTF_8);for(let i=0;i<10000;i++)digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,digest);return Utilities.base64Encode(digest);}
/* ===== Проверка пароля: PBKDF2-HMAC-SHA256 на чистом JavaScript =====
   Прежний цикл из 10 000 вызовов Utilities.computeDigest занимал ~5 секунд (каждый вызов — обращение к сервису Google).
   Здесь SHA-256 считается прямо в скрипте, поэтому 30 000 шагов выполняются быстро. Число шагов хранится в самом хеше. */
const PW_ITERATIONS = 30000;
const SHA256_K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
const SHA256_H0 = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
function utf8Bytes_(str){
  const out=[];
  for(let i=0;i<str.length;i++){
    let c=str.charCodeAt(i);
    if(c>=0xD800&&c<=0xDBFF&&i+1<str.length){const d=str.charCodeAt(i+1);if(d>=0xDC00&&d<=0xDFFF){c=0x10000+((c-0xD800)<<10)+(d-0xDC00);i++;}}
    if(c<0x80)out.push(c);
    else if(c<0x800)out.push(0xC0|(c>>6),0x80|(c&63));
    else if(c<0x10000)out.push(0xE0|(c>>12),0x80|((c>>6)&63),0x80|(c&63));
    else out.push(0xF0|(c>>18),0x80|((c>>12)&63),0x80|((c>>6)&63),0x80|(c&63));
  }
  return out;
}
// Один блок SHA-256: st — состояние (8 слов), m — 16 слов сообщения, w — рабочий массив из 64 слов.
function sha256Compress_(st,m,w){
  for(let i=0;i<16;i++)w[i]=m[i];
  for(let i=16;i<64;i++){
    const a=w[i-15],b=w[i-2];
    const s0=((a>>>7)|(a<<25))^((a>>>18)|(a<<14))^(a>>>3);
    const s1=((b>>>17)|(b<<15))^((b>>>19)|(b<<13))^(b>>>10);
    w[i]=(w[i-16]+s0+w[i-7]+s1)|0;
  }
  let a=st[0],b=st[1],c=st[2],d=st[3],e=st[4],f=st[5],g=st[6],h=st[7];
  for(let i=0;i<64;i++){
    const S1=((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7));
    const t1=(h+S1+((e&f)^(~e&g))+SHA256_K[i]+w[i])|0;
    const S0=((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10));
    const t2=(S0+((a&b)^(a&c)^(b&c)))|0;
    h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
  }
  st[0]=(st[0]+a)|0;st[1]=(st[1]+b)|0;st[2]=(st[2]+c)|0;st[3]=(st[3]+d)|0;
  st[4]=(st[4]+e)|0;st[5]=(st[5]+f)|0;st[6]=(st[6]+g)|0;st[7]=(st[7]+h)|0;
}
function sha256Bytes_(bytes){
  const st=new Uint32Array(SHA256_H0), w=new Uint32Array(64), m=new Uint32Array(16);
  const len=bytes.length, total=((len+9+63)>>6)<<6, buf=new Uint8Array(total);
  buf.set(bytes); buf[len]=0x80;
  const bits=len*8;
  buf[total-4]=(bits>>>24)&255;buf[total-3]=(bits>>>16)&255;buf[total-2]=(bits>>>8)&255;buf[total-1]=bits&255;
  for(let off=0;off<total;off+=64){
    for(let i=0;i<16;i++)m[i]=(buf[off+4*i]<<24)|(buf[off+4*i+1]<<16)|(buf[off+4*i+2]<<8)|buf[off+4*i+3];
    sha256Compress_(st,m,w);
  }
  const out=new Uint8Array(32);
  for(let i=0;i<8;i++){out[4*i]=st[i]>>>24;out[4*i+1]=(st[i]>>>16)&255;out[4*i+2]=(st[i]>>>8)&255;out[4*i+3]=st[i]&255;}
  return out;
}
function pbkdf2Hex_(password,salt,iterations){
  let key=utf8Bytes_(String(password));
  if(key.length>64)key=Array.from(sha256Bytes_(key));
  const ipad=new Uint8Array(64), opad=new Uint8Array(64);
  for(let i=0;i<64;i++){const k=i<key.length?key[i]:0;ipad[i]=k^0x36;opad[i]=k^0x5c;}
  const w=new Uint32Array(64), m=new Uint32Array(16);
  const blockWords=(blk)=>{const r=new Uint32Array(16);for(let i=0;i<16;i++)r[i]=(blk[4*i]<<24)|(blk[4*i+1]<<16)|(blk[4*i+2]<<8)|blk[4*i+3];return r;};
  const innerState=new Uint32Array(SHA256_H0), outerState=new Uint32Array(SHA256_H0);
  sha256Compress_(innerState,blockWords(ipad),w);
  sha256Compress_(outerState,blockWords(opad),w);
  // U1 = HMAC(пароль, соль || 00000001)
  const msg=utf8Bytes_(String(salt)).concat([0,0,0,1]);
  const inner1=sha256Bytes_(Array.from(ipad).concat(msg));
  let u=sha256Bytes_(Array.from(opad).concat(Array.from(inner1)));
  const U=new Uint32Array(8), T=new Uint32Array(8);
  for(let i=0;i<8;i++){U[i]=(u[4*i]<<24)|(u[4*i+1]<<16)|(u[4*i+2]<<8)|u[4*i+3];T[i]=U[i];}
  const st=new Uint32Array(8);
  for(let n=2;n<=iterations;n++){
    for(let i=0;i<8;i++){m[i]=U[i];}
    m[8]=0x80000000;for(let i=9;i<15;i++)m[i]=0;m[15]=768; // (64+32) байт * 8 бит
    for(let i=0;i<8;i++)st[i]=innerState[i];
    sha256Compress_(st,m,w);
    for(let i=0;i<8;i++)m[i]=st[i];
    for(let i=0;i<8;i++)st[i]=outerState[i];
    sha256Compress_(st,m,w);
    for(let i=0;i<8;i++){U[i]=st[i];T[i]^=st[i];}
  }
  let hex='';
  for(let i=0;i<8;i++)hex+=('00000000'+(T[i]>>>0).toString(16)).slice(-8);
  return hex;
}
function safeEqual_(a,b){
  a=String(a);b=String(b);
  if(a.length!==b.length)return false;
  let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);
  return d===0;
}
function pbkdf2TimedHex_(password,salt,iterations){const started=Date.now();try{return pbkdf2Hex_(password,salt,iterations);}finally{PBKDF2_MS+=Date.now()-started;}}
function makePasswordHash_(password,salt){return 'p2$'+PW_ITERATIONS+'$'+pbkdf2TimedHex_(password,salt,PW_ITERATIONS);}
function isLegacyHash_(stored){return String(stored).indexOf('p2$')!==0;}
function passwordMatches_(password,salt,stored){
  stored=String(stored);
  if(!isLegacyHash_(stored)){
    const parts=stored.split('$');
    // Stored parameters are untrusted sheet data: reject partial numbers and malformed digests
    // before doing expensive PBKDF2 work.
    if(parts.length!==3||!/^[1-9][0-9]*$/.test(parts[1])||!/^[0-9a-f]{64}$/.test(parts[2]))return false;
    const it=Number(parts[1]);
    if(!Number.isSafeInteger(it)||it<1||it>1000000)return false;
    return safeEqual_(pbkdf2TimedHex_(password,salt,it),parts[2]);
  }
  return safeEqual_(hash_(password,salt),stored); // старые аккаунты: медленный прежний способ, при успешном входе хеш обновляется
}
function benchmarkPasswordHash(){
  // Editor-only diagnostic: fixed dummy input; never reads or writes user credentials.
  const password='local-only-pbkdf2-benchmark', salt='non-secret-fixed-benchmark-salt';
  const candidates=Array.from(new Set([PW_ITERATIONS,600000]));
  const results=candidates.map(iterations=>{
    const started=Date.now();
    const digest=pbkdf2Hex_(password,salt,iterations);
    return {iterations,elapsedMs:Date.now()-started,outputLength:digest.length};
  });
  console.log('PBKDF2 benchmark (dummy data only): '+JSON.stringify(results));
  return results;
}
function pruneSessions_(){
  const props=PropertiesService.getScriptProperties(), all=props.getProperties(), now=Date.now();
  Object.keys(all).forEach(key=>{
    if(!key.startsWith('session:')&&!key.startsWith('loginfail:'))return;
    try{const item=JSON.parse(all[key]);if(!item.expires||item.expires<=now)props.deleteProperty(key);}
    catch(_){props.deleteProperty(key);}
  });
}
function loginAttemptKey_(email){
  const digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(email).toLowerCase(),Utilities.Charset.UTF_8);
  return 'loginfail:'+Utilities.base64Encode(digest).replace(/[+/=]/g,'');
}
function signup_(req){
  if(PropertiesService.getScriptProperties().getProperty('SIGNUP_DISABLED')==='1')throw new Error('Регистрация закрыта');
  pruneSessions_();
  const email=String(req.email||'').trim().toLowerCase(), password=String(req.password||''), name=String(req.name||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Введите корректный email');
  if(password.length<15) throw new Error('Пароль должен содержать минимум 15 символов');
  if(authRows_().some(u=>u.email===email)) throw new Error('Аккаунт с таким email уже существует');
  const id=id_(), salt=Utilities.getUuid();
  SHEET_WRITES++; timedSheetWrite_(()=>authSheet_().appendRow([id,email,salt,makePasswordHash_(password,salt),name||email.split('@')[0],now_()].map(safeCell_)));
  const token=id_()+id_();
  PropertiesService.getScriptProperties().setProperty('session:'+token,JSON.stringify({userId:id,expires:Date.now()+SESSION_TTL*1000}));
  try{ensureProfile_(id,name||email.split('@')[0]);}
  catch(err){
    const cleanup=[];
    try{const row=authRows_().find(u=>u.id===id);if(row){SHEET_WRITES++;timedSheetWrite_(()=>authSheet_().deleteRow(row.row));}}catch(cleanupErr){cleanup.push('аккаунт: '+(cleanupErr&&cleanupErr.message?cleanupErr.message:String(cleanupErr)));}
    try{PropertiesService.getScriptProperties().deleteProperty('session:'+token);}catch(cleanupErr){cleanup.push('сессия: '+(cleanupErr&&cleanupErr.message?cleanupErr.message:String(cleanupErr)));}
    if(cleanup.length)throw new Error('Не удалось полностью отменить регистрацию: '+cleanup.join('; ')+'. Исходная ошибка: '+(err&&err.message?err.message:String(err)));
    throw err;
  }
  return {token,user:{id,email}};
}
function signin_(req){
  pruneSessions_();
  const email=String(req.email||'').trim().toLowerCase(), password=String(req.password||''), props=PropertiesService.getScriptProperties(), now=Date.now();
  const attemptKey=loginAttemptKey_(email), saved=props.getProperty(attemptKey);
  let attempt=saved?JSON.parse(saved):null;
  if(attempt&&attempt.expires>now&&attempt.blockedUntil>now)throw new Error('Слишком много попыток входа. Попробуйте через 15 минут');
  if(!attempt||attempt.expires<=now)attempt={count:0,expires:now+LOGIN_WINDOW_MS,blockedUntil:0};
  const u=authRows_().find(x=>x.email===email);
  // Для несуществующего email тоже считаем хеш: время ответа не выдаёт, зарегистрирован ли адрес.
  const passwordOk=u?passwordMatches_(password,u.salt,u.hash):(pbkdf2TimedHex_(password,'no-such-user',PW_ITERATIONS),false);
  if(!passwordOk){
    attempt.count++;
    if(attempt.count>=LOGIN_MAX_ATTEMPTS){attempt.blockedUntil=now+LOGIN_WINDOW_MS;attempt.expires=attempt.blockedUntil;}
    props.setProperty(attemptKey,JSON.stringify(attempt));
    throw new Error('Неверный email или пароль');
  }
  props.deleteProperty(attemptKey);
  // Старый аккаунт: после успешного входа заменяем медленный прежний хеш на новый (следующие входы будут быстрыми).
  if(isLegacyHash_(u.hash)){try{SHEET_WRITES++;timedSheetWrite_(()=>authSheet_().getRange(u.row,4).setValue(makePasswordHash_(password,u.salt)));}catch(_){}}
  const token=id_()+id_();
  props.setProperty('session:'+token,JSON.stringify({userId:u.id,expires:now+SESSION_TTL*1000}));
  return {token,user:{id:u.id,email:u.email}};
}
function signout_(req){if(req.token)PropertiesService.getScriptProperties().deleteProperty('session:'+req.token);return true;}
function requireUser_(token){
  if(!token) throw new Error('Требуется вход');
  const p=PropertiesService.getScriptProperties(), raw=p.getProperty('session:'+token);
  if(!raw) throw new Error('Сессия завершена, войдите снова');
  let s;
  // Authentication checks are read-only: expired/corrupt records are pruned by signup/signin
  // maintenance, not as a side effect of ordinary read requests.
  try { s=JSON.parse(raw); }
  catch (_) { throw new Error('Сессия завершена, войдите снова'); }
  if(!s||typeof s!=='object'||Array.isArray(s)||typeof s.userId!=='string'||!s.userId||typeof s.expires!=='number'||!Number.isFinite(s.expires)||s.expires<=Date.now()){
    throw new Error('Сессия завершена, войдите снова');
  }
  const u=authRows_().find(x=>x.id===s.userId); if(!u)throw new Error('Пользователь не найден');
  return {id:u.id,email:u.email,name:u.name};
}
function setProfileName_(userId,name){
 const n=String(name||'').trim();if(!n)return;const list=rows_('profiles'),p=list.find(x=>x.id===userId);
 if(p){if(p.display_name===n)return;p.display_name=n;updateRows_('profiles',[p]);}else appendRows_('profiles',[{id:userId,display_name:n,avatar_color:'#2563eb',timezone:'Europe/Moscow',created_at:now_()}]);
}
function ensureProfile_(userId,name){
  const list=rows_('profiles'); if(list.some(p=>p.id===userId))return;
  appendRows_('profiles',[{id:userId,display_name:name,avatar_color:'#2563eb',timezone:'Europe/Moscow',created_at:now_()}]);
}
function route_(req,user){
  if(req.action==='getSession')return {user:{id:user.id,email:user.email}};
  if(req.action==='getUser')return {user:{id:user.id,email:user.email}};
  if(req.action==='ensureProfile'){ensureProfile_(user.id,String(req.display_name||user.name));return true;}
  if(req.action==='createFamily'){
    const name=String(req.name||'Наша семья').trim(); if(!name)throw new Error('Введите название семьи');
    if(rows_('family_members').some(m=>m.user_id===user.id))throw new Error('Пользователь уже состоит в семье');
    const f={id:id_(),name,invite_code:code_(),currency:'RUB',created_at:now_(),created_by:user.id};
    // Таблицы не поддерживают транзакции: при сбое на любом шаге откатываем уже записанное вручную.
    try{
      appendRows_('families',[f]);
      appendRows_('family_members',[{id:id_(),family_id:f.id,user_id:user.id,role:'owner',joined_at:now_()}]);
      seedCategories_(f.id);
      // Update the profile only after all family writes succeed; failed creation must leave it untouched.
      setProfileName_(user.id,req.display_name);
    }catch(err){rollbackFamily_(f.id);throw err;}
    return f;
  }
  if(req.action==='joinFamily'){
    const code=String(req.invite_code||'').trim().toUpperCase(), f=rows_('families').find(x=>String(x.invite_code).toUpperCase()===code);
    if(!f)throw new Error('Код приглашения не найден');
    const members=rows_('family_members').filter(m=>m.family_id===f.id);
    if(members.some(m=>m.user_id===user.id)){setProfileName_(user.id,req.display_name);return f;}
    if(rows_('family_members').some(m=>m.user_id===user.id))throw new Error('Вы уже состоите в другой семье');
    if(members.length>=2)throw new Error('В семье уже два участника');
    // Persist membership before changing the profile. If the membership write fails, profile data stays untouched.
    // If the profile update fails afterward, retry is safe: the existing-member path completes the profile update.
    const member={id:id_(),family_id:f.id,user_id:user.id,role:'member',joined_at:now_()};appendRows_('family_members',[member]);
    setProfileName_(user.id,req.display_name);
    return f;
  }
  if(req.action==='query')return query_(req,user);
  if(req.action==='rpc')return rpc_(req,user);
  throw new Error('Неизвестное действие: '+req.action);
}
// Per-request authorization snapshot: avoid repeated Sheets reads inside row filters.
const ACCESS_SNAPSHOT_=new WeakMap();
function accessSnapshot_(user){
  let snapshot=ACCESS_SNAPSHOT_.get(user);
  if(!snapshot){
    const allMembers=rows_('family_members');
    const members=allMembers.filter(m=>String(m.user_id)===String(user.id));
    const familyIds=members.map(m=>String(m.family_id));
    const allowedFamilies=new Set(familyIds);
    snapshot={familyIds,membersByFamily:new Map(),goalsById:null};
    allMembers.forEach(m=>{
      const familyId=String(m.family_id);
      if(!allowedFamilies.has(familyId))return;
      if(!snapshot.membersByFamily.has(familyId))snapshot.membersByFamily.set(familyId,new Set());
      snapshot.membersByFamily.get(familyId).add(String(m.user_id));
    });
    ACCESS_SNAPSHOT_.set(user,snapshot);
  }
  return snapshot;
}
function allowedFamilyIds_(user){return accessSnapshot_(user).familyIds;}
function canAccessRow_(table,row,user){
  const snapshot=accessSnapshot_(user),fams=snapshot.familyIds;
  if(table==='notifications'){
    if(!row.family_id || !fams.includes(String(row.family_id)))return false;
    return String(row.user_id||'')===user.id;
  }
  if(table==='telegram_links'||table==='telegram_link_codes')return String(row.user_id||'')===user.id&&fams.includes(String(row.family_id));
  if(row.family_id!==undefined && row.family_id!=='') return fams.includes(String(row.family_id));
  if(table==='profiles') return String(row.id)===String(user.id) || fams.some(fid=>(snapshot.membersByFamily.get(fid)||new Set()).has(String(row.id)));
  if(table==='families') return String(row.created_by)===user.id || fams.includes(String(row.id));
  if(table==='family_members') return fams.includes(String(row.family_id));
  if(table==='goal_contributions'){if(!snapshot.goalsById)snapshot.goalsById=new Map(rows_('goals').map(g=>[String(g.id),g]));const g=snapshot.goalsById.get(String(row.goal_id));return !!g&&fams.includes(String(g.family_id));}
  return false;
}
function assertUniqueBudget_(rows,row,excludeId){
  if(String(row.family_id||'')===''||String(row.category_id||'')===''||String(row.month_date||'')==='')return;
  const duplicate=rows.some(x=>String(x.id)!==String(excludeId||'')&&
    String(x.family_id)===String(row.family_id)&&
    String(x.category_id)===String(row.category_id)&&
    String(x.month_date)===String(row.month_date));
  if(duplicate)throw new Error('Для этой категории уже задан бюджет на выбранный месяц');
}
function assertKopecks_(value,label,options){
  const opts=options||{};
  if(opts.optional&&value===undefined)return;
  if(opts.positive){
    if(typeof value!=='number'||!Number.isSafeInteger(value)||value<=0)throw new Error('Значение «'+label+'» должно быть положительным целым числом копеек');
    return;
  }
  if(typeof value!=='number'||!Number.isSafeInteger(value))throw new Error('Значение «'+label+'» должно быть безопасным целым числом копеек');
}
function validateRelations_(table,row,user,previous){
  const familyId=String(row.family_id||'');
  // Validate stored money values without coercion: numeric strings and booleans are not kopecks.
  if(table==='accounts')assertKopecks_(row.starting_balance_kopecks,'Начальный остаток',{optional:true});
  if(table==='transactions')assertKopecks_(row.amount_kopecks,'Сумма операции',{positive:true});
  if(table==='recurring_payments')assertKopecks_(row.amount_kopecks,'Сумма регулярного платежа',{positive:true});
  if(table==='budgets')assertKopecks_(row.limit_kopecks,'Лимит бюджета',{positive:true});
  if(table==='goals')assertKopecks_(row.target_kopecks,'Сумма цели',{positive:true});
  if(table==='goal_contributions')assertKopecks_(row.amount_kopecks,'Сумма пополнения',{positive:true});
  if(table==='planned_purchases'){
    assertKopecks_(row.estimated_kopecks,'Стоимость покупки',{positive:true});
    const purchaseUrl=String(row.url||'').trim();
    if(purchaseUrl&&(purchaseUrl.length>2048||/[\u0000-\u0020\u007f\\]/.test(purchaseUrl)||!/^https?:\/\/[^/?#\\\s]+(?:[/?#][^\s\\]*)?$/i.test(purchaseUrl)))throw new Error('Ссылка на товар должна быть абсолютным HTTP(S) URL не длиннее 2048 символов');
  }
  if(table==='monthly_plans')assertKopecks_(row.planned_kopecks,'Плановая сумма',{positive:true});
  if(table==='goal_contributions'){
    const goal=rows_('goals').find(x=>String(x.id)===String(row.goal_id));
    if(!goal)throw new Error('Связанная цель не найдена');
    if(!allowedFamilyIds_(user).includes(String(goal.family_id)))throw new Error('Нет доступа к этой цели');
    return;
  }
  if(table==='accounts'){
    const name=String(row.name||'').trim();
    if(!name)throw new Error('Введите название счёта');
    if(!['cash','bank','savings','other'].includes(String(row.kind||'')))throw new Error('Неизвестный тип счёта');
  }
  if(table==='transactions'){
    if(!['income','expense','transfer'].includes(String(row.type||'')))throw new Error('Неизвестный тип операции');
    if(row.type==='transfer'&&(!row.account_id||!row.to_account_id))throw new Error('Для перевода нужны счёт списания и счёт зачисления');
    if(row.type!=='transfer'&&row.to_account_id)throw new Error('Счёт зачисления допустим только для перевода');
  }
  if(table==='recurring_payments'){
    if(row.type==='transfer')throw new Error('Регулярные переводы пока не поддерживаются');
    if(!['income','expense'].includes(String(row.type||'')))throw new Error('Неизвестный тип регулярного платежа');
  }
  if(!familyId)return;
  if(['transactions','goals','planned_purchases','recurring_payments'].includes(table)&&row.responsible_user_id){
    const member=rows_('family_members').some(m=>String(m.family_id)===familyId&&String(m.user_id)===String(row.responsible_user_id));
    if(!member)throw new Error('Ответственный участник не состоит в этой семье');
  }
  const check=(field,relatedTable,label)=>{
    const value=row[field];if(value===undefined||value===null||value==='')return;
    const related=rows_(relatedTable).find(x=>String(x.id)===String(value));
    if(!related||String(related.family_id)!==familyId)throw new Error(label+' не найдена в этой семье');
  };
  if(table==='categories'){
    if(!['expense','income','transfer'].includes(String(row.kind||'')))throw new Error('Неизвестный тип категории');
    check('parent_id','categories','Родительская категория');
    const hierarchyChanged=!previous||String(previous.parent_id||'')!==String(row.parent_id||'')||String(previous.kind)!==String(row.kind);
    const kindChanged=!!previous&&String(previous.kind)!==String(row.kind);
    if(kindChanged&&row.id){
      const categoryId=String(row.id);
      const referenced=rows_('transactions').some(x=>String(x.category_id||'')===categoryId)||
        rows_('recurring_payments').some(x=>String(x.category_id||'')===categoryId)||
        rows_('budgets').some(x=>String(x.category_id||'')===categoryId)||
        rows_('monthly_plans').some(x=>String(x.category_id||'')===categoryId)||
        rows_('planned_purchases').some(x=>String(x.category_id||'')===categoryId);
      if(referenced)throw new Error('Нельзя менять тип категории, пока она используется в операциях, бюджетах или планах. Создайте новую категорию либо перенесите связанные записи.');
    }
    if(hierarchyChanged&&row.parent_id){
      const parent=rows_('categories').find(x=>String(x.id)===String(row.parent_id));
      if(parent&&String(parent.kind)!==String(row.kind))throw new Error('Тип подкатегории должен совпадать с типом родительской категории');
    }else if(hierarchyChanged&&row.id){
      const mismatchedChild=rows_('categories').some(x=>String(x.parent_id)===String(row.id)&&String(x.kind)!==String(row.kind));
      if(mismatchedChild)throw new Error('Нельзя менять тип категории, пока у неё есть подкатегории другого типа');
    }
  }
  if(table==='transactions'){
    check('category_id','categories','Категория');check('account_id','accounts','Счёт списания');check('to_account_id','accounts','Счёт зачисления');check('parent_recurring_id','recurring_payments','Регулярный платёж');
    const accountChanged=!previous||String(previous.account_id||'')!==String(row.account_id||'');
    if(accountChanged&&row.account_id){
      const account=rows_('accounts').find(x=>String(x.id)===String(row.account_id));
      if(account&&account.archived)throw new Error('Нельзя назначить архивный счёт новой операции');
    }
    const destinationChanged=!previous||String(previous.to_account_id||'')!==String(row.to_account_id||'');
    if(destinationChanged&&row.to_account_id){
      const account=rows_('accounts').find(x=>String(x.id)===String(row.to_account_id));
      if(account&&account.archived)throw new Error('Нельзя назначить архивный счёт зачисления новому переводу');
    }
    const categoryChanged=!previous||String(previous.category_id||'')!==String(row.category_id||'')||String(previous.type)!==String(row.type);
    if(categoryChanged&&row.category_id){
      const category=rows_('categories').find(x=>String(x.id)===String(row.category_id));
      if(category&&category.archived)throw new Error('Нельзя назначить архивную категорию новой операции');
      if(category&&String(category.kind)!==String(row.type))throw new Error('Тип категории не соответствует типу операции');
    }
    if(row.account_id&&row.to_account_id&&String(row.account_id)===String(row.to_account_id))throw new Error('Счета перевода должны различаться');
  }
  if(table==='recurring_payments'){
    check('category_id','categories','Категория');check('account_id','accounts','Счёт');
    const accountChanged=!previous||String(previous.account_id||'')!==String(row.account_id||'');
    if(accountChanged&&row.account_id){
      const account=rows_('accounts').find(x=>String(x.id)===String(row.account_id));
      if(account&&account.archived)throw new Error('Нельзя назначить архивный счёт новому регулярному платежу');
    }
    const categoryChanged=!previous||String(previous.category_id||'')!==String(row.category_id||'')||String(previous.type)!==String(row.type);
    if(categoryChanged&&row.category_id){
      const category=rows_('categories').find(x=>String(x.id)===String(row.category_id));
      if(category&&category.archived)throw new Error('Нельзя назначить архивную категорию новому регулярному платежу');
      if(category&&String(category.kind)!==String(row.type))throw new Error('Тип категории не соответствует типу регулярного платежа');
    }
  }
  if(table==='budgets'){
    check('category_id','categories','Категория');
    const categoryChanged=!previous||String(previous.category_id||'')!==String(row.category_id||'');
    if(categoryChanged&&row.category_id){
      const category=rows_('categories').find(x=>String(x.id)===String(row.category_id));
      if(category&&category.archived)throw new Error('Нельзя назначить архивную категорию новому бюджету');
      if(category&&category.kind!=='expense')throw new Error('Бюджет можно назначить только категории расходов');
    }
  }
  if(table==='monthly_plans'){
    check('category_id','categories','Категория');
    if(!['income','expense','savings'].includes(String(row.type||'')))throw new Error('Неизвестный тип плановой строки');
    const categoryChanged=!previous||String(previous.category_id||'')!==String(row.category_id||'')||String(previous.type)!==String(row.type);
    if(categoryChanged&&row.category_id){
      const category=rows_('categories').find(x=>String(x.id)===String(row.category_id));
      const expectedKind=row.type==='income'?'income':'expense';
      if(category&&category.archived)throw new Error('Нельзя назначить архивную категорию новой строке плана');
      if(category&&String(category.kind)!==expectedKind)throw new Error('Тип категории не соответствует типу месячного плана');
    }
  }
  if(table==='planned_purchases'){
    check('category_id','categories','Категория');check('goal_id','goals','Цель');check('linked_transaction_id','transactions','Связанная операция');
    const categoryChanged=!previous||String(previous.category_id||'')!==String(row.category_id||'');
    if(categoryChanged&&row.category_id){
      const category=rows_('categories').find(x=>String(x.id)===String(row.category_id));
      if(category&&category.archived)throw new Error('Нельзя назначить архивную категорию новой покупке');
      if(category&&category.kind!=='expense')throw new Error('Планируемую покупку можно отнести только к категории расходов');
    }
  }
}
function matchesFilterValue_(row,filter){
  const a=row[filter.column],b=filter.value;
  switch(filter.op){
    case 'eq':return String(a??'')===String(b??'');
    case 'neq':return String(a??'')!==String(b??'');
    case 'gte':return a>=b;
    case 'lte':return a<=b;
    case 'gt':return a>b;
    case 'lt':return a<b;
    case 'in':return (filter.values||[]).map(String).includes(String(a));
    case 'is':return b===null?(a===null||a===''):String(a)===String(b);
    default:throw new Error('Фильтр не поддерживается');
  }
}
// For large ledgers, avoid reading every transaction column when the request
// is for a single family's bounded date range. Small/wide queries keep the
// simple full-sheet path because one contiguous read is cheaper there.
function readTransactionRangeRows_(filters,user){
  if(!Array.isArray(filters)||!filters.some(f=>f.column==='operation_date'&&f.op==='gte')||
     !filters.some(f=>f.column==='operation_date'&&f.op==='lte'))return null;
  const familyFilters=filters.filter(f=>f.column==='family_id'&&f.op==='eq');
  if(familyFilters.length!==1)return null;
  const familyId=String(familyFilters[0].value??'');
  if(!familyId||!allowedFamilyIds_(user).includes(familyId))return [];
  const sh=sheet_('transactions'),lastRow=sh.getLastRow(),rowCount=lastRow-1;
  if(rowCount<200)return null;
  const columns=TABLES.transactions,familyIndex=columns.indexOf('family_id'),dateIndex=columns.indexOf('operation_date');
  if(familyIndex<0||dateIndex<=familyIndex)return null;
  SHEET_READS++;
  const indexValues=timedSheetRead_(()=>sh.getRange(2,familyIndex+1,rowCount,dateIndex-familyIndex+1).getValues());
  const candidates=[];
  const first=filters.find(f=>f.column==='operation_date'&&f.op==='gte');
  const last=filters.find(f=>f.column==='operation_date'&&f.op==='lte');
  for(let i=0;i<indexValues.length;i++){
    const partial={
      family_id:normal_(indexValues[i][0],'family_id'),
      operation_date:normal_(indexValues[i][dateIndex-familyIndex],'operation_date')
    };
    if(String(partial.family_id)!==familyId)continue;
    if(!matchesFilterValue_(partial,first)||!matchesFilterValue_(partial,last))continue;
    candidates.push(i+2);
  }
  if(!candidates.length)return [];
  if(candidates.length>=rowCount*0.6)return null;
  const groups=[];
  let start=candidates[0],previous=start,count=1;
  for(let i=1;i<candidates.length;i++){
    const row=candidates[i];
    if(row===previous+1){count++;}
    else{groups.push({start,count});start=row;count=1;}
    previous=row;
  }
  groups.push({start,count});
  if(groups.length>20)return null;
  const result=[];
  groups.forEach(group=>{
    SHEET_READS++;
    const block=timedSheetRead_(()=>sh.getRange(group.start,1,group.count,columns.length).getValues());
    block.forEach((values,index)=>{
      const row={};
      columns.forEach((column,columnIndex)=>row[column]=normal_(values[columnIndex],column));
      row.__row=group.start+index;
      result.push(row);
    });
  });
  return result;
}
const IDEMPOTENT_INSERT_FIELDS = {
  categories:['family_id','parent_id','name','kind','color','icon','archived','sort_order'],
  accounts:['family_id','name','kind','owner_user_id','starting_balance_kopecks','archived'],
  goal_contributions:['goal_id','amount_kopecks','contribution_date','note'],
  planned_purchases:['family_id','name','category_id','estimated_kopecks','priority','desired_month','desired_date','url','comment','status','responsible_user_id','goal_id','linked_transaction_id'],
  recurring_payments:['family_id','type','amount_kopecks','category_id','account_id','description','start_date','end_date','frequency','custom_interval_days','next_due_date','remind','active','responsible_user_id'],
  budgets:['family_id','category_id','month_date','limit_kopecks','warn_75','warn_90','warn_100']
};
function sameIdempotentInsert_(table,stored,candidate,user){
  const fields=IDEMPOTENT_INSERT_FIELDS[table];
  if(!fields)return false;
  if(TABLES[table].includes('created_by')&&String(stored.created_by||'')!==String(user.id))return false;
  if(table==='goal_contributions'){
    const goal=rows_('goals').find(row=>String(row.id)===String(stored.goal_id));
    if(!goal||!allowedFamilyIds_(user).includes(String(goal.family_id)))return false;
  }
  return fields.every(field=>String(stored[field]??'')===String(candidate[field]??''));
}
function sameTransactionInsert_(stored,candidate,user){
  if(String(stored.created_by||'')!==String(user.id))return false;
  const fields=['family_id','type','amount_kopecks','operation_date','operation_time','category_id','account_id','to_account_id','description','responsible_user_id','planned','parent_recurring_id'];
  return fields.every(field=>String(stored[field]??'')===String(candidate[field]??''));
}
function findRowsByIds_(table,ids){
  const found=new Map(),wanted=new Set((ids||[]).map(String));
  if(!wanted.size)return found;
  const sh=sheet_(table),last=sh.getLastRow(),idColumn=TABLES[table].indexOf('id')+1;
  if(last<2||idColumn<1)return found;
  SHEET_READS++;
  const values=timedSheetRead_(()=>sh.getRange(2,idColumn,last-1,1).getValues());
  const matches=[];
  values.forEach((row,index)=>{const id=String(row[0]??'');if(wanted.has(id))matches.push({id,row:index+2});});
  if(!matches.length)return found;
  // Read adjacent matches as one rectangular block instead of one Sheets call per row.
  // This preserves the narrow ID scan while collapsing N+1 reads for clustered IDs.
  const groups=[];
  let start=matches[0].row,previous=start,groupIds=[matches[0].id];
  for(let i=1;i<matches.length;i++){
    const match=matches[i];
    if(match.row===previous+1)groupIds.push(match.id);
    else{groups.push({start,ids:groupIds});start=match.row;groupIds=[match.id];}
    previous=match.row;
  }
  groups.push({start,ids:groupIds});
  groups.forEach(group=>{
    SHEET_READS++;
    const block=timedSheetRead_(()=>sh.getRange(group.start,1,group.ids.length,TABLES[table].length).getValues());
    block.forEach((values,index)=>{
      const row={};
      TABLES[table].forEach((column,columnIndex)=>row[column]=normal_(values[columnIndex],column));
      row.__row=group.start+index;
      found.set(group.ids[index],row);
    });
  });
  return found;
}
function query_(req,user){
  const table=req.table, mode=req.mode||'select'; if(!TABLES[table])throw new Error('Неизвестная таблица: '+table);
  if(table==='telegram_links'||table==='telegram_link_codes')throw new Error('Служебная Telegram-таблица недоступна через обычный API');
  const filters=req.filters||[];
  let all=null;
  if(mode==='select'&&table==='transactions')all=readTransactionRangeRows_(filters,user);
  if(all===null)all=(mode==='select'||mode==='update'||mode==='delete')?rows_(table):null;
  const matches=(row)=>filters.every(f=>{
    const a=row[f.column], b=f.value;
    switch(f.op){case 'eq':return String(a??'')===String(b??'');case 'neq':return String(a??'')!==String(b??'');case 'gte':return a>=b;case 'lte':return a<=b;case 'gt':return a>b;case 'lt':return a<b;case 'in':return (f.values||[]).map(String).includes(String(a));case 'is':return b===null?(a===null||a===''):String(a)===String(b);default:throw new Error('Фильтр не поддерживается');}
  });
  if(mode==='select'){
    all=all.filter(r=>matches(r)&&canAccessRow_(table,r,user));
    const orders=Array.isArray(req.orders)&&req.orders.length?req.orders:(req.order?[req.order]:[]);if(orders.length)all.sort((a,b)=>{for(const order of orders){const x=a[order.column],y=b[order.column];const cmp=String(x??'').localeCompare(String(y??''),undefined,{numeric:true});if(cmp)return order.ascending===false?-cmp:cmp;}return 0;});
    if(req.limit)all=all.slice(0,req.limit);
    return all.map(({__row,...r})=>r);
  }
  if(mode==='insert'){
    const input=Array.isArray(req.values)?req.values:[req.values];
    const explicitIds=input.filter(raw=>raw&&raw.id).map(raw=>raw.id);
    // For duplicate-ID checks, fetch only matching rows. Full-table reads remain
    // where they are semantically required: budget uniqueness and profile handling.
    const targetedRowsById=(table!=='budgets'&&table!=='profiles'&&explicitIds.length)
      ?findRowsByIds_(table,explicitIds):new Map();
    const needsExisting=table==='budgets'||table==='profiles';
    const existing=needsExisting?rows_(table):[];
    const createdIds_=new Set();
    const created=input.map(raw=>{
      const r=Object.assign({},raw);
      // Server owns identity and audit timestamps.
      if(table==='profiles' && r.id!==undefined && String(r.id)!==user.id)throw new Error('Нельзя изменять чужой профиль');
      if(table==='profiles')r.id=user.id;
      const existingById=r.id?(needsExisting?existing.find(x=>String(x.id)===String(r.id)):targetedRowsById.get(String(r.id))):null;
      if(existingById&&table!=='transactions'&&!IDEMPOTENT_INSERT_FIELDS[table])throw new Error('Запись с таким ID уже существует');
      if(!r.id)r.id=id_();
      if(TABLES[table].includes('created_at'))r.created_at=now_();
      if(TABLES[table].includes('updated_at'))r.updated_at=now_();
      if(createdIds_.has(String(r.id)))throw new Error('Повторяющийся ID в запросе');
      createdIds_.add(String(r.id));
      if((table==='categories'||table==='accounts')&&r.archived===undefined)r.archived=false;
      if(table==='family_members'){
        const family=rows_('families').find(f=>String(f.id)===String(r.family_id));
        if(!family || String(family.created_by)!==user.id || String(r.user_id)!==user.id || r.role!=='owner')throw new Error('Нельзя добавлять участника напрямую');
        if(rows_('family_members').some(m=>String(m.user_id)===user.id))throw new Error('Пользователь уже состоит в семье');
      } else if(table==='goal_contributions'){
        const goal=rows_('goals').find(g=>String(g.id)===String(r.goal_id));
        if(!goal || !allowedFamilyIds_(user).includes(String(goal.family_id)))throw new Error('Нет доступа к этой цели');
      } else if(table!=='profiles'&&table!=='families'&&(!r.family_id||(!allowedFamilyIds_(user).includes(String(r.family_id)) && !(table==='categories' && rows_('families').some(f=>String(f.id)===String(r.family_id)&&String(f.created_by)===user.id))))) throw new Error('Не указана семья или нет доступа к ней');
      if(table==='notifications'){
        if(r.user_id && String(r.user_id)!==user.id)throw new Error('Нельзя создавать уведомления для другого пользователя');
        r.user_id=user.id;
      }
      if(TABLES[table].includes('created_by'))r.created_by=user.id;
      if(TABLES[table].includes('updated_by'))r.updated_by=user.id;
      if((table==='transactions'||table==='goals'||table==='planned_purchases'||table==='recurring_payments')&&!r.responsible_user_id)r.responsible_user_id=user.id;
      if(table==='goals')r.saved_kopecks=rows_('goal_contributions').filter(c=>String(c.goal_id)===String(r.id)).reduce((sum,c)=>sum+Number(c.amount_kopecks||0),0);
      if(table==='families'){if(rows_('family_members').some(m=>String(m.user_id)===user.id))throw new Error('Пользователь уже состоит в семье');r.invite_code=r.invite_code||code_();r.currency='RUB';r.created_by=user.id;}
      validateRelations_(table,r,user);
      if(existingById){
        const same=table==='transactions'?sameTransactionInsert_(existingById,r,user):sameIdempotentInsert_(table,existingById,r,user);
        if(!same)throw new Error('Запись с таким ID уже существует или содержит другие данные');
        return {idempotent:true,row:existingById};
      }
      if(table==='budgets')assertUniqueBudget_(existing,r,existingById?existingById.id:undefined);
      existing.push(r);return {idempotent:false,row:r};
    });
    const newRows=created.filter(item=>!item.idempotent).map(item=>item.row);
    if(table==='goal_contributions'&&newRows.length){
      const goalIds=newRows.map(row=>row.goal_id);
      assertGoalContributionTotalsSafe_(goalIds,newRows,[]);
    }
    if(newRows.length)appendRows_(table,newRows);
    if(table==='goal_contributions'&&created.length)syncGoalTotals_(created.map(item=>item.row.goal_id));
    return req.returning?created.map(item=>strip_(item.row)):null;
  }
  if(mode==='update'||mode==='delete'){
    if(!filters.length)throw new Error('Для изменения или удаления нужен хотя бы один фильтр');
    if(table==='family_members')throw new Error('Изменение состава семьи требует отдельной операции');if(mode==='delete'&&(table==='families'||table==='profiles'))throw new Error('Удаление системных записей запрещено');
    if(mode==='delete'&&table==='accounts'){
      const accountIds=new Set(all.filter(r=>matches(r)&&canAccessRow_(table,r,user)).map(r=>String(r.id)));
      const referenced=rows_('transactions').some(tx=>accountIds.has(String(tx.account_id||''))||accountIds.has(String(tx.to_account_id||'')))||
        rows_('recurring_payments').some(payment=>accountIds.has(String(payment.account_id||'')));
      if(referenced)throw new Error('Счёт используется в истории. Архивируйте его вместо удаления.');
    }
    if(mode==='delete'&&table==='categories'){
      const categoryIds=new Set(all.filter(r=>matches(r)&&canAccessRow_(table,r,user)).map(r=>String(r.id)));
      const referenced=rows_('categories').some(row=>categoryIds.has(String(row.parent_id||'')))||
        rows_('transactions').some(row=>categoryIds.has(String(row.category_id||'')))||
        rows_('recurring_payments').some(row=>categoryIds.has(String(row.category_id||'')))||
        rows_('budgets').some(row=>categoryIds.has(String(row.category_id||'')))||
        rows_('planned_purchases').some(row=>categoryIds.has(String(row.category_id||'')))||
        rows_('monthly_plans').some(row=>categoryIds.has(String(row.category_id||'')));
      if(referenced)throw new Error('Категория используется в связанных данных. Архивируйте её вместо удаления.');
    }
    const changed=[],affectedGoalIds=new Set();
    all.forEach(r=>{
      if(matches(r)&&canAccessRow_(table,r,user)){
        if(table==='goal_contributions')affectedGoalIds.add(String(r.goal_id));
        if(mode==='delete'){if(req.expected!==undefined){const expected=req.expected;if(!expected||typeof expected!=='object'||Array.isArray(expected)||String(expected.id??'')!==String(r.id)||TABLES[table].some(column=>!Object.prototype.hasOwnProperty.call(expected,column)))throw new Error('Некорректный или неполный снимок записи для проверки удаления');const stale=TABLES[table].some(column=>JSON.stringify(expected[column]??null)!==JSON.stringify(r[column]??null));if(stale)throw new Error('Запись была изменена другим участником. Обновите данные и повторите удаление.');}changed.push(r);}
        else {const patch=req.values||{};if(req.expected!==undefined){const expected=req.expected;if(!expected||typeof expected!=='object'||Array.isArray(expected)||String(expected.id??'')!==String(r.id)||TABLES[table].some(column=>!Object.prototype.hasOwnProperty.call(expected,column)))throw new Error('Некорректный или неполный снимок записи для проверки изменений');const stale=TABLES[table].some(column=>JSON.stringify(expected[column]??null)!==JSON.stringify(r[column]??null));if(stale)throw new Error('Запись была изменена другим участником. Обновите данные и повторите изменение.');}if(table==='goals'&&Object.prototype.hasOwnProperty.call(patch,'saved_kopecks'))throw new Error('Баланс цели рассчитывается по истории пополнений');if(patch.id!==undefined&&String(patch.id)!==String(r.id))throw new Error('Нельзя менять ID записи');if(patch.family_id!==undefined&&String(patch.family_id)!==String(r.family_id))throw new Error('Нельзя переносить запись между семьями');if(table==='families'&&['id','created_by','invite_code'].some(k=>Object.prototype.hasOwnProperty.call(patch,k)))throw new Error('Системные поля семьи нельзя менять');if(table==='notifications'&&Object.prototype.hasOwnProperty.call(patch,'user_id')&&String(patch.user_id)!==String(r.user_id))throw new Error('Нельзя менять получателя уведомления');if(TABLES[table].includes('created_by')&&Object.prototype.hasOwnProperty.call(patch,'created_by')&&String(patch.created_by)!==String(r.created_by))throw new Error('Нельзя менять автора записи');if(table==='profiles'&&String(r.id)!==user.id)throw new Error('Нет доступа к профилю');const next=Object.assign({},r,patch);if(table==='goal_contributions')affectedGoalIds.add(String(next.goal_id));if(TABLES[table].includes('updated_by'))next.updated_by=user.id;if(TABLES[table].includes('updated_at'))next.updated_at=now_();delete next.__row;if(TABLES[table].includes('created_at')&&Object.prototype.hasOwnProperty.call(patch,'created_at')&&String(patch.created_at)!==String(r.created_at))throw new Error('Нельзя менять дату создания записи');validateRelations_(table,next,user,r);if(table==='budgets')assertUniqueBudget_(all,next,r.id);if(table==='goal_contributions'){const goal=rows_('goals').find(g=>String(g.id)===String(next.goal_id));if(!goal||!allowedFamilyIds_(user).includes(String(goal.family_id)))throw new Error('Нет доступа к этой цели');}next.__row=r.__row;changed.push(next);}
      }
    });
    if(mode==='delete'&&req.expected!==undefined&&changed.length!==1)throw new Error('Запись уже удалена или недоступна. Обновите список и повторите действие.');
    if(table==='goal_contributions'&&changed.length){
      const goalIds=changed.flatMap(row=>[row.goal_id]);
      const replacements=mode==='delete'?[]:changed;
      assertGoalContributionTotalsSafe_(goalIds,replacements,changed.map(row=>row.id));
    }
    if(mode==='delete'&&table==='goals'&&changed.length){
      // Delete dependants before the goal row. If any child write fails, the
      // parent remains available so the same request can safely resume the cascade.
      const deletedIds=new Set(changed.map(goal=>String(goal.id)));
      const contributions=rows_('goal_contributions').filter(row=>deletedIds.has(String(row.goal_id)));
      if(contributions.length)deleteRows_('goal_contributions',contributions);
      const purchases=rows_('planned_purchases'),purchasesChanged=[];
      purchases.forEach(purchase=>{
        if(purchase.goal_id&&deletedIds.has(String(purchase.goal_id))&&canAccessRow_('planned_purchases',purchase,user)){
          purchase.goal_id='';
          purchasesChanged.push(purchase);
        }
      });
      if(purchasesChanged.length)updateRows_('planned_purchases',purchasesChanged);
    }
    if(mode==='delete')deleteRows_(table,changed);else updateRows_(table,changed);
    if(mode==='delete'&&(table==='recurring_payments'||table==='transactions')){
      // A delete may commit before its dependent-row update fails. On retry the
      // parent row is already gone, so recover links from the explicit ID filter.
      const requestedIds=new Set((req.filters||[])
        .filter(filter=>filter&&filter.column==='id'&&filter.op==='eq'&&filter.value!==undefined&&filter.value!==null)
        .map(filter=>String(filter.value)));
      const deletedIds=new Set(changed.map(row=>String(row.id)));
      requestedIds.forEach(id=>deletedIds.add(id));
      if(table==='recurring_payments'&&deletedIds.size){
        const transactions=rows_('transactions'),transactionsChanged=[];
        transactions.forEach(tx=>{
          if(tx.parent_recurring_id&&deletedIds.has(String(tx.parent_recurring_id))&&canAccessRow_('transactions',tx,user)){
            tx.parent_recurring_id='';
            transactionsChanged.push(tx);
          }
        });
        if(transactionsChanged.length)updateRows_('transactions',transactionsChanged);
      }
      if(table==='transactions'&&deletedIds.size){
        const purchases=rows_('planned_purchases'),purchasesChanged=[];
        purchases.forEach(p=>{
          if(p.linked_transaction_id&&deletedIds.has(String(p.linked_transaction_id))&&canAccessRow_('planned_purchases',p,user)){
            p.linked_transaction_id='';
            if(p.status==='bought')p.status='planned';
            purchasesChanged.push(p);
          }
        });
        if(purchasesChanged.length)updateRows_('planned_purchases',purchasesChanged);
      }
    }
    if(table==='goal_contributions'){
      // A retried delete may find no contribution row, and a retried move may no
      // longer reveal its former goal_id, if the contribution write committed but
      // the denormalized goal-balance write failed. Reconcile every goal in the
      // caller's family after updates/deletes so retries repair both partial cases.
      if(mode==='delete'||mode==='update'){
        const familyIds=new Set(allowedFamilyIds_(user));
        rows_('goals').forEach(goal=>{if(familyIds.has(String(goal.family_id)))affectedGoalIds.add(String(goal.id));});
      }
      syncGoalTotals_([...affectedGoalIds]);
    }
    return req.returning?changed.map(strip_):null;
  }
  if(mode==='upsert'){
    const input=Array.isArray(req.values)?req.values:[req.values], existing=rows_(table);
    if(table==='family_members'||table==='families')throw new Error('Для этой таблицы upsert запрещён');
    const affectedGoalIds=new Set(), updatedRows=[], insertedRows=[];
    input.forEach((raw,inputIndex)=>{
      if(req.expectedRows!==undefined){if(!Array.isArray(req.expectedRows)||req.expectedRows.length!==input.length)throw new Error('Некорректный снимок месячного плана');const expected=req.expectedRows[inputIndex];const keys=String(req.onConflict||'id').split(',').map(s=>s.trim());const expectedMatches=expected&&typeof expected==='object'&&!Array.isArray(expected)&&keys.every(k=>String(expected[k]??'')===String(raw[k]??''));if(expected!==null&&expected!==undefined&&!expectedMatches)throw new Error('Некорректный снимок месячного плана');}
      if(table==='goals'&&Object.prototype.hasOwnProperty.call(raw,'saved_kopecks'))throw new Error('Баланс цели рассчитывается по истории пополнений');
      if(table==='notifications'&&raw.user_id&&String(raw.user_id)!==user.id)throw new Error('Нельзя создавать уведомления для другого пользователя');
      if(table==='notifications')raw.user_id=user.id;
      if(table==='profiles' && String(raw.id)!==user.id)throw new Error('Нельзя изменять чужой профиль');
      if(table==='goal_contributions'){const goal=rows_('goals').find(g=>String(g.id)===String(raw.goal_id));if(!goal||!allowedFamilyIds_(user).includes(String(goal.family_id)))throw new Error('Нет доступа к этой цели');}
      else if(table!=='profiles'&&(!raw.family_id||!allowedFamilyIds_(user).includes(String(raw.family_id))))throw new Error('Нет доступа к этой семье');
      const keys=String(req.onConflict||'id').split(',').map(s=>s.trim());
      const found=existing.find(r=>keys.every(k=>String(r[k]??'')===String(raw[k]??''))&&canAccessRow_(table,r,user));
      if(table==='profiles' && String(raw.id)!==user.id)throw new Error('Нельзя изменять чужой профиль');
      if(raw.id!==undefined&&existing.some(r=>String(r.id)===String(raw.id))&&(!found||String(found.id)!==String(raw.id)))throw new Error('Запись с таким ID уже существует или недоступна');
      if(found){
        if(req.expectedRows!==undefined){const expected=req.expectedRows[inputIndex];if(!expected)throw new Error('Запись была создана другим участником. Обновите планы и повторите действие.');if(typeof expected!=='object'||Array.isArray(expected)||TABLES[table].some(column=>!Object.prototype.hasOwnProperty.call(expected,column)))throw new Error('Некорректный или неполный снимок месячного плана');const stale=TABLES[table].some(column=>JSON.stringify(expected[column]??null)!==JSON.stringify(found[column]??null));if(stale)throw new Error('План был изменён другим участником. Обновите данные и повторите изменение.');}
        if(table==='goal_contributions')affectedGoalIds.add(String(found.goal_id));
        if(raw.id!==undefined&&String(raw.id)!==String(found.id))throw new Error('Нельзя менять ID записи');
        if(raw.family_id!==undefined&&String(raw.family_id)!==String(found.family_id))throw new Error('Нельзя переносить запись между семьями');
        if(TABLES[table].includes('created_by')&&raw.created_by!==undefined&&String(raw.created_by)!==String(found.created_by))throw new Error('Нельзя менять автора записи');
        if(TABLES[table].includes('created_at')&&raw.created_at!==undefined&&String(raw.created_at)!==String(found.created_at))throw new Error('Нельзя менять дату создания записи');
        const next=Object.assign({},found,raw); // Validate with the authenticated user, including goal ownership.
        validateRelations_(table,next,user,found);if(table==='budgets')assertUniqueBudget_(existing,next,found.id);Object.assign(found,raw);
        if(table==='goal_contributions')affectedGoalIds.add(String(found.goal_id));
        if(TABLES[table].includes('updated_by'))found.updated_by=user.id;
        if(TABLES[table].includes('updated_at'))found.updated_at=now_();
        updatedRows.push(found);
      }else {
        if(req.expectedRows!==undefined&&req.expectedRows[inputIndex])throw new Error('Запись была удалена другим участником. Обновите планы и повторите действие.');
        const r=Object.assign({id:id_()},raw);
        if((table==='transactions'||table==='goals'||table==='planned_purchases'||table==='recurring_payments')&&!r.responsible_user_id)r.responsible_user_id=user.id;
        if(TABLES[table].includes('created_at'))r.created_at=now_();
        if(TABLES[table].includes('updated_at'))r.updated_at=now_();
        if(TABLES[table].includes('created_by'))r.created_by=user.id;
        if(TABLES[table].includes('updated_by'))r.updated_by=user.id;
        if(r.family_id&&!allowedFamilyIds_(user).includes(String(r.family_id)))throw new Error('Нет доступа к этой семье');
        validateRelations_(table,r,user);
        if(table==='budgets')assertUniqueBudget_(existing,r);
        existing.push(r);
        insertedRows.push(r);
        if(table==='goal_contributions')affectedGoalIds.add(String(r.goal_id));
      }
    });
    if(table==='goal_contributions'&&(updatedRows.length||insertedRows.length)){
      const goalIds=[...affectedGoalIds];
      assertGoalContributionTotalsSafe_(goalIds,[...updatedRows,...insertedRows],updatedRows.map(row=>row.id));
    }
    updateRows_(table,updatedRows);
    appendRows_(table,insertedRows);
    if(table==='goal_contributions')syncGoalTotals_([...affectedGoalIds]);
    return null;
  }
  throw new Error('Неизвестный режим запроса');
}
function rollbackFamily_(familyId){
  const id=String(familyId), failures=[];
  [['categories',r=>String(r.family_id)===id],['family_members',r=>String(r.family_id)===id],['families',r=>String(r.id)===id]]
    .forEach(u=>{try{deleteRows_(u[0],rows_(u[0]).filter(u[1]));}catch(err){failures.push(u[0]+': '+(err&&err.message?err.message:String(err)));}});
  if(failures.length)throw new Error('Не удалось полностью отменить создание семьи: '+failures.join('; '));
}
function strip_(r){const o=Object.assign({},r);delete o.__row;return o;}
function seedCategories_(familyId){
 const t=now_(),fid=String(familyId),have=rows_('categories').filter(c=>String(c.family_id)===fid),created=[];
 DEFAULT_CATEGORIES.forEach((p,i)=>{let parent=have.find(c=>!c.parent_id&&c.name===p.name&&c.kind===p.kind);if(!parent){parent={id:id_(),family_id:familyId,parent_id:null,name:p.name,kind:p.kind,icon:p.icon,color:p.color,archived:false,sort_order:i,created_at:t};created.push(parent);have.push(parent)}(p.children||[]).forEach((c,k)=>{if(have.some(x=>String(x.parent_id)===String(parent.id)&&x.name===c.name))return;const row={id:id_(),family_id:familyId,parent_id:parent.id,name:c.name,kind:p.kind,icon:c.icon,color:c.color,archived:false,sort_order:k,created_at:t};created.push(row);have.push(row)})});appendRows_('categories',created);
}
function assertGoalContributionTotalsSafe_(goalIds,replacements,removedIds){
  const ids=new Set((goalIds||[]).map(String));
  if(!ids.size)return;
  const removed=new Set((removedIds||[]).map(String));
  const totals=new Map([...ids].map(id=>[id,0]));
  const current=rows_('goal_contributions').filter(row=>ids.has(String(row.goal_id))&&!removed.has(String(row.id)));
  [...current,...(replacements||[])].forEach(row=>{
    const goalId=String(row.goal_id),amount=row.amount_kopecks;
    if(!ids.has(goalId))return;
    if(typeof amount!=='number'||!Number.isSafeInteger(amount)||amount<=0)
      throw new Error('Сумма пополнения должна быть положительным целым числом копеек');
    const next=totals.get(goalId)+amount;
    if(!Number.isSafeInteger(next))
      throw new Error('Сумма пополнений цели превышает безопасный диапазон целых копеек');
    totals.set(goalId,next);
  });
}
function readGoalContributionTotals_(goalIds){
  const ids=new Set((goalIds||[]).map(String)), totals=new Map([...ids].map(id=>[id,0]));
  if(!ids.size)return totals;
  const sh=sheet_('goal_contributions'),last=sh.getLastRow(),rowCount=last-1;
  if(rowCount<1)return totals;
  const goalColumn=TABLES.goal_contributions.indexOf('goal_id')+1;
  const amountColumn=TABLES.goal_contributions.indexOf('amount_kopecks')+1;
  if(amountColumn!==goalColumn+1)throw new Error('Схема пополнений целей изменилась: ожидаются соседние столбцы цели и суммы');
  // Reconciliation needs only goal_id + amount_kopecks, not notes, authors or timestamps.
  SHEET_READS++;
  const values=timedSheetRead_(()=>sh.getRange(2,goalColumn,rowCount,2).getValues());
  values.forEach(row=>{
    const goalId=String(normal_(row[0],'goal_id')??'');
    if(!totals.has(goalId))return;
    const amount=Number(normal_(row[1],'amount_kopecks')||0),next=totals.get(goalId)+amount;
    if(!Number.isSafeInteger(next))throw new Error('Сумма пополнений цели превышает безопасный диапазон целых копеек');
    totals.set(goalId,next);
  });
  return totals;
}
function syncGoalTotals_(goalIds){
  const ids=[...new Set((goalIds||[]).filter(Boolean).map(String))];
  if(!ids.length)return;
  const totals=readGoalContributionTotals_(ids), goals=findRowsByIds_('goals',ids);
  const changed=[];
  ids.forEach(id=>{
    const goal=goals.get(id);
    if(!goal)return;
    const next=Number(totals.get(id)||0);
    if(Number(goal.saved_kopecks||0)!==next){goal.saved_kopecks=next;changed.push(goal);}
  });
  if(changed.length)updateRows_('goals',changed);
}
function rpc_(req,user){
  const name=req.name, p=req.params||{};
  if(name==='get_table_revision'){
    const table=String(p.p_table||''),familyId=String(p.p_family_id||'');
    if(!TABLES[table]||table==='telegram_links'||table==='telegram_link_codes'||table==='profiles')throw new Error('Таблица недоступна для отслеживания изменений');
    if(!familyId||!allowedFamilyIds_(user).includes(familyId))throw new Error('Нет доступа к этой семье');
    if(table==='notifications'){
      const userId=String(p.p_user_id||'');
      if(!userId||userId!==user.id)throw new Error('Нет доступа к ревизии уведомлений другого пользователя');
      return PropertiesService.getScriptProperties().getProperty(tableRevisionKey_(table,familyId,userId))||'0';
    }
    return PropertiesService.getScriptProperties().getProperty(tableRevisionKey_(table,familyId))||'0';
  }
  if(name==='ensure_supplemental_categories'){
    const familyId=String(p.p_family_id||'');
    if(!allowedFamilyIds_(user).includes(familyId))throw new Error('Нет доступа к этой семье');
    const definitions=[
      {name:'Сигареты',kind:'expense',icon:'🚬',color:'#78716c',children:[]},
      {name:'Кредиты',kind:'expense',icon:'💳',color:'#64748b',children:[
        {name:'Погашение основного долга',icon:'💳',color:'#64748b'},
        {name:'Проценты по кредиту',icon:'📈',color:'#64748b'},
        {name:'Комиссии по кредиту',icon:'💸',color:'#64748b'}
      ]}
    ];
    const have=rows_('categories').filter(x=>String(x.family_id)===familyId),created=[];
    definitions.forEach(def=>{
      let parent=have.find(x=>!x.parent_id&&x.name===def.name&&x.kind===def.kind);
      if(!parent){
        parent={id:id_(),family_id:familyId,parent_id:null,name:def.name,kind:def.kind,icon:def.icon,color:def.color,archived:false,sort_order:0,created_at:now_()};
        have.push(parent);created.push(parent);
      }
      (def.children||[]).forEach((child,index)=>{
        if(have.some(x=>String(x.parent_id)===String(parent.id)&&x.name===child.name))return;
        const row={id:id_(),family_id:familyId,parent_id:parent.id,name:child.name,kind:def.kind,icon:child.icon,color:child.color,archived:false,sort_order:index,created_at:now_()};
        have.push(row);created.push(row);
      });
    });
    if(created.length)appendRows_('categories',created);
    return {added:created.length};
  }
  if(name==='create_goal_with_purchase'){
    const familyId=String(p.p_family_id||'');
    if(!allowedFamilyIds_(user).includes(familyId))throw new Error('Нет доступа к этой семье');
    const requestId=String(p.p_request_id||'');
    if(!/^op_[a-f0-9]{32}$/.test(requestId))throw new Error('Некорректный идентификатор запроса создания цели');
    assertKopecks_(p.p_target_kopecks,'Сумма цели',{positive:true});
    const target=p.p_target_kopecks,priority=Number(p.p_priority);
    const goalName=String(p.p_name||'').trim(),description=String(p.p_description||'').trim();
    if(!goalName)throw new Error('Введите название цели');
    if(!Number.isSafeInteger(target)||target<=0)throw new Error('Сумма цели должна быть положительным целым числом копеек');
    if(!Number.isInteger(priority)||priority<1||priority>5)throw new Error('Приоритет должен быть от 1 до 5');
    const targetDate=p.p_target_date?String(p.p_target_date):'';
    if(targetDate&&!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))throw new Error('Некорректная целевая дата');
    const goalId='goal_'+requestId;
    let goal=rows_('goals').find(row=>String(row.id)===goalId);
    if(goal){
      if(String(goal.family_id)!==familyId||String(goal.name)!==goalName||String(goal.description||'')!==description||
        Number(goal.target_kopecks)!==target||String(goal.target_date||'')!==(targetDate||'')||
        Number(goal.priority)!==priority||String(goal.responsible_user_id||'')!==user.id)
        throw new Error('Конфликт ID цели: запись не соответствует исходному запросу');
    }else{
      goal={id:goalId,family_id:familyId,name:goalName,description,target_kopecks:target,saved_kopecks:0,target_date:targetDate||null,priority,status:'active',responsible_user_id:user.id,created_at:now_()};
      appendRows_('goals',[goal]);
    }
    let purchaseId=null;
    if(p.p_create_purchase===true){
      purchaseId='purchase_'+requestId;
      let purchase=rows_('planned_purchases').find(row=>String(row.id)===purchaseId);
      if(purchase){
        if(String(purchase.family_id)!==familyId||String(purchase.name)!==goalName||
          Number(purchase.estimated_kopecks)!==target||Number(purchase.priority)!==priority||
          String(purchase.goal_id||'')!==goalId||String(purchase.comment||'')!==description||
          String(purchase.desired_date||'')!==(targetDate||''))
          throw new Error('Конфликт ID покупки: запись не соответствует исходному запросу');
      }else{
        purchase={id:purchaseId,family_id:familyId,name:goalName,category_id:null,estimated_kopecks:target,priority,desired_month:targetDate?targetDate.slice(0,7)+'-01':null,desired_date:targetDate||null,url:'',comment:description,status:'planned',responsible_user_id:user.id,goal_id:goalId,linked_transaction_id:'',created_by:user.id,created_at:now_()};
        validateRelations_('planned_purchases',purchase,user);
        appendRows_('planned_purchases',[purchase]);
      }
    }
    return {goal_id:goalId,purchase_id:purchaseId};
  }
  if(name==='create_telegram_link_code'){
    const members=rows_('family_members').filter(m=>String(m.user_id)===user.id);
    if(!members.length)throw new Error('Сначала создайте семью или присоединитесь к ней');
    const familyId=String(members[0].family_id);
    const existing=rows_('telegram_links').find(x=>String(x.user_id)===user.id&&String(x.family_id)===familyId);
    if(existing)throw new Error('К Telegram уже привязан аккаунт. Сначала отвяжите его.');
    const code=code_().slice(0,12), expires=new Date(Date.now()+15*60*1000).toISOString();
    const old=rows_('telegram_link_codes').filter(x=>String(x.user_id)===user.id&&!x.used_at);
    // Persist the replacement before invalidating old codes. If append fails, the previous code remains usable.
    appendRows_('telegram_link_codes',[{id:id_(),user_id:user.id,family_id:familyId,code_hash:telegramCodeHash_(code),expires_at:expires,used_at:'',created_at:now_()}]);
    if(old.length)deleteRows_('telegram_link_codes',old);
    return {code,expires_at:expires};
  }
  if(name==='get_telegram_link_status'){
    const link=rows_('telegram_links').find(x=>String(x.user_id)===user.id);
    return link?{linked:true,linked_at:link.linked_at,telegram_chat_id:link.telegram_chat_id}:{linked:false};
  }
  if(name==='unlink_telegram'){
    // Revoke unused link codes first. If link deletion later fails, a retry cannot re-link via a stale code.
    const codes=rows_('telegram_link_codes').filter(x=>String(x.user_id)===user.id);
    if(codes.length)deleteRows_('telegram_link_codes',codes);
    const links=rows_('telegram_links').filter(x=>String(x.user_id)===user.id);
    if(links.length)deleteRows_('telegram_links',links);
    return true;
  }
  if(name==='join_family_by_invite'){route_({action:'joinFamily',invite_code:p.p_invite_code,display_name:p.p_display_name},user);return true;}
  if(name==='create_family')return route_({action:'createFamily',name:p.p_name,display_name:p.p_display_name},user);
  if(name==='get_my_context'){
   const profile=rows_('profiles').find(x=>x.id===user.id);
   const ownMemberships=rows_('family_members').filter(m=>String(m.user_id)===user.id);
   const familyIds=new Set(ownMemberships.map(m=>String(m.family_id)));
   const members=rows_('family_members').filter(m=>familyIds.has(String(m.family_id))).map(strip_);
   const family=ownMemberships.length?rows_('families').find(f=>String(f.id)===String(ownMemberships[0].family_id)):null;
   const memberIds=new Set(members.map(m=>String(m.user_id)));
   const memberProfiles=rows_('profiles').filter(x=>memberIds.has(String(x.id))).map(strip_);
   return{profile:profile?strip_(profile):null,members,family:family?strip_(family):null,member_profiles:memberProfiles};
  }
  if(name==='confirm_planned_purchase'){
    const id=String(p.p_purchase_id||'');
    const purchases=rows_('planned_purchases');
    const purchase=purchases.find(x=>String(x.id)===id&&canAccessRow_('planned_purchases',x,user));
    if(!purchase)throw new Error('Планируемая покупка не найдена');
    const transactionId='purchase_'+purchase.id;
    const accountId=String(p.p_account_id||'');
    if(accountId){
      const account=rows_('accounts').find(x=>String(x.id)===accountId&&canAccessRow_('accounts',x,user));
      if(!account||String(account.family_id)!==String(purchase.family_id))throw new Error('Выбранный счёт не найден в этой семье');
      if(account.archived)throw new Error('Нельзя списать покупку с архивного счёта');
    }
    const txs=rows_('transactions');
    let tx=txs.find(x=>String(x.id)===transactionId);
    if(tx && (
      String(tx.family_id)!==String(purchase.family_id) ||
      tx.type!=='expense' ||
      Number(tx.amount_kopecks)!==Number(purchase.estimated_kopecks) ||
      String(tx.category_id||'')!==String(purchase.category_id||'') ||
      String(tx.description||'')!==String(purchase.name||'') ||
      String(tx.account_id||'')!==accountId ||
      String(tx.operation_date||'')!==String(p.p_operation_date||'') ||
      String(tx.parent_recurring_id||'')!==''
    ))throw new Error('Конфликт ID операции: запись не соответствует планируемой покупке');
    if(purchase.linked_transaction_id && String(purchase.linked_transaction_id)!==transactionId)throw new Error('Покупка уже связана с другой операцией');
    // A matching deterministic transaction means this is a retry after a partial or completed commit.
    // Only a new confirmation is compared with the purchase snapshot shown in the UI.
    if(!tx && p.p_expected_purchase!==undefined){
      const expected=p.p_expected_purchase;
      if(!expected||typeof expected!=='object'||Array.isArray(expected)||String(expected.id||'')!==id)throw new Error('Некорректный снимок планируемой покупки');
      const stale=TABLES.planned_purchases.some(column=>Object.prototype.hasOwnProperty.call(expected,column)&&JSON.stringify(expected[column]??null)!==JSON.stringify(purchase[column]??null));
      if(stale)throw new Error('Планируемая покупка была изменена другим участником. Обновите список и повторите подтверждение.');
    }
    if(!tx){
      tx={id:transactionId,family_id:purchase.family_id,type:'expense',amount_kopecks:purchase.estimated_kopecks,operation_date:p.p_operation_date,operation_time:null,category_id:purchase.category_id||null,account_id:accountId||null,to_account_id:null,description:purchase.name,created_by:user.id,updated_by:user.id,responsible_user_id:purchase.responsible_user_id||purchase.created_by||user.id,planned:false,parent_recurring_id:null,created_at:now_(),updated_at:now_()};
      appendRows_('transactions',[tx]);
    }
    purchase.status='bought';
    purchase.linked_transaction_id=transactionId;
    updateRows_('planned_purchases',[purchase]);
    return {transaction_id:transactionId};
  }
  if(name==='confirm_recurring_payment'){
    const id=String(p.p_recurring_id||''), r=rows_('recurring_payments').find(x=>String(x.id)===id&&canAccessRow_('recurring_payments',x,user));
    if(!r)throw new Error('Регулярный платёж не найден');
    const expectedDueDate=String(p.p_expected_due_date||''), operationDate=String(p.p_operation_date||'');
    const nextExpectedDate=nextDate_(expectedDueDate,r.frequency,r.custom_interval_days,r.start_date);
    if(!nextExpectedDate)throw new Error('Не удалось вычислить следующую дату регулярного платежа');
    const expected=p.p_expected_recurring;
    if(expected!==undefined&&(!expected||typeof expected!=='object'||Array.isArray(expected)||String(expected.id||'')!==id))throw new Error('Некорректный снимок регулярного платежа');
    const transactionId='recurring_'+r.id+'_'+expectedDueDate;
    const existingTx=rows_('transactions').find(t=>String(t.id)===transactionId);
    const source=expected||r;
    if(existingTx && (
      String(existingTx.family_id)!==String(source.family_id) ||
      String(existingTx.parent_recurring_id||'')!==String(r.id) ||
      String(existingTx.type)!==String(source.type) ||
      Number(existingTx.amount_kopecks)!==Number(source.amount_kopecks) ||
      String(existingTx.category_id||'')!==String(source.category_id||'') ||
      String(existingTx.account_id||'')!==String(source.account_id||'') ||
      String(existingTx.description||'')!==String(source.description||'') ||
      String(existingTx.operation_date||'')!==operationDate
    ))throw new Error('Конфликт ID операции: запись не соответствует исходному регулярному платежу');
    // A fully committed replay is safe even though next_due_date has already advanced.
    if(existingTx && r.next_due_date!==expectedDueDate){
      // The occurrence already advanced. Later edits to the recurring schedule must not turn a safe replay into a failure.
      return true;
    }
    // Before creating a transaction, require the complete row snapshot shown to the user.
    // For a partial commit, ignore only next_due_date: it must still be the occurrence being confirmed.
    if(expected!==undefined){
      const columns=TABLES.recurring_payments.filter(column=>column!=='next_due_date');
      const stale=columns.some(column=>Object.prototype.hasOwnProperty.call(expected,column)&&JSON.stringify(expected[column]??null)!==JSON.stringify(r[column]??null));
      if(stale)throw new Error('Регулярный платёж был изменён другим участником. Обновите страницу и повторите подтверждение.');
    }
    if(r.next_due_date!==expectedDueDate)throw new Error('Дата платежа уже изменилась. Обновите страницу.');
    if(r.end_date && expectedDueDate>r.end_date){r.active=false;updateRows_('recurring_payments',[r]);return true;}
    if(!existingTx)appendRows_('transactions',[{id:transactionId,family_id:r.family_id,type:r.type,amount_kopecks:r.amount_kopecks,operation_date:operationDate,operation_time:null,category_id:r.category_id,account_id:r.account_id,to_account_id:null,description:r.description,created_by:user.id,updated_by:user.id,responsible_user_id:r.responsible_user_id||r.created_by||user.id,planned:false,parent_recurring_id:r.id,created_at:now_(),updated_at:now_()}]);
    r.next_due_date=nextExpectedDate;
    if(r.end_date && r.next_due_date>r.end_date)r.active=false;
    updateRows_('recurring_payments',[r]);return true;
  }
  throw new Error('RPC не поддерживается: '+name);
}
function nextDate_(iso,freq,days,anchorIso){
  const d=new Date(iso+'T12:00:00Z');
  const anchor=new Date((anchorIso||iso)+'T12:00:00Z');
  if(freq==='daily')d.setUTCDate(d.getUTCDate()+1);
  else if(freq==='weekly')d.setUTCDate(d.getUTCDate()+7);
  else if(freq==='custom')d.setUTCDate(d.getUTCDate()+Math.max(1,Number(days)||30));
  else if(freq==='yearly'){
    const year=d.getUTCFullYear()+1, month=anchor.getUTCMonth(), day=anchor.getUTCDate();
    const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
    return new Date(Date.UTC(year,month,Math.min(day,last),12)).toISOString().slice(0,10);
  } else {
    const year=d.getUTCFullYear(), month=d.getUTCMonth()+1, day=anchor.getUTCDate();
    const nextMonth=new Date(Date.UTC(year,month,1));
    const last=new Date(Date.UTC(nextMonth.getUTCFullYear(),nextMonth.getUTCMonth()+1,0)).getUTCDate();
    nextMonth.setUTCHours(12,0,0,0);nextMonth.setUTCDate(Math.min(day,last));
    return nextMonth.toISOString().slice(0,10);
  }
  return d.toISOString().slice(0,10);
}


const TELEGRAM_UPDATE_TTL_MS = 24 * 60 * 60 * 1000;
const TELEGRAM_UPDATE_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
/* ===== Telegram webhook: вход только через доверенный Vercel endpoint ===== */
function telegramCodeHash_(code){
  const digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(code).trim().toUpperCase(),Utilities.Charset.UTF_8);
  return Utilities.base64Encode(digest).split('+').join('-').split('/').join('_').replace(/=+$/,'');
}
function telegramWebhook_(req){
  const props=PropertiesService.getScriptProperties();
  const expected=props.getProperty('TELEGRAM_BACKEND_SECRET');
  if(!expected||expected.length<32||!safeEqual_(String(req.telegramSecret||''),expected))throw new Error('Webhook authentication failed');
  const update=req.update||{}, updateId=String(update.update_id||'');
  const savedPrune=Number(props.getProperty('telegram:last_prune')||0);
  const lastPrune=Number.isFinite(savedPrune)?savedPrune:0;
  if(Date.now()-lastPrune>TELEGRAM_UPDATE_PRUNE_INTERVAL_MS){
    const all=props.getProperties();
    Object.keys(all).forEach(key=>{if(!key.startsWith('telegram:update:'))return;try{const item=JSON.parse(all[key]);if(!item.expires||item.expires<=Date.now())props.deleteProperty(key);}catch(_){props.deleteProperty(key);}});
    props.setProperty('telegram:last_prune',String(Date.now()));
  }
  const updateKey=updateId?'telegram:update:'+updateId:'';
  if(updateKey){
    const saved=props.getProperty(updateKey);
    if(saved){try{const cached=JSON.parse(saved);if(cached.expires>Date.now())return cached.reply;props.deleteProperty(updateKey);}catch(_){props.deleteProperty(updateKey);}}
  }
  const message=update.message;
  if(!message||!message.chat||!message.from||String(message.chat.type)!=='private')return {skip:true};
  const chatId=String(message.chat.id), telegramUserId=String(message.from.id), text=String(message.text||'').trim();
  if(!text)return {chat_id:chatId,text:'Отправьте текстовое сообщение или команду /help.'};
  let reply;
  const linkCommand=text.match(/^\/link(?:@\w+)?\s+([A-Z0-9]{6,16})$/i);
  if(/^\/start(?:@\w+)?(?:\s.*)?$/i.test(text)){
    const linked=rows_('telegram_links').find(x=>String(x.telegram_user_id)===telegramUserId);
    reply={chat_id:chatId,text:linked?'Бот подключён к вашему семейному бюджету.\n\nПример записи: Проезд 45 рублей\nКоманды: /help, /balance, /unlink':'Чтобы подключить бота, откройте приложение «Бюджет для двоих», создайте код привязки и отправьте сюда команду:\n/link ВАШ_КОД\n\nКод действует 15 минут.'};
  }else if(/^\/help(?:@\w+)?$/i.test(text)){
    reply={chat_id:chatId,text:'Команды:\n/link КОД — привязать аккаунт приложения\n/balance — сводка за текущий месяц\n/unlink — отвязать Telegram\n/help — помощь\n\nДобавление операции: «Проезд 45 рублей» или «Доход 5000 рублей зарплата».'};
  }else if(linkCommand){
    const code=linkCommand[1].toUpperCase(), hash=telegramCodeHash_(code), now=now_();
    const codeRow=rows_('telegram_link_codes').find(x=>String(x.code_hash)===hash);
    const existingTelegramLink=rows_('telegram_links').find(x=>String(x.telegram_user_id)===telegramUserId);
    const alreadyCompleted=!!(codeRow&&codeRow.used_at&&existingTelegramLink&&
      String(existingTelegramLink.user_id)===String(codeRow.user_id)&&
      String(existingTelegramLink.family_id)===String(codeRow.family_id));
    if(alreadyCompleted){
      // Telegram may retry after link + used_at persisted but before update_id cache was written.
      // The same code and same Telegram/account link are a completed replay.
      reply={chat_id:chatId,text:'Telegram успешно привязан к вашему аккаунту.\n\nТеперь отправьте, например: Проезд 45 рублей\nКоманды: /help и /balance'};
    }else{
      const candidate=codeRow&&!codeRow.used_at&&String(codeRow.expires_at)>now?codeRow:null;
      if(!candidate)throw new Error('Код не найден, уже использован или истёк. Создайте новый код в приложении.');
      const membership=rows_('family_members').find(x=>String(x.user_id)===String(candidate.user_id)&&String(x.family_id)===String(candidate.family_id));
      if(!membership)throw new Error('Пользователь больше не состоит в этой семье.');
      const links=rows_('telegram_links');
      const byTelegram=links.find(x=>String(x.telegram_user_id)===telegramUserId);
      const byUser=links.find(x=>String(x.user_id)===String(candidate.user_id));
      if(byTelegram&&String(byTelegram.user_id)!==String(candidate.user_id))throw new Error('Этот Telegram уже привязан к другому аккаунту.');
      if(byUser&&String(byUser.telegram_user_id)!==telegramUserId)throw new Error('К аккаунту приложения уже привязан другой Telegram. Сначала отвяжите его в приложении.');
      if(byTelegram){
        byTelegram.telegram_chat_id=chatId;
        updateRows_('telegram_links',[byTelegram]);
      }else{
        appendRows_('telegram_links',[{id:id_(),telegram_user_id:telegramUserId,telegram_chat_id:chatId,user_id:candidate.user_id,family_id:candidate.family_id,linked_at:now_()}]);
      }
      candidate.used_at=now_();updateRows_('telegram_link_codes',[candidate]);
      reply={chat_id:chatId,text:'Telegram успешно привязан к вашему аккаунту.\n\nТеперь отправьте, например: Проезд 45 рублей\nКоманды: /help и /balance'};
    }
  }else if(/^\/unlink(?:@\w+)?$/i.test(text)){
    const links=rows_('telegram_links').filter(x=>String(x.telegram_user_id)===telegramUserId);
    if(links.length){
      const userIds=new Set(links.map(x=>String(x.user_id)));
      const codes=rows_('telegram_link_codes').filter(x=>userIds.has(String(x.user_id)));
      // Revoke pending codes before removing links, matching the app-side unlink order.
      if(codes.length)deleteRows_('telegram_link_codes',codes);
      deleteRows_('telegram_links',links);
    }
    reply={chat_id:chatId,text:links.length?'Telegram отвязан. Доступ к бюджету через бота закрыт.':'Этот Telegram не был привязан.'};
  }else if(/^\/balance(?:@\w+)?$/i.test(text)){
    const link=rows_('telegram_links').find(x=>String(x.telegram_user_id)===telegramUserId);
    if(!link)throw new Error('Сначала привяжите аккаунт командой /link КОД.');
    const members=rows_('family_members').filter(x=>String(x.user_id)===String(link.user_id)&&String(x.family_id)===String(link.family_id));
    if(!members.length)throw new Error('Привязка больше не действительна. Подключите Telegram заново.');
    const month=Utilities.formatDate(new Date(),'Europe/Moscow','yyyy-MM');
    const txs=rows_('transactions').filter(x=>String(x.family_id)===String(link.family_id)&&String(x.operation_date||'').slice(0,7)===month&&!x.planned);
    const income=txs.filter(x=>x.type==='income').reduce((s,x)=>s+Number(x.amount_kopecks||0),0);
    const expense=txs.filter(x=>x.type==='expense').reduce((s,x)=>s+Number(x.amount_kopecks||0),0);
    const rubles=n=>(n/100).toFixed(2).replace('.',',')+' ₽';
    reply={chat_id:chatId,text:'Семейный бюджет за '+month+':\nДоходы: '+rubles(income)+'\nРасходы: '+rubles(expense)+'\nРазница: '+rubles(income-expense)};
  }else{
    const link=rows_('telegram_links').find(x=>String(x.telegram_user_id)===telegramUserId);
    if(!link)throw new Error('Сначала привяжите аккаунт в приложении и отправьте /link КОД.');
    const member=rows_('family_members').find(x=>String(x.user_id)===String(link.user_id)&&String(x.family_id)===String(link.family_id));
    if(!member)throw new Error('Привязка больше не действительна. Подключите Telegram заново.');
    if(/(?:^|\s)(?:перевод|перевести|перевёл|перевел|перевела|перекинул|перекинула)(?=\s|$)/i.test(text))throw new Error('Переводы через Telegram пока не поддерживаются. Создайте перевод в приложении, указав оба счёта.');
    const amountMatch=text.match(/(?:^|\s)(\d+(?:[.,]\d{1,2})?)(?:\s*(?:₽|руб(?:лей|ля|ль|\.?)?|р\.?))?(?=\s|$)/i);
    if(!amountMatch)throw new Error('Не нашёл сумму. Пример: Проезд 45 рублей.');
    const numericTokens=text.match(/\d+(?:[.,]\d{1,2})?/g)||[];
    if(numericTokens.length!==1)throw new Error('В сообщении несколько чисел. Отправьте одну операцию одним сообщением, например: Проезд 45 рублей.');
    const parts=amountMatch[1].replace(',','.').split('.');
    const amountKopecks=Number(parts[0])*100+Number(((parts[1]||'')+'00').slice(0,2));
    if(!Number.isSafeInteger(amountKopecks)||amountKopecks<=0||amountKopecks>1000000000000)throw new Error('Проверьте сумму операции.');
    let description=text.replace(amountMatch[0],' ').replace(/^(?:добавь|запиши|расход|потратил|потратила|доход|получил|получила)\s+/i,' ').replace(/\s+/g,' ').trim();
    const isIncome=/(?:^|\s)(?:доход|получил|получила|зарплата|поступило|премия|бонус|подработка|фриланс|возврат|компенсация|кэшбек|продал|продажа|проценты)(?=\s|$)/i.test(text);
    const explicitExpense=/(?:^|\s)(?:расход|потратил|потратила|купил|купила|оплатил|оплатила|покупка)(?=\s|$)/i.test(text);
    if(!description&&isIncome)description='Доход';
    if(!description&&explicitExpense)description='Расход';
    if(!description)throw new Error('Добавьте описание. Пример: Проезд 45 рублей.');
    const kind=isIncome?'income':'expense';
    const categories=rows_('categories').filter(x=>String(x.family_id)===String(link.family_id)&&!x.archived&&String(x.kind)===kind);
    const normalizedDescription=String(description).toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    const salaryCategory=member.role==='owner'?'Зарплата первого участника':'Зарплата второго участника';
    // Specific phrases come before broad ones to avoid assigning a more general category.
    const aliases=kind==='income'?[
      [/зарплат|аванс|оклад/i,salaryCategory],
      [/преми|бонус/i,'Премии'],
      [/подработ|фриланс/i,'Подработки'],
      [/возврат|компенсац|кэшбек|cashback/i,'Возвраты и компенсации'],
      [/продал|продажа|авито/i,'Доходы от продажи вещей'],
      [/процент|дивиденд|invest/i,'Проценты и инвестиционный доход']
    ]:[
      [/проезд|автобус|метро|трамва|маршрутк|транспорт/i,'Общественный транспорт'],
      [/такси|yandex go|яндекс такси/i,'Такси'],
      [/бензин|заправ|топлив/i,'Бензин'],
      [/парков/i,'Парковка'],      [/шиномонтаж|то\b|ремонт авто|автосервис/i,'Обслуживание автомобиля'],
      [/пятерочк|магнит|перекресток|лента|ашан|вкусвилл|продукт|супермаркет|магазин продукт/i,'Продукты домой'],
      [/доставк|самокат|деливери|купер/i,'Доставка еды'],
      [/кафе|ресторан|обед|ужин|завтрак/i,'Кафе и рестораны'],
      [/кофе|перекус|булоч/i,'Кофе и перекусы на работе'],
      [/аптек|лекарств|таблетк|медикамент/i,'Лекарства'],
      [/стоматолог|зубн/i,'Стоматология'],
      [/врач|доктор|клиник/i,'Врачи'],
      [/аренд|квартир/i,'Аренда квартиры'],
      [/коммунал|жкх|электричеств|водоснабж/i,'Коммунальные услуги'],
      [/интернет|wi ?fi|вайфай/i,'Интернет'],
      [/мобильн|связ|телефон|тариф/i,'Мобильная связь'],
      [/бытов хим|порош|моющ/i,'Бытовая химия'],
      [/шампун|гигиен|зубн паст/i,'Средства гигиены'],
      [/одежд|обув|куртк|джинс/i,'Одежда и обувь'],
      [/подписк|netflix|кинопоиск|ivi/i,'Подписки'],
      [/игр|steam|playstation|xbox/i,'Игры'],
      [/кино|театр|концерт/i,'Кино и мероприятия'],
      [/подар/i,'Подарки'],
      [/путешеств|отпуск|отел|билет/i,'Путешествия и отдых']
    ];
    let categoryName='';
    for(const pair of aliases){if(pair[0].test(normalizedDescription)){categoryName=pair[1];break;}}
    const normalizeCategoryName=value=>String(value||'').toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    let category=categoryName?categories.find(x=>normalizeCategoryName(x.name)===normalizeCategoryName(categoryName)):null;
    if(!category)category=categories.find(x=>normalizedDescription.includes(normalizeCategoryName(x.name)));
    if(!isIncome&&!explicitExpense&&!categoryName&&!category)throw new Error('Не понял, это расход или доход. Уточните тип: «Расход ...» или «Доход ...».');
    if(!category)category=categories.find(x=>x.name===(kind==='income'?'Прочие доходы':'Неопределённая категория'));
    const accounts=rows_('accounts').filter(x=>String(x.family_id)===String(link.family_id)&&!x.archived);
    const accountId=accounts.length===1?accounts[0].id:null;
    const messageTimestamp=Number(message.date);
    const operationAt=Number.isSafeInteger(messageTimestamp)&&messageTimestamp>0?new Date(messageTimestamp*1000):new Date();
    const operationDate=Utilities.formatDate(operationAt,'Europe/Moscow','yyyy-MM-dd');
    const operationTime=Utilities.formatDate(operationAt,'Europe/Moscow','HH:mm');
    query_({table:'transactions',mode:'insert',returning:true,values:{id:updateId?'telegram_'+updateId:undefined,family_id:link.family_id,type:kind,amount_kopecks:amountKopecks,operation_date:operationDate,operation_time:operationTime,category_id:category?category.id:null,account_id:accountId,responsible_user_id:link.user_id,description:description,planned:false}}, {id:String(link.user_id)});
    const amountText=(amountKopecks/100).toFixed(2).replace('.',',');
    reply={chat_id:chatId,text:'Записал '+(kind==='income'?'доход':'расход')+': '+amountText+' ₽ — '+description+(category?'\nКатегория: '+category.name:'\nКатегория не определена; проверьте её в приложении.')};
  }
  if(updateKey){
    // The update cache is an optimization, not the only idempotency guard:
    // transaction IDs, link replay checks and unlink deletion make side effects safe on retries.
    try{props.setProperty(updateKey,JSON.stringify({expires:Date.now()+TELEGRAM_UPDATE_TTL_MS,reply}));}catch(_){}
  }
  return reply;
}

/* ===== Служебные функции: запускаются вручную в редакторе Apps Script (меню «Выполнить») ===== */
function formatSheet_(sh,name){
  TABLES[name].forEach((col,j)=>{if(TEXT_COLS.indexOf(col)>=0)timedSheetWrite_(()=>sh.getRange(2,j+1,Math.max(sh.getMaxRows()-1,1),1).setNumberFormat('@'));});
}
function formatAuth_(sh){timedSheetWrite_(()=>sh.getRange(2,1,Math.max(sh.getMaxRows()-1,1),6).setNumberFormat('@'));}
// Один раз после установки: применяет текстовый формат к столбцам всех листов.
// Read-only structural check for a backup/restore copy. Does not create, repair or modify sheets.
function auditBackupStructure(){
  const ss=ss_();
  const expected=Object.assign({},TABLES);
  expected[AUTH_SHEET]=['id','email','salt','password_hash','display_name','created_at'];
  const details=Object.keys(expected).map(name=>{
    const headers=expected[name], sh=ss.getSheetByName(name);
    if(!sh)return {name,exists:false,headersMatch:false,hidden:null,dataRows:0};
    const actual=sh.getRange(1,1,1,headers.length).getValues()[0].map(value=>String(value??''));
    return {
      name,
      exists:true,
      headersMatch:actual.join('|')===headers.join('|'),
      hidden:sh.isSheetHidden(),
      dataRows:Math.max(0,sh.getLastRow()-1)
    };
  });
  const missingSheets=details.filter(item=>!item.exists).map(item=>item.name);
  const headerMismatches=details.filter(item=>item.exists&&!item.headersMatch).map(item=>item.name);
  const auth=details.find(item=>item.name===AUTH_SHEET);
  const spreadsheetTimeZone=ss.getSpreadsheetTimeZone();
  const report={
    expectedSheetCount:details.length,
    presentSheetCount:details.length-missingSheets.length,
    missingSheets,
    headerMismatches,
    authHidden:!!(auth&&auth.hidden),
    spreadsheetTimeZone,
    timezoneOk:spreadsheetTimeZone==='Europe/Moscow',
    allChecksPassed:missingSheets.length===0&&headerMismatches.length===0&&!!(auth&&auth.hidden)&&spreadsheetTimeZone==='Europe/Moscow',
    sheets:details
  };
  // Report contains only sheet names, structural status and row counts; never row values or credentials.
  console.log('BACKUP_STRUCTURE_AUDIT '+JSON.stringify(report));
  return report;
}

function setupSheets(){
  // Explicit maintenance always revalidates headers, even when a previous schema cache exists.
  Object.keys(TABLES).forEach(n=>formatSheet_(sheet_(n),n));
  const a=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUTH_SHEET); if(a)formatAuth_(a);
  const tz=SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  Logger.log('Готово: листы подготовлены. Часовой пояс таблицы: '+tz+(tz==='Europe/Moscow'?'':' — рекомендуется Europe/Moscow (Файл → Настройки)'));
}
// Когда вы с женой зарегистрировались — закройте регистрацию. openSignup() открывает обратно.
function closeSignup(){PropertiesService.getScriptProperties().setProperty('SIGNUP_DISABLED','1');Logger.log('Регистрация закрыта');}
function openSignup(){PropertiesService.getScriptProperties().deleteProperty('SIGNUP_DISABLED');Logger.log('Регистрация открыта');}
// Показывает в GET-ответе имя таблицы (для проверки тестовая/рабочая). Выключить: hideInfo().
function showInfo(){PropertiesService.getScriptProperties().setProperty('DEBUG_INFO','1');Logger.log('ok');}
function hideInfo(){PropertiesService.getScriptProperties().deleteProperty('DEBUG_INFO');Logger.log('ok');}
// Замер времени одной проверки пароля (смотрите «Журнал выполнения»).
function benchmarkHash(){const t=Date.now();makePasswordHash_('test-password','salt');const a=Date.now()-t;Logger.log('Новый хеш пароля: '+a+' мс ('+PW_ITERATIONS+' шагов)');const t2=Date.now();hash_('test-password','salt');Logger.log('Прежний хеш пароля: '+(Date.now()-t2)+' мс');}

// Проверка поведения Google Sheets на ВАШЕЙ таблице (создаёт и удаляет временный лист). Смотрите «Журнал выполнения».
function selfTest(){
  const ss=ss_(), name='_selftest_tmp', out=[]; let sh=ss.getSheetByName(name); if(sh)ss.deleteSheet(sh);
  sh=ss.insertSheet(name);
  try{
    sh.getRange(1,1,sh.getMaxRows(),1).setNumberFormat('@');
    sh.getRange(1,1,3,1).setValues([[safeCell_('=1+1')],['14:30'],['2026-10-28']]);
    const f=sh.getRange(1,1).getFormula(), v=sh.getRange(1,1,3,1).getValues().map(r=>r[0]);
    out.push('1. Строка «=1+1» осталась текстом: '+(f===''&&v[0]==='=1+1'?'ДА':'НЕТ ('+f+' / '+v[0]+')'));
    out.push('2. Время «14:30» осталось строкой: '+(v[1]==='14:30'?'ДА':'НЕТ ('+v[1]+')'));
    out.push('3. Дата «2026-10-28» осталась строкой: '+(v[2]==='2026-10-28'?'ДА':'НЕТ ('+v[2]+')'));
    const before=sh.getMaxRows(); sh.insertRowsAfter(before,50);
    out.push('4. Добавленные строки сами получили текстовый формат: '+(sh.getRange(before+1,1).getNumberFormat()==='@'?'ДА':'НЕТ (код всё равно применяет формат заново)'));
    out.push('Часовой пояс таблицы: '+ss.getSpreadsheetTimeZone()+'; скрипта: '+Session.getScriptTimeZone());
  }catch(e){out.push('ОШИБКА теста: '+e.message);}
  finally{ss.deleteSheet(sh);}
  Logger.log(out.join('\n'));
}