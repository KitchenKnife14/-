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

function doGet() {
  return json_({status:'ok', message:'Сервер работает', spreadsheet:SpreadsheetApp.getActiveSpreadsheet().getName()});
}
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!req.action) throw new Error('Не указано действие');
    if (req.action === 'signup') return json_(signup_(req));
    if (req.action === 'signin') return json_(signin_(req));
    if (req.action === 'signout') return json_(signout_(req));
    const user = requireUser_(req.token);
    lock.waitLock(20000);
    try {
      return json_({data: route_(req, user), error:null});
    } finally { lock.releaseLock(); }
  } catch (err) {
    try { if (lock.hasLock()) lock.releaseLock(); } catch (_) {}
    return json_({data:null, error:{message:String(err && err.message || err)}});
  }
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function ss_(){ const s=SpreadsheetApp.getActiveSpreadsheet(); if(!s) throw new Error('Скрипт должен быть привязан к таблице бюджета'); return s; }
function sheet_(name) {
  if (!TABLES[name]) throw new Error('Неизвестная таблица: '+name);
  const ss=ss_(); let sh=ss.getSheetByName(name);
  if (!sh) { sh=ss.insertSheet(name); sh.getRange(1,1,1,TABLES[name].length).setValues([TABLES[name]]); sh.setFrozenRows(1); }
  const header=sh.getRange(1,1,1,TABLES[name].length).getValues()[0];
  if (header.join('|') !== TABLES[name].join('|')) throw new Error('Не совпадает структура листа '+name);
  return sh;
}
function rows_(name) {
  const sh=sheet_(name), values=sh.getDataRange().getValues(); if(values.length<2) return [];
  return values.slice(1).filter(r=>r.some(v=>v!=='' && v!==null)).map((r,i)=> {
    const o={}; TABLES[name].forEach((k,j)=>o[k]=normal_(r[j])); o.__row=i+2; return o;
  });
}
function normal_(v) { return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone()||'Europe/Moscow','yyyy-MM-dd') : v; }
function writeRows_(name, data) {
  const sh=sheet_(name), cols=TABLES[name];
  if (data.length) sh.getRange(2,1,data.length,cols.length).setValues(data.map(o=>cols.map(k=>o[k]===undefined||o[k]===null?'':o[k])));
  const last=sh.getLastRow(); if(last>data.length+1) sh.getRange(data.length+2,1,last-data.length-1,cols.length).clearContent();
}
function now_(){return new Date().toISOString();}
function id_(){return Utilities.getUuid();}
function code_(){return Utilities.getUuid().replace(/-/g,'').slice(0,8).toUpperCase();}
function authSheet_(){
  const ss=ss_(); let sh=ss.getSheetByName(AUTH_SHEET);
  if(!sh){sh=ss.insertSheet(AUTH_SHEET);sh.getRange(1,1,1,6).setValues([['id','email','salt','password_hash','display_name','created_at']]);sh.hideSheet();}
  return sh;
}
function authRows_(){const sh=authSheet_(),v=sh.getDataRange().getValues();return v.slice(1).filter(r=>r[0]).map((r,i)=>({id:String(r[0]),email:String(r[1]).toLowerCase(),salt:String(r[2]),hash:String(r[3]),name:String(r[4]),created_at:String(r[5]),row:i+2}));}
function hash_(password,salt){return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,salt+':'+password,Utilities.Charset.UTF_8));}
function signup_(req){
  const email=String(req.email||'').trim().toLowerCase(), password=String(req.password||''), name=String(req.name||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Введите корректный email');
  if(password.length<8) throw new Error('Пароль должен содержать минимум 8 символов');
  if(authRows_().some(u=>u.email===email)) throw new Error('Аккаунт с таким email уже существует');
  const id=id_(), salt=Utilities.getUuid();
  authSheet_().appendRow([id,email,salt,hash_(password,salt),name||email.split('@')[0],now_()]);
  const token=id_()+id_();
  PropertiesService.getScriptProperties().setProperty('session:'+token,JSON.stringify({userId:id,expires:Date.now()+SESSION_TTL*1000}));
  ensureProfile_(id,name||email.split('@')[0]);
  return {data:{token,user:{id,email}},error:null};
}
function signin_(req){
  const email=String(req.email||'').trim().toLowerCase(), password=String(req.password||'');
  const u=authRows_().find(x=>x.email===email);
  if(!u || hash_(password,u.salt)!==u.hash) throw new Error('Неверный email или пароль');
  const token=id_()+id_();
  PropertiesService.getScriptProperties().setProperty('session:'+token,JSON.stringify({userId:u.id,expires:Date.now()+SESSION_TTL*1000}));
  return {data:{token,user:{id:u.id,email:u.email}},error:null};
}
function signout_(req){if(req.token)PropertiesService.getScriptProperties().deleteProperty('session:'+req.token);return {data:true,error:null};}
function requireUser_(token){
  if(!token) throw new Error('Требуется вход');
  const p=PropertiesService.getScriptProperties(), raw=p.getProperty('session:'+token);
  if(!raw) throw new Error('Сессия завершена, войдите снова');
  const s=JSON.parse(raw); if(s.expires<Date.now()){p.deleteProperty('session:'+token);throw new Error('Сессия завершена, войдите снова');}
  const u=authRows_().find(x=>x.id===s.userId); if(!u)throw new Error('Пользователь не найден');
  return {id:u.id,email:u.email,name:u.name};
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
    const f={id:id_(),name,invite_code:code_(),currency:'RUB',created_at:now_(),created_by:user.id};
    const fam=rows_('families');fam.push(f);writeRows_('families',fam);
    const mem=rows_('family_members');mem.push({id:id_(),family_id:f.id,user_id:user.id,role:'owner',joined_at:now_()});writeRows_('family_members',mem);
    seedCategories_(f.id);return f;
  }
  if(req.action==='joinFamily'){
    const code=String(req.invite_code||'').trim().toUpperCase(), f=rows_('families').find(x=>String(x.invite_code).toUpperCase()===code);
    if(!f)throw new Error('Код приглашения не найден');
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
  if(row.family_id!==undefined && row.family_id!=='') return fams.includes(String(row.family_id));
  if(table==='profiles') return String(row.id)===user.id || fams.some(fid=>rows_('family_members').some(m=>m.family_id===fid&&m.user_id===row.id));
  if(table==='families') return String(row.created_by)===user.id || fams.includes(String(row.id));
  if(table==='family_members') return fams.includes(String(row.family_id));
  if(table==='goal_contributions'){const g=rows_('goals').find(g=>g.id===row.goal_id);return !!g&&fams.includes(String(g.family_id));}
  return false;
}
function query_(req,user){
  const table=req.table, mode=req.mode||'select'; if(!TABLES[table])throw new Error('Неизвестная таблица: '+table);
  let all=rows_(table);
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
    const existing=rows_(table);
    const created=input.map(raw=>{
      const r=Object.assign({},raw); if(table==='profiles' && r.id!==user.id)throw new Error('Нельзя изменять чужой профиль');
      if(table==='family_members'){
        const family=rows_('families').find(f=>String(f.id)===String(r.family_id));
        if(!family || String(family.created_by)!==user.id || String(r.user_id)!==user.id || r.role!=='owner')throw new Error('Нельзя добавлять участника напрямую');
        if(rows_('family_members').some(m=>String(m.user_id)===user.id))throw new Error('Пользователь уже состоит в семье');
      } else if(table==='goal_contributions'){
        const goal=rows_('goals').find(g=>String(g.id)===String(r.goal_id));
        if(!goal || !allowedFamilyIds_(user).includes(String(goal.family_id)))throw new Error('Нет доступа к этой цели');
      } else if(table!=='profiles'&&table!=='families'&&(!r.family_id||(!allowedFamilyIds_(user).includes(String(r.family_id)) && !(table==='categories' && rows_('families').some(f=>String(f.id)===String(r.family_id)&&String(f.created_by)===user.id))))) throw new Error('Не указана семья или нет доступа к ней');
      if(!r.id)r.id=id_(); if(!r.created_at && TABLES[table].includes('created_at'))r.created_at=now_();
      if(table==='families'){if(rows_('family_members').some(m=>String(m.user_id)===user.id))throw new Error('Пользователь уже состоит в семье');r.invite_code=r.invite_code||code_();r.currency='RUB';r.created_by=user.id;}
      existing.push(r);return r;
    });
    writeRows_(table,existing);return req.returning?created.map(r=>strip_(r)):null;
  }
  if(mode==='update'||mode==='delete'){
    if(table==='family_members')throw new Error('Изменение состава семьи требует отдельной операции');
    const keep=[],changed=[];
    all.forEach(r=>{
      if(matches(r)&&canAccessRow_(table,r,user)){
        if(mode==='delete')changed.push(r);
        else {const patch=req.values||{};if(patch.id!==undefined&&String(patch.id)!==String(r.id))throw new Error('Нельзя менять ID записи');if(patch.family_id!==undefined&&String(patch.family_id)!==String(r.family_id))throw new Error('Нельзя переносить запись между семьями');if(table==='profiles'&&String(r.id)!==user.id)throw new Error('Нет доступа к профилю');const next=Object.assign({},r,patch);delete next.__row;if(table==='goal_contributions'){const goal=rows_('goals').find(g=>String(g.id)===String(next.goal_id));if(!goal||!allowedFamilyIds_(user).includes(String(goal.family_id)))throw new Error('Нет доступа к этой цели');}keep.push(next);changed.push(next);}
      }else keep.push(r);
    });
    writeRows_(table,keep);return req.returning?changed.map(strip_):null;
  }
  if(mode==='upsert'){
    const input=Array.isArray(req.values)?req.values:[req.values], existing=rows_(table);
    if(table==='family_members'||table==='families')throw new Error('Для этой таблицы upsert запрещён');
    input.forEach(raw=>{
      if(table==='profiles' && String(raw.id)!==user.id)throw new Error('Нельзя изменять чужой профиль');
      if(table==='goal_contributions'){const goal=rows_('goals').find(g=>String(g.id)===String(raw.goal_id));if(!goal||!allowedFamilyIds_(user).includes(String(goal.family_id)))throw new Error('Нет доступа к этой цели');}
      else if(table!=='profiles'&&(!raw.family_id||!allowedFamilyIds_(user).includes(String(raw.family_id))))throw new Error('Нет доступа к этой семье');
      const keys=String(req.onConflict||'id').split(',').map(s=>s.trim());
      const found=existing.find(r=>keys.every(k=>String(r[k]??'')===String(raw[k]??''))&&canAccessRow_(table,r,user));
      if(table==='profiles' && String(raw.id)!==user.id)throw new Error('Нельзя изменять чужой профиль');
      if(found)Object.assign(found,raw);else {const r=Object.assign({id:id_()},raw);if(r.family_id&&!allowedFamilyIds_(user).includes(String(r.family_id)))throw new Error('Нет доступа к этой семье');existing.push(r);}
    });
    writeRows_(table,existing);return null;
  }
  throw new Error('Неизвестный режим запроса');
}
function strip_(r){const o=Object.assign({},r);delete o.__row;return o;}
function seedCategories_(familyId){
  const defaults=[
    ['Жильё и обязательные платежи','expense','🏠','#2563eb'],['Продукты и питание','expense','🛒','#16a34a'],['Быт','expense','🧴','#0891b2'],['Транспорт','expense','🚌','#ea580c'],['Здоровье','expense','🩺','#dc2626'],['Личные расходы','expense','👕','#7c3aed'],['Развлечения','expense','🎮','#db2777'],['Техника','expense','💻','#0f766e'],['Семья и подарки','expense','🎁','#c026d3'],['Финансовые операции','transfer','🔁','#64748b'],['Накопления','expense','🐷','#059669'],['Прочее','expense','📦','#6b7280'],['Доходы','income','💵','#16a34a']
  ];
  const cats=rows_('categories');
  defaults.forEach(d=>cats.push({id:id_(),family_id:familyId,parent_id:null,name:d[0],kind:d[1],icon:d[2],color:d[3],archived:false,sort_order:cats.length,created_at:now_()}));
  writeRows_('categories',cats);
}
function rpc_(req,user){
  const name=req.name, p=req.params||{};
  if(name==='join_family_by_invite'){route_({action:'joinFamily',invite_code:p.p_invite_code},user);return true;}
  if(name==='confirm_recurring_payment'){
    const id=p.p_recurring_id, r=rows_('recurring_payments').find(x=>x.id===id&&canAccessRow_('recurring_payments',x,user));
    if(!r)throw new Error('Регулярный платёж не найден');
    if(r.next_due_date!==p.p_expected_due_date)throw new Error('Дата платежа уже изменилась. Обновите страницу.');
    const txs=rows_('transactions');txs.push({id:id_(),family_id:r.family_id,type:r.type,amount_kopecks:r.amount_kopecks,operation_date:p.p_operation_date,operation_time:null,category_id:r.category_id,account_id:r.account_id,to_account_id:null,description:r.description,created_by:user.id,updated_by:user.id,planned:false,parent_recurring_id:r.id,created_at:now_(),updated_at:now_()});writeRows_('transactions',txs);
    r.next_due_date=nextDate_(r.next_due_date,r.frequency,r.custom_interval_days);writeRows_('recurring_payments',rows_('recurring_payments').map(x=>x.id===r.id?r:x));return true;
  }
  throw new Error('RPC не поддерживается: '+name);
}
function nextDate_(iso,freq,days){const d=new Date(iso+'T12:00:00Z');if(freq==='daily')d.setUTCDate(d.getUTCDate()+1);else if(freq==='weekly')d.setUTCDate(d.getUTCDate()+7);else if(freq==='yearly')d.setUTCFullYear(d.getUTCFullYear()+1);else if(freq==='custom')d.setUTCDate(d.getUTCDate()+Math.max(1,Number(days)||30));else {const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));}return d.toISOString().slice(0,10);}
