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
  transactions: ['id','family_id','type','amount_kopecks','operation_date','operation_time','category_id','account_id','to_account_id','description','created_by','updated_by','planned','parent_recurring_id','created_at','updated_at'],
  recurring_payments: ['id','family_id','type','amount_kopecks','category_id','account_id','description','start_date','end_date','frequency','custom_interval_days','next_due_date','remind','active','created_by','created_at'],
  budgets: ['id','family_id','category_id','month_date','limit_kopecks','warn_75','warn_90','warn_100'],
  goals: ['id','family_id','name','description','target_kopecks','saved_kopecks','target_date','priority','status','responsible_user_id','created_at'],
  goal_contributions: ['id','goal_id','amount_kopecks','contribution_date','note','created_by','created_at'],
  planned_purchases: ['id','family_id','name','category_id','estimated_kopecks','priority','desired_month','desired_date','url','comment','status','responsible_user_id','goal_id','linked_transaction_id','created_by','created_at'],
  monthly_plans: ['id','family_id','month_date','category_id','type','planned_kopecks','note'],
  notifications: ['id','family_id','user_id','kind','title','body','read','created_at']
};
const AUTH_SHEET = '_auth';
const SESSION_TTL = 60 * 60 * 24 * 14;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const API_VERSION=5, BATCH_MAX=25;
let SS_CACHE=null, SHEET_READS=0, SHEET_WRITES=0; // кэш открытой таблицы и счётчики для замера (на время ОДНОГО запроса)
const DEFAULT_CATEGORIES=[{"name":"Жильё и обязательные платежи","kind":"expense","icon":"🏠","color":"#2563eb","children":[{"name":"Аренда квартиры","icon":"🔑","color":"#2563eb"},{"name":"Ипотека","icon":"🏦","color":"#2563eb"},{"name":"Коммунальные услуги","icon":"💡","color":"#2563eb"},{"name":"Интернет","icon":"🌐","color":"#2563eb"},{"name":"Мобильная связь","icon":"📱","color":"#2563eb"},{"name":"Обслуживание жилья","icon":"🧰","color":"#2563eb"},{"name":"Ремонт","icon":"🛠️","color":"#2563eb"},{"name":"Мебель и предметы интерьера","icon":"🛋️","color":"#2563eb"}]},{"name":"Продукты и питание","kind":"expense","icon":"🛒","color":"#16a34a","children":[{"name":"Продукты домой","icon":"🥦","color":"#16a34a"},{"name":"Кафе и рестораны","icon":"🍽️","color":"#16a34a"},{"name":"Доставка еды","icon":"🛵","color":"#16a34a"},{"name":"Кофе и перекусы на работе","icon":"☕","color":"#16a34a"}]},{"name":"Быт","kind":"expense","icon":"🧴","color":"#0891b2","children":[{"name":"Бытовая химия","icon":"🧼","color":"#0891b2"},{"name":"Средства гигиены","icon":"🪥","color":"#0891b2"},{"name":"Товары для дома","icon":"🏠","color":"#0891b2"},{"name":"Расходные материалы","icon":"📦","color":"#0891b2"},{"name":"Мелкие бытовые покупки","icon":"🧺","color":"#0891b2"}]},{"name":"Транспорт","kind":"expense","icon":"🚌","color":"#ea580c","children":[{"name":"Общественный транспорт","icon":"🚇","color":"#ea580c"},{"name":"Такси","icon":"🚕","color":"#ea580c"},{"name":"Бензин","icon":"⛽","color":"#ea580c"},{"name":"Обслуживание автомобиля","icon":"🚗","color":"#ea580c"},{"name":"Ремонт автомобиля","icon":"🔧","color":"#ea580c"},{"name":"Страхование и документы","icon":"📄","color":"#ea580c"},{"name":"Парковка","icon":"🅿️","color":"#ea580c"}]},{"name":"Здоровье","kind":"expense","icon":"🩺","color":"#dc2626","children":[{"name":"Врачи","icon":"👨‍⚕️","color":"#dc2626"},{"name":"Анализы и обследования","icon":"🧪","color":"#dc2626"},{"name":"Лекарства","icon":"💊","color":"#dc2626"},{"name":"Стоматология","icon":"🦷","color":"#dc2626"},{"name":"Медицинские процедуры","icon":"💉","color":"#dc2626"}]},{"name":"Личные расходы","kind":"expense","icon":"👕","color":"#7c3aed","children":[{"name":"Одежда и обувь","icon":"👕","color":"#7c3aed"},{"name":"Косметика","icon":"💄","color":"#7c3aed"},{"name":"Уход за собой","icon":"💆","color":"#7c3aed"},{"name":"Личные покупки","icon":"🛍️","color":"#7c3aed"}]},{"name":"Развлечения","kind":"expense","icon":"🎮","color":"#db2777","children":[{"name":"Кино и мероприятия","icon":"🎬","color":"#db2777"},{"name":"Игры","icon":"🎮","color":"#db2777"},{"name":"Подписки","icon":"📺","color":"#db2777"},{"name":"Музыка","icon":"🎵","color":"#db2777"},{"name":"Хобби","icon":"🎨","color":"#db2777"},{"name":"Путешествия и отдых","icon":"✈️","color":"#db2777"}]},{"name":"Техника","kind":"expense","icon":"💻","color":"#0f766e","children":[{"name":"Смартфоны","icon":"📱","color":"#0f766e"},{"name":"Компьютеры и комплектующие","icon":"💻","color":"#0f766e"},{"name":"Телевизоры","icon":"📺","color":"#0f766e"},{"name":"Бытовая техника","icon":"🔌","color":"#0f766e"},{"name":"Аудиотехника","icon":"🎧","color":"#0f766e"},{"name":"Аксессуары","icon":"🎮","color":"#0f766e"}]},{"name":"Семья и подарки","kind":"expense","icon":"🎁","color":"#c026d3","children":[{"name":"Подарки","icon":"🎁","color":"#c026d3"},{"name":"Праздники","icon":"🎉","color":"#c026d3"},{"name":"Совместные мероприятия","icon":"🥳","color":"#c026d3"},{"name":"Расходы на родственников","icon":"👨‍👩‍👧","color":"#c026d3"}]},{"name":"Финансовые операции","kind":"transfer","icon":"🔁","color":"#64748b","children":[{"name":"Погашение кредитов","icon":"💳","color":"#64748b"},{"name":"Проценты по кредитам","icon":"📈","color":"#64748b"},{"name":"Комиссии","icon":"💸","color":"#64748b"},{"name":"Банковские услуги","icon":"🏦","color":"#64748b"},{"name":"Переводы между счетами","icon":"🔁","color":"#64748b"}]},{"name":"Накопления","kind":"expense","icon":"🐷","color":"#059669","children":[{"name":"Резервный фонд","icon":"🛟","color":"#059669"},{"name":"Накопления на квартиру","icon":"🏢","color":"#059669"},{"name":"Накопления на автомобиль","icon":"🚙","color":"#059669"},{"name":"Накопления на крупные покупки","icon":"💰","color":"#059669"},{"name":"Другие цели","icon":"🎯","color":"#059669"}]},{"name":"Прочее","kind":"expense","icon":"📦","color":"#6b7280","children":[{"name":"Непредвиденные расходы","icon":"⚠️","color":"#6b7280"},{"name":"Неопределённая категория","icon":"❓","color":"#6b7280"}]},{"name":"Доходы","kind":"income","icon":"💵","color":"#16a34a","children":[{"name":"Зарплата первого участника","icon":"👨","color":"#16a34a"},{"name":"Зарплата второго участника","icon":"👩","color":"#16a34a"},{"name":"Премии","icon":"🌟","color":"#16a34a"},{"name":"Подработки","icon":"🛠️","color":"#16a34a"},{"name":"Возвраты и компенсации","icon":"↩️","color":"#16a34a"},{"name":"Доходы от продажи вещей","icon":"🏷️","color":"#16a34a"},{"name":"Проценты и инвестиционный доход","icon":"📈","color":"#16a34a"},{"name":"Прочие доходы","icon":"➕","color":"#16a34a"}]}];
// Кэш чтения листов на время ОДНОГО запроса (сбрасывается в doPost и после каждой записи).
let ROWS_CACHE = {};
let TZ_CACHE = null;
// Столбцы, которые должны оставаться текстом (иначе Google Sheets превращает даты/время в Date,
// а строки, начинающиеся с "=", в формулы).
const TEXT_COLS = ['created_at','updated_at','joined_at','operation_date','operation_time','start_date','end_date','next_due_date','month_date','target_date','desired_month','desired_date','contribution_date','description','name','note','comment','body','title','url','invite_code','display_name'];

function doGet() {
  const out={status:'ok', message:'Сервер работает', version:API_VERSION};
  // Имя таблицы показываем только если в свойствах скрипта задано DEBUG_INFO=1 (для проверки, что это тестовая таблица).
  if(PropertiesService.getScriptProperties().getProperty('DEBUG_INFO')==='1')out.spreadsheet=SpreadsheetApp.getActiveSpreadsheet().getName();
  return json_(out);
}
function doPost(e) {
  const t0 = Date.now(); let req = null, lockMs = 0, tLocked = t0, lockAcquired = false, lockAttempted = false;
  const lock = LockService.getScriptLock();
  try {
    ROWS_CACHE = {}; TZ_CACHE = null; SS_CACHE = null; SHEET_READS = 0; SHEET_WRITES = 0;
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!req.action) throw new Error('Не указано действие');
    // Serialize authentication too: concurrent signups must not create duplicate emails.
    lockAttempted = true;
    lock.waitLock(20000);
    lockAcquired = true;
    tLocked = Date.now(); lockMs = tLocked - t0;
    try {
      if (req.action === 'signup') return json_({data:signup_(req),error:null});
      if (req.action === 'signin') return json_({data:signin_(req),error:null});
      if (req.action === 'signout') return json_({data:signout_(req),error:null});
      if (req.action === 'batch') return json_({data:batch_(req),error:null});
      const user = requireUser_(req.token);
      return json_({data: route_(req, user), error:null});
    } finally { lock.releaseLock(); }
  } catch (err) {
    if (lockAttempted && !lockAcquired) lockMs = Date.now() - t0;
    try { if (lock.hasLock()) lock.releaseLock(); } catch (_) {}
    return json_({data:null, error:{message:String(err && err.message || err)}});
  } finally {
    // Одна строка в журнале выполнения: только названия действий и числа, без данных пользователей.
    const ended = Date.now();
    try { console.log(JSON.stringify({act:req&&req.action,n:(req&&req.requests)?req.requests.length:undefined,lockMs:lockMs,workMs:lockAcquired?ended-tLocked:null,totalMs:ended-t0,reads:SHEET_READS,writes:SHEET_WRITES})); } catch (_) {}
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
  if (!sh) { sh=ss.insertSheet(name); SHEET_WRITES++; sh.getRange(1,1,1,TABLES[name].length).setValues([TABLES[name]]); sh.setFrozenRows(1); formatSheet_(sh,name); }
  // Заголовки проверяем не на каждый запрос: успешная проверка запоминается на 6 часов (ключ содержит версию API).
  const hdrKey='hdr'+API_VERSION+':'+name; let cache=null; try{cache=CacheService.getScriptCache();}catch(_){}
  if (cache && cache.get(hdrKey)==='1') return sh;
  SHEET_READS++;
  const header=sh.getRange(1,1,1,TABLES[name].length).getValues()[0];
  if (header.join('|') !== TABLES[name].join('|')) throw new Error('Не совпадает структура листа '+name);
  if (cache) { try{cache.put(hdrKey,'1',21600);}catch(_){} }
  return sh;
}
function rows_(name) {
  if(ROWS_CACHE[name]) return ROWS_CACHE[name];
  return ROWS_CACHE[name]=readRows_(name);
}
function readRows_(name) {
  SHEET_READS++;
  const sh=sheet_(name), values=sh.getDataRange().getValues(); if(values.length<2) return [];
  return values.slice(1).map((r,i)=>({values:r,row:i+2})).filter(x=>x.values.some(v=>v!==''&&v!==null)).map(({values:r,row})=>{
    const o={}; TABLES[name].forEach((k,j)=>o[k]=normal_(r[j],k));if((name==='categories'||name==='accounts')&&(o.archived===''||o.archived===null))o.archived=false;o.__row=row;return o;
  });
}
function tz_(){ if(!TZ_CACHE) TZ_CACHE=ss_().getSpreadsheetTimeZone()||'Europe/Moscow'; return TZ_CACHE; }
// Если Google Sheets всё же превратил текст в Date, восстанавливаем осмысленное значение по имени столбца.
function normal_(v,col) {
  if(!(v instanceof Date)) return v;
  if(col==='operation_time') return Utilities.formatDate(v,tz_(),'HH:mm');
  if(/_at$/.test(col||'')) return v.toISOString();
  return Utilities.formatDate(v,tz_(),'yyyy-MM-dd');
}
function safeCell_(value) {
  // setValues treats strings beginning with '=' as formulas even when the cell is formatted as text.
  // A leading apostrophe makes Sheets store the content as literal text.
  return typeof value==='string' && value.startsWith('=') ? "'"+value : value;
}
function appendRows_(name, data) {
  if (!data.length) return;
  const sh=sheet_(name), cols=TABLES[name], start=sh.getLastRow()+1;
  const need=start+data.length-1;
  if(sh.getMaxRows()<need){sh.insertRowsAfter(sh.getMaxRows(),need-sh.getMaxRows()+500);formatSheet_(sh,name);}
  delete ROWS_CACHE[name];
  sh.getRange(start,1,data.length,cols.length).setValues(data.map(o=>cols.map(k=>safeCell_(o[k]===undefined||o[k]===null?'':o[k]))));
  SHEET_WRITES++;
}
function updateRows_(name, data) {
  if (!data.length) return;
  const sh=sheet_(name), cols=TABLES[name];
  const byRow=new Map(data.filter(r=>Number.isInteger(r.__row)).map(r=>[r.__row,r]));
  const sorted=[...byRow.values()].sort((a,b)=>a.__row-b.__row);
  if(!sorted.length)return;
  delete ROWS_CACHE[name];
  let group=[];
  const flush=()=>{
    if(!group.length)return;
    sh.getRange(group[0].__row,1,group.length,cols.length).setValues(group.map(o=>cols.map(k=>safeCell_(o[k]===undefined||o[k]===null?'':o[k]))));
    group=[];
  };
  sorted.forEach(row=>{if(group.length&&row.__row!==group[group.length-1].__row+1)flush();group.push(row);});
  flush();
  SHEET_WRITES++;
}
function deleteRows_(name, data) {
  const rowNumbers=[...new Set(data.map(r=>Number(r.__row)).filter(n=>Number.isInteger(n)&&n>=2))].sort((a,b)=>b-a);
  if(!rowNumbers.length)return;
  const sh=sheet_(name);
  delete ROWS_CACHE[name];
  let i=0;
  while(i<rowNumbers.length){
    const high=rowNumbers[i];let low=high;i++;
    while(i<rowNumbers.length&&rowNumbers[i]===low-1){low=rowNumbers[i];i++;}
    sh.deleteRows(low,high-low+1);
  }
  SHEET_WRITES++;
}
function writeRows_(name, data) {
  SHEET_WRITES++;
  const sh=sheet_(name), cols=TABLES[name];
  delete ROWS_CACHE[name];
  // Лист по умолчанию содержит 1000 строк; без расширения запись большего числа строк падает.
  const need=data.length+1; if(sh.getMaxRows()<need){ sh.insertRowsAfter(sh.getMaxRows(), need-sh.getMaxRows()+500); formatSheet_(sh,name); }
  if (data.length) sh.getRange(2,1,data.length,cols.length).setValues(data.map(o=>cols.map(k=>safeCell_(o[k]===undefined||o[k]===null?'':o[k]))));
  const last=sh.getLastRow(); if(last>data.length+1) sh.getRange(data.length+2,1,last-data.length-1,cols.length).clearContent();
}
function now_(){return new Date().toISOString();}
function id_(){return Utilities.getUuid();}
function code_(){return Utilities.getUuid().replace(/-/g,'').slice(0,12).toUpperCase();}
function authSheet_(){
  const ss=ss_(); let sh=ss.getSheetByName(AUTH_SHEET);
  if(!sh){sh=ss.insertSheet(AUTH_SHEET);SHEET_WRITES++;sh.getRange(1,1,1,6).setValues([['id','email','salt','password_hash','display_name','created_at']]);sh.hideSheet();formatAuth_(sh);}
  return sh;
}
function authRows_(){SHEET_READS++;const sh=authSheet_(),v=sh.getDataRange().getValues();return v.slice(1).filter(r=>r[0]).map((r,i)=>({id:String(r[0]),email:String(r[1]).toLowerCase(),salt:String(r[2]),hash:String(r[3]),name:String(r[4]),created_at:String(r[5]),row:i+2}));}
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
function makePasswordHash_(password,salt){return 'p2$'+PW_ITERATIONS+'$'+pbkdf2Hex_(password,salt,PW_ITERATIONS);}
function isLegacyHash_(stored){return String(stored).indexOf('p2$')!==0;}
function passwordMatches_(password,salt,stored){
  stored=String(stored);
  if(!isLegacyHash_(stored)){
    const parts=stored.split('$'), it=parseInt(parts[1],10);
    if(parts.length!==3||!(it>=1&&it<=1000000))return false;
    return safeEqual_(pbkdf2Hex_(password,salt,it),parts[2]);
  }
  return safeEqual_(hash_(password,salt),stored); // старые аккаунты: медленный прежний способ, при успешном входе хеш обновляется
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
  if(password.length<8) throw new Error('Пароль должен содержать минимум 8 символов');
  if(authRows_().some(u=>u.email===email)) throw new Error('Аккаунт с таким email уже существует');
  const id=id_(), salt=Utilities.getUuid();
  SHEET_WRITES++; authSheet_().appendRow([id,email,salt,makePasswordHash_(password,salt),name||email.split('@')[0],now_()].map(safeCell_));
  const token=id_()+id_();
  PropertiesService.getScriptProperties().setProperty('session:'+token,JSON.stringify({userId:id,expires:Date.now()+SESSION_TTL*1000}));
  try{ensureProfile_(id,name||email.split('@')[0]);}
  catch(err){
    const cleanup=[];
    try{const row=authRows_().find(u=>u.id===id);if(row){SHEET_WRITES++;authSheet_().deleteRow(row.row);}}catch(cleanupErr){cleanup.push('аккаунт: '+(cleanupErr&&cleanupErr.message?cleanupErr.message:String(cleanupErr)));}
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
  const passwordOk=u?passwordMatches_(password,u.salt,u.hash):(pbkdf2Hex_(password,'no-such-user',PW_ITERATIONS),false);
  if(!passwordOk){
    attempt.count++;
    if(attempt.count>=LOGIN_MAX_ATTEMPTS){attempt.blockedUntil=now+LOGIN_WINDOW_MS;attempt.expires=attempt.blockedUntil;}
    props.setProperty(attemptKey,JSON.stringify(attempt));
    throw new Error('Неверный email или пароль');
  }
  props.deleteProperty(attemptKey);
  // Старый аккаунт: после успешного входа заменяем медленный прежний хеш на новый (следующие входы будут быстрыми).
  if(isLegacyHash_(u.hash)){try{SHEET_WRITES++;authSheet_().getRange(u.row,4).setValue(makePasswordHash_(password,u.salt));}catch(_){}}
  const token=id_()+id_();
  props.setProperty('session:'+token,JSON.stringify({userId:u.id,expires:now+SESSION_TTL*1000}));
  return {token,user:{id:u.id,email:u.email}};
}
function signout_(req){if(req.token)PropertiesService.getScriptProperties().deleteProperty('session:'+req.token);return true;}
function requireUser_(token){
  if(!token) throw new Error('Требуется вход');
  const p=PropertiesService.getScriptProperties(), raw=p.getProperty('session:'+token);
  if(!raw) throw new Error('Сессия завершена, войдите снова');
  const s=JSON.parse(raw); if(s.expires<Date.now()){p.deleteProperty('session:'+token);throw new Error('Сессия завершена, войдите снова');}
  const u=authRows_().find(x=>x.id===s.userId); if(!u)throw new Error('Пользователь не найден');
  return {id:u.id,email:u.email,name:u.name};
}
function setProfileName_(userId,name){
 const n=String(name||'').trim();if(!n)return;const list=rows_('profiles'),p=list.find(x=>x.id===userId);
 if(p){if(p.display_name===n)return;p.display_name=n;}else list.push({id:userId,display_name:n,avatar_color:'#2563eb',timezone:'Europe/Moscow',created_at:now_()});writeRows_('profiles',list);
}
function ensureProfile_(userId,name){
  const list=rows_('profiles'); if(list.some(p=>p.id===userId))return;
  list.push({id:userId,display_name:name,avatar_color:'#2563eb',timezone:'Europe/Moscow',created_at:now_()});writeRows_('profiles',list);
}
function route_(req,user){
  if(req.action==='getSession')return {user:{id:user.id,email:user.email}};
  if(req.action==='getUser')return {user:{id:user.id,email:user.email}};
  if(req.action==='ensureProfile'){ensureProfile_(user.id,String(req.display_name||user.name));return true;}
  if(req.action==='createFamily'){
    const name=String(req.name||'Наша семья').trim(); if(!name)throw new Error('Введите название семьи');
    if(rows_('family_members').some(m=>m.user_id===user.id))throw new Error('Пользователь уже состоит в семье');
    setProfileName_(user.id,req.display_name);
    const f={id:id_(),name,invite_code:code_(),currency:'RUB',created_at:now_(),created_by:user.id};
    // Таблицы не поддерживают транзакции: при сбое на любом шаге откатываем уже записанное вручную.
    try{
      const fam=rows_('families');fam.push(f);writeRows_('families',fam);
      const mem=rows_('family_members');mem.push({id:id_(),family_id:f.id,user_id:user.id,role:'owner',joined_at:now_()});writeRows_('family_members',mem);
      seedCategories_(f.id);
    }catch(err){rollbackFamily_(f.id);throw err;}
    return f;
  }
  if(req.action==='joinFamily'){
    const code=String(req.invite_code||'').trim().toUpperCase(), f=rows_('families').find(x=>String(x.invite_code).toUpperCase()===code);
    if(!f)throw new Error('Код приглашения не найден');
    setProfileName_(user.id,req.display_name);
    const members=rows_('family_members').filter(m=>m.family_id===f.id);
    if(members.some(m=>m.user_id===user.id))return f;
    if(members.length>=2)throw new Error('В семье уже два участника');
    if(rows_('family_members').some(m=>m.user_id===user.id))throw new Error('Вы уже состоите в другой семье');
    members.push({id:id_(),family_id:f.id,user_id:user.id,role:'member',joined_at:now_()});const allMembers=rows_('family_members');allMembers.push(members[members.length-1]);writeRows_('family_members',allMembers);
    return f;
  }
  if(req.action==='query')return query_(req,user);
  if(req.action==='rpc')return rpc_(req,user);
  throw new Error('Неизвестное действие: '+req.action);
}
function allowedFamilyIds_(user){return rows_('family_members').filter(m=>m.user_id===user.id).map(m=>String(m.family_id));}
function canAccessRow_(table,row,user){
  const fams=allowedFamilyIds_(user);
  if(table==='notifications'){
    if(!row.family_id || !fams.includes(String(row.family_id)))return false;
    return String(row.user_id||'')===user.id;
  }
  if(row.family_id!==undefined && row.family_id!=='') return fams.includes(String(row.family_id));
  if(table==='profiles') return String(row.id)===user.id || fams.some(fid=>rows_('family_members').some(m=>m.family_id===fid&&m.user_id===row.id));
  if(table==='families') return String(row.created_by)===user.id || fams.includes(String(row.id));
  if(table==='family_members') return fams.includes(String(row.family_id));
  if(table==='goal_contributions'){const g=rows_('goals').find(g=>g.id===row.goal_id);return !!g&&fams.includes(String(g.family_id));}
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
function validateRelations_(table,row,user){
  const familyId=String(row.family_id||'');
  if(table==='goal_contributions'){
    if(!Number.isSafeInteger(Number(row.amount_kopecks))||Number(row.amount_kopecks)<=0)throw new Error('Сумма пополнения должна быть положительным целым числом копеек');
    const goal=rows_('goals').find(x=>String(x.id)===String(row.goal_id));
    if(!goal)throw new Error('Связанная цель не найдена');
    if(!allowedFamilyIds_(user).includes(String(goal.family_id)))throw new Error('Нет доступа к этой цели');
    return;
  }
  if(table==='accounts'){
    const name=String(row.name||'').trim();
    if(!name)throw new Error('Введите название счёта');
    if(!Number.isSafeInteger(Number(row.starting_balance_kopecks||0)))throw new Error('Начальный остаток должен быть целым числом копеек');
    if(!['cash','bank','savings','other'].includes(String(row.kind||'')))throw new Error('Неизвестный тип счёта');
  }
  if(table==='transactions'){
    if(!Number.isSafeInteger(Number(row.amount_kopecks))||Number(row.amount_kopecks)<=0)throw new Error('Сумма операции должна быть положительным целым числом копеек');
    if(!['income','expense','transfer'].includes(String(row.type||'')))throw new Error('Неизвестный тип операции');
    if(row.type==='transfer'&&(!row.account_id||!row.to_account_id))throw new Error('Для перевода нужны счёт списания и счёт зачисления');
    if(row.type!=='transfer'&&row.to_account_id)throw new Error('Счёт зачисления допустим только для перевода');
  }
  if(table==='recurring_payments'){
    if(row.type==='transfer')throw new Error('Регулярные переводы пока не поддерживаются');
    if(!Number.isSafeInteger(Number(row.amount_kopecks))||Number(row.amount_kopecks)<=0)throw new Error('Сумма регулярного платежа должна быть положительным целым числом копеек');
  }
  if(!familyId)return;
  const check=(field,relatedTable,label)=>{
    const value=row[field];if(value===undefined||value===null||value==='')return;
    const related=rows_(relatedTable).find(x=>String(x.id)===String(value));
    if(!related||String(related.family_id)!==familyId)throw new Error(label+' не найдена в этой семье');
  };
  if(table==='categories')check('parent_id','categories','Родительская категория');
  if(table==='transactions'){
    check('category_id','categories','Категория');check('account_id','accounts','Счёт списания');check('to_account_id','accounts','Счёт зачисления');check('parent_recurring_id','recurring_payments','Регулярный платёж');
    if(row.account_id&&row.to_account_id&&String(row.account_id)===String(row.to_account_id))throw new Error('Счета перевода должны различаться');
  }
  if(table==='recurring_payments'){check('category_id','categories','Категория');check('account_id','accounts','Счёт');}
  if(table==='budgets'||table==='monthly_plans')check('category_id','categories','Категория');
  if(table==='planned_purchases'){check('category_id','categories','Категория');check('goal_id','goals','Цель');check('linked_transaction_id','transactions','Связанная операция');}
}
function query_(req,user){
  const table=req.table, mode=req.mode||'select'; if(!TABLES[table])throw new Error('Неизвестная таблица: '+table);
  let all=(mode==='select'||mode==='update'||mode==='delete')?rows_(table):null;
  const filters=req.filters||[];
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
    const needsExisting=table==='budgets'||table==='profiles'||input.some(raw=>raw&&raw.id);
    const existing=needsExisting?rows_(table):[];
    const createdIds_=new Set();
    const created=input.map(raw=>{
      const r=Object.assign({},raw);
      // Server owns identity and audit timestamps.
      if(table==='profiles' && r.id!==undefined && String(r.id)!==user.id)throw new Error('Нельзя изменять чужой профиль');
      if(table==='profiles')r.id=user.id;
      if(r.id && existing.some(x=>String(x.id)===String(r.id)))throw new Error('Запись с таким ID уже существует');
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
      if(table==='goals')r.saved_kopecks=rows_('goal_contributions').filter(c=>String(c.goal_id)===String(r.id)).reduce((sum,c)=>sum+Number(c.amount_kopecks||0),0);
      if(table==='families'){if(rows_('family_members').some(m=>String(m.user_id)===user.id))throw new Error('Пользователь уже состоит в семье');r.invite_code=r.invite_code||code_();r.currency='RUB';r.created_by=user.id;}
      validateRelations_(table,r,user);
      if(table==='budgets')assertUniqueBudget_(existing,r);
      existing.push(r);return r;
    });
    appendRows_(table,created);
    if(table==='goal_contributions')syncGoalTotals_(created.map(r=>r.goal_id));
    return req.returning?created.map(r=>strip_(r)):null;
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
    const changed=[],affectedGoalIds=new Set();
    all.forEach(r=>{
      if(matches(r)&&canAccessRow_(table,r,user)){
        if(table==='goal_contributions')affectedGoalIds.add(String(r.goal_id));
        if(mode==='delete')changed.push(r);
        else {const patch=req.values||{};if(table==='goals'&&Object.prototype.hasOwnProperty.call(patch,'saved_kopecks'))throw new Error('Баланс цели рассчитывается по истории пополнений');if(patch.id!==undefined&&String(patch.id)!==String(r.id))throw new Error('Нельзя менять ID записи');if(patch.family_id!==undefined&&String(patch.family_id)!==String(r.family_id))throw new Error('Нельзя переносить запись между семьями');if(table==='families'&&['id','created_by','invite_code'].some(k=>Object.prototype.hasOwnProperty.call(patch,k)))throw new Error('Системные поля семьи нельзя менять');if(table==='notifications'&&Object.prototype.hasOwnProperty.call(patch,'user_id')&&String(patch.user_id)!==String(r.user_id))throw new Error('Нельзя менять получателя уведомления');if(TABLES[table].includes('created_by')&&Object.prototype.hasOwnProperty.call(patch,'created_by')&&String(patch.created_by)!==String(r.created_by))throw new Error('Нельзя менять автора записи');if(table==='profiles'&&String(r.id)!==user.id)throw new Error('Нет доступа к профилю');const next=Object.assign({},r,patch);if(table==='goal_contributions')affectedGoalIds.add(String(next.goal_id));if(TABLES[table].includes('updated_by'))next.updated_by=user.id;if(TABLES[table].includes('updated_at'))next.updated_at=now_();delete next.__row;if(TABLES[table].includes('created_at')&&Object.prototype.hasOwnProperty.call(patch,'created_at')&&String(patch.created_at)!==String(r.created_at))throw new Error('Нельзя менять дату создания записи');validateRelations_(table,next,user);if(table==='budgets')assertUniqueBudget_(all,next,r.id);if(table==='goal_contributions'){const goal=rows_('goals').find(g=>String(g.id)===String(next.goal_id));if(!goal||!allowedFamilyIds_(user).includes(String(goal.family_id)))throw new Error('Нет доступа к этой цели');}next.__row=r.__row;changed.push(next);}
      }
    });
    if(mode==='delete')deleteRows_(table,changed);else updateRows_(table,changed);
    if(table==='recurring_payments'&&mode==='delete'&&changed.length){
      const deletedIds=new Set(changed.map(payment=>String(payment.id)));
      const transactions=rows_('transactions');let transactionsChanged=false;
      transactions.forEach(tx=>{
        if(tx.parent_recurring_id&&deletedIds.has(String(tx.parent_recurring_id))){
          tx.parent_recurring_id='';
          transactionsChanged=true;
        }
      });
      if(transactionsChanged)writeRows_('transactions',transactions);
    }
    if(table==='transactions'&&mode==='delete'&&changed.length){
      const deletedIds=new Set(changed.map(tx=>String(tx.id)));
      const purchases=rows_('planned_purchases');let purchasesChanged=false;
      purchases.forEach(p=>{
        if(p.linked_transaction_id&&deletedIds.has(String(p.linked_transaction_id))){
          p.linked_transaction_id='';
          if(p.status==='bought')p.status='planned';
          purchasesChanged=true;
        }
      });
      if(purchasesChanged)writeRows_('planned_purchases',purchases);
    }
    if(table==='goals'&&mode==='delete'&&changed.length){
      const deletedIds=new Set(changed.map(g=>String(g.id)));
      writeRows_('goal_contributions',rows_('goal_contributions').filter(c=>!deletedIds.has(String(c.goal_id))));
      const purchases=rows_('planned_purchases');let purchasesChanged=false;
      purchases.forEach(p=>{if(p.goal_id&&deletedIds.has(String(p.goal_id))){p.goal_id='';purchasesChanged=true;}});
      if(purchasesChanged)writeRows_('planned_purchases',purchases);
    }
    if(table==='goal_contributions')syncGoalTotals_([...affectedGoalIds]);
    return req.returning?changed.map(strip_):null;
  }
  if(mode==='upsert'){
    const input=Array.isArray(req.values)?req.values:[req.values], existing=rows_(table);
    if(table==='family_members'||table==='families')throw new Error('Для этой таблицы upsert запрещён');
    const affectedGoalIds=new Set(), updatedRows=[], insertedRows=[];
    input.forEach(raw=>{
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
        if(table==='goal_contributions')affectedGoalIds.add(String(found.goal_id));
        if(raw.id!==undefined&&String(raw.id)!==String(found.id))throw new Error('Нельзя менять ID записи');
        if(raw.family_id!==undefined&&String(raw.family_id)!==String(found.family_id))throw new Error('Нельзя переносить запись между семьями');
        if(TABLES[table].includes('created_by')&&raw.created_by!==undefined&&String(raw.created_by)!==String(found.created_by))throw new Error('Нельзя менять автора записи');
        if(TABLES[table].includes('created_at')&&raw.created_at!==undefined&&String(raw.created_at)!==String(found.created_at))throw new Error('Нельзя менять дату создания записи');
        const next=Object.assign({},found,raw); // Validate with the authenticated user, including goal ownership.
        validateRelations_(table,next,user);if(table==='budgets')assertUniqueBudget_(existing,next,found.id);Object.assign(found,raw);
        if(table==='goal_contributions')affectedGoalIds.add(String(found.goal_id));
        if(TABLES[table].includes('updated_by'))found.updated_by=user.id;
        if(TABLES[table].includes('updated_at'))found.updated_at=now_();
        updatedRows.push(found);
      }else {
        const r=Object.assign({id:id_()},raw);
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
    updateRows_(table,updatedRows);
    appendRows_(table,insertedRows);
    if(table==='goal_contributions')syncGoalTotals_([...affectedGoalIds]);
    return null;
  }
  throw new Error('Неизвестный режим запроса');
}
function rollbackFamily_(familyId){
  const id=String(familyId), failures=[];
  [['categories',r=>String(r.family_id)!==id],['family_members',r=>String(r.family_id)!==id],['families',r=>String(r.id)!==id]]
    .forEach(u=>{try{writeRows_(u[0],rows_(u[0]).filter(u[1]));}catch(err){failures.push(u[0]+': '+(err&&err.message?err.message:String(err)));}});
  if(failures.length)throw new Error('Не удалось полностью отменить создание семьи: '+failures.join('; '));
}
function strip_(r){const o=Object.assign({},r);delete o.__row;return o;}
function seedCategories_(familyId){
 const cats=rows_('categories'),t=now_(),fid=String(familyId),have=cats.filter(c=>String(c.family_id)===fid);
 DEFAULT_CATEGORIES.forEach((p,i)=>{let parent=have.find(c=>!c.parent_id&&c.name===p.name&&c.kind===p.kind);if(!parent){parent={id:id_(),family_id:familyId,parent_id:null,name:p.name,kind:p.kind,icon:p.icon,color:p.color,archived:false,sort_order:i,created_at:t};cats.push(parent);have.push(parent)}(p.children||[]).forEach((c,k)=>{if(have.some(x=>String(x.parent_id)===String(parent.id)&&x.name===c.name))return;const row={id:id_(),family_id:familyId,parent_id:parent.id,name:c.name,kind:p.kind,icon:c.icon,color:c.color,archived:false,sort_order:k,created_at:t};cats.push(row);have.push(row)})});writeRows_('categories',cats);
}
function syncGoalTotals_(goalIds){
  const ids=[...new Set((goalIds||[]).filter(Boolean).map(String))];
  if(!ids.length)return;
  const contributions=rows_('goal_contributions'), goals=rows_('goals');
  const totals=new Map(ids.map(id=>[id,0]));
  contributions.forEach(c=>{const key=String(c.goal_id);if(totals.has(key))totals.set(key,totals.get(key)+Number(c.amount_kopecks||0));});
  const changed=[];
  goals.forEach(g=>{const key=String(g.id);if(totals.has(key)){const next=Number(totals.get(key));if(Number(g.saved_kopecks||0)!==next){g.saved_kopecks=next;changed.push(g);}}});
  if(changed.length)updateRows_('goals',changed);
}
function rpc_(req,user){
  const name=req.name, p=req.params||{};
  if(name==='join_family_by_invite'){route_({action:'joinFamily',invite_code:p.p_invite_code,display_name:p.p_display_name},user);return true;}
  if(name==='create_family')return route_({action:'createFamily',name:p.p_name,display_name:p.p_display_name},user);
  if(name==='get_my_context'){
   const profile=rows_('profiles').find(x=>x.id===user.id),members=rows_('family_members').filter(m=>m.user_id===user.id).map(strip_);
   const family=members.length?rows_('families').find(f=>String(f.id)===String(members[0].family_id)):null;
   return{profile:profile?strip_(profile):null,members,family:family?strip_(family):null};
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
      String(tx.parent_recurring_id||'')!==''
    ))throw new Error('Конфликт ID операции: запись не соответствует планируемой покупке');
    if(purchase.linked_transaction_id && String(purchase.linked_transaction_id)!==transactionId)throw new Error('Покупка уже связана с другой операцией');
    if(!tx){
      tx={id:transactionId,family_id:purchase.family_id,type:'expense',amount_kopecks:purchase.estimated_kopecks,operation_date:p.p_operation_date,operation_time:null,category_id:purchase.category_id||null,account_id:accountId||null,to_account_id:null,description:purchase.name,created_by:user.id,updated_by:user.id,planned:false,parent_recurring_id:null,created_at:now_(),updated_at:now_()};
      appendRows_('transactions',[tx]);
    }
    purchase.status='bought';
    purchase.linked_transaction_id=transactionId;
    writeRows_('planned_purchases',purchases);
    return {transaction_id:transactionId};
  }
  if(name==='confirm_recurring_payment'){
    const id=p.p_recurring_id, r=rows_('recurring_payments').find(x=>x.id===id&&canAccessRow_('recurring_payments',x,user));
    if(!r)throw new Error('Регулярный платёж не найден');
    if(r.next_due_date!==p.p_expected_due_date)throw new Error('Дата платежа уже изменилась. Обновите страницу.');
    if(r.end_date && r.next_due_date>r.end_date){r.active=false;writeRows_('recurring_payments',rows_('recurring_payments').map(x=>x.id===r.id?r:x));return true;}
    const txs=rows_('transactions'), transactionId='recurring_'+r.id+'_'+r.next_due_date;
    // Deterministic ID makes retries safe only when the existing row is the same recurring occurrence.
    const existingTx=txs.find(t=>String(t.id)===transactionId);
    if(existingTx && (
      String(existingTx.family_id)!==String(r.family_id) ||
      String(existingTx.parent_recurring_id||'')!==String(r.id) ||
      String(existingTx.type)!==String(r.type) ||
      Number(existingTx.amount_kopecks)!==Number(r.amount_kopecks) ||
      String(existingTx.category_id||'')!==String(r.category_id||'') ||
      String(existingTx.account_id||'')!==String(r.account_id||'') ||
      String(existingTx.description||'')!==String(r.description||'')
    ))throw new Error('Конфликт ID операции: запись не соответствует регулярному платежу');
    if(!existingTx)appendRows_('transactions',[{id:transactionId,family_id:r.family_id,type:r.type,amount_kopecks:r.amount_kopecks,operation_date:p.p_operation_date,operation_time:null,category_id:r.category_id,account_id:r.account_id,to_account_id:null,description:r.description,created_by:user.id,updated_by:user.id,planned:false,parent_recurring_id:r.id,created_at:now_(),updated_at:now_()}]);
    r.next_due_date=nextDate_(r.next_due_date,r.frequency,r.custom_interval_days,r.start_date);
    if(r.end_date && r.next_due_date>r.end_date)r.active=false;
    writeRows_('recurring_payments',rows_('recurring_payments').map(x=>x.id===r.id?r:x));return true;
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

/* ===== Служебные функции: запускаются вручную в редакторе Apps Script (меню «Выполнить») ===== */
function formatSheet_(sh,name){
  TABLES[name].forEach((col,j)=>{if(TEXT_COLS.indexOf(col)>=0)sh.getRange(2,j+1,Math.max(sh.getMaxRows()-1,1),1).setNumberFormat('@');});
}
function formatAuth_(sh){sh.getRange(2,1,Math.max(sh.getMaxRows()-1,1),6).setNumberFormat('@');}
// Один раз после установки: применяет текстовый формат к столбцам всех листов.
function setupSheets(){
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