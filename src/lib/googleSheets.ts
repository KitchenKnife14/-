type Filter = { column: string; op: string; value?: unknown; values?: unknown[] }
export type GoogleSession = { access_token: string; token_type: 'bearer'; expires_at: number; user: { id: string; email: string } }
const API_URL = import.meta.env.VITE_GOOGLE_APPS_SCRIPT_URL as string | undefined
const SESSION_KEY = 'budget_google_session_v1'
function readSession(): GoogleSession | null { try { const s=JSON.parse(localStorage.getItem(SESSION_KEY)||'null') as GoogleSession|null; if(s&&s.expires_at*1000>Date.now())return s;localStorage.removeItem(SESSION_KEY);if(s)queueMicrotask(()=>notify('SIGNED_OUT',null));return null } catch{return null} }
function saveSession(data:{token:string;user:{id:string;email:string}}|null){if(!data){localStorage.removeItem(SESSION_KEY);return null}const s:GoogleSession={access_token:data.token,token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+1209600,user:{id:data.user.id,email:data.user.email,app_metadata:{},user_metadata:{},aud:'authenticated',created_at:new Date().toISOString()}};localStorage.setItem(SESSION_KEY,JSON.stringify(s));return s}
const AUTH_ERRORS=['Сессия завершена','Требуется вход','Пользователь не найден']
async function rawRequest<T>(payload:Record<string,unknown>):Promise<T>{
  if(!API_URL)throw new Error('Не настроен VITE_GOOGLE_APPS_SCRIPT_URL')
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),45000)
  let result={} as {data?:T;error?:{message:string}}
  try{
    const response=await fetch(API_URL,{method:'POST',redirect:'follow',signal:controller.signal,headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,token:readSession()?.access_token})})
    const text=await response.text()
    try{result=JSON.parse(text)}catch{throw new Error('Сервер вернул неожиданный ответ. Проверьте, что Apps Script опубликован с доступом «Все»')}
  }catch(e){
    if(e instanceof DOMException&&e.name==='AbortError')throw new Error('Сервер не ответил вовремя. Попробуйте ещё раз')
    if(e instanceof TypeError)throw new Error('Не удалось связаться с сервером. Проверьте интернет и адрес Apps Script')
    throw e
  }finally{clearTimeout(timer)}
  if(result.error){
    const message=result.error.message
    if(AUTH_ERRORS.some(m=>message.startsWith(m))&&readSession()){saveSession(null);notify('SIGNED_OUT',null)}
    throw new Error(message)
  }
  return result.data as T
}
type Pending={payload:Record<string,unknown>;resolve:(v:any)=>void;reject:(e:unknown)=>void}
let batchingSupported=true,queue:Pending[]=[],flushTimer:ReturnType<typeof setTimeout>|null=null
const BATCH_DELAY_MS=20,BATCH_MAX=25
function request<T>(payload:Record<string,unknown>):Promise<T>{const action=payload.action;if(!batchingSupported||(action!=='query'&&action!=='rpc'))return rawRequest<T>(payload);return new Promise<T>((resolve,reject)=>{queue.push({payload,resolve,reject});if(queue.length>=BATCH_MAX)void flushQueue();else if(flushTimer===null)flushTimer=setTimeout(()=>void flushQueue(),BATCH_DELAY_MS)})}
async function flushQueue(){if(flushTimer!==null){clearTimeout(flushTimer);flushTimer=null}const items=queue;queue=[];if(!items.length)return;if(items.length===1){rawRequest(items[0].payload).then(items[0].resolve,items[0].reject);return}try{const results=await rawRequest<{data?:unknown;error?:{message:string}|null}[]>({action:'batch',requests:items.map(i=>i.payload)});items.forEach((it,idx)=>{const r=results[idx];if(!r)it.reject(new Error('Сервер вернул неполный ответ'));else if(r.error)it.reject(new Error(r.error.message));else it.resolve(r.data)})}catch(e){if(e instanceof Error&&e.message.startsWith('Неизвестное действие')){batchingSupported=false;items.forEach(it=>rawRequest(it.payload).then(it.resolve,it.reject))}else items.forEach(it=>it.reject(e))}}

class QueryBuilder<T=Record<string,unknown>> implements PromiseLike<{data:T[]|null;error:{message:string}|null}>{
 private mode='select';private filters:Filter[]=[];private values:Record<string,unknown>|Record<string,unknown>[]={};private returning=false;private limitValue?:number;private orderValues:{column:string;ascending:boolean}[]=[];private conflict?:string;private singleMode:'single'|'maybeSingle'|null=null;
 constructor(private table:string){}
 select(_columns='*'){this.returning=true;return this} insert(v:Record<string,unknown>|Record<string,unknown>[]){this.mode='insert';this.values=v;return this} update(v:Record<string,unknown>){this.mode='update';this.values=v;return this} delete(){this.mode='delete';return this} upsert(v:Record<string,unknown>|Record<string,unknown>[],o?:{onConflict?:string}){this.mode='upsert';this.values=v;this.conflict=o?.onConflict;return this}
 eq(column:string,value:unknown){this.filters.push({column,op:'eq',value});return this} neq(column:string,value:unknown){this.filters.push({column,op:'neq',value});return this} gt(column:string,value:unknown){this.filters.push({column,op:'gt',value});return this} gte(column:string,value:unknown){this.filters.push({column,op:'gte',value});return this} lt(column:string,value:unknown){this.filters.push({column,op:'lt',value});return this} lte(column:string,value:unknown){this.filters.push({column,op:'lte',value});return this} in(column:string,values:unknown[]){this.filters.push({column,op:'in',values});return this} is(column:string,value:unknown){this.filters.push({column,op:'is',value});return this}
 order(column:string,o?:{ascending?:boolean}){this.orderValues.push({column,ascending:o?.ascending!==false});return this} limit(n:number){this.limitValue=n;return this} single(){this.singleMode='single';return this.execute() as Promise<{data:T|null;error:{message:string}|null}>} maybeSingle(){this.singleMode='maybeSingle';return this.execute() as Promise<{data:T|null;error:{message:string}|null}>}
 private async execute():Promise<{data:any;error:{message:string}|null}>{try{const d=await request<any>({action:'query',table:this.table,mode:this.mode,filters:this.filters,values:this.values,returning:this.returning,limit:this.limitValue,orders:this.orderValues,onConflict:this.conflict});if(this.singleMode){const a=Array.isArray(d)?d:d==null?[]:[d];if(!a.length&&this.singleMode==='single')throw new Error('Запись не найдена');if(a.length>1)throw new Error('Найдено несколько записей');return{data:a[0]??null,error:null}}return{data:d,error:null}}catch(e){return{data:null,error:new Error(e instanceof Error?e.message:'Ошибка запроса')}}}
 then<A= {data:T[]|null;error:{message:string}|null},B=never>(ok?:((v:{data:T[]|null;error:{message:string}|null})=>A|PromiseLike<A>)|null,bad?:((e:unknown)=>B|PromiseLike<B>)|null):PromiseLike<A|B>{return this.execute().then(ok,bad)}
}
const listeners=new Set<(event:string,session:GoogleSession|null)=>void>();function notify(event:string,s:GoogleSession|null){listeners.forEach(f=>f(event,s))}
export const googleSheets={
 from:(table:string)=>new QueryBuilder<any>(table),
 rpc:async(name:string,params:Record<string,unknown>={})=>{try{return{data:await request({action:'rpc',name,params}),error:null}}catch(e){return{data:null,error:new Error(e instanceof Error?e.message:'Ошибка RPC')}}},
 channel:(_name:string)=>{
  const subs:{table:string;filters:Filter[];callback:()=>void;previous:string}[]=[]
  let timer:ReturnType<typeof setInterval>|null=null
  const subscription={unsubscribe:()=>{if(timer!==null)clearInterval(timer);timer=null}}
  const channel:{on:(event:string,config:unknown,cb:()=>void)=>any;subscribe:()=>{unsubscribe:()=>void};unsubscribe:()=>void}={
    on:(_event:string,config:unknown,cb:()=>void)=>{
      const cfg=config as {table?:string;filter?:string}
      if(cfg.table){
        const match=(cfg.filter||'').match(/^([a-zA-Z0-9_]+)=eq\.(.+)$/)
        subs.push({table:cfg.table,filters:match?[{column:match[1],op:'eq',value:match[2]}]:[],callback:cb,previous:''})
      }
      return channel
    },
    subscribe:()=>{
      let running=false
      const poll=async()=>{
        if(running||!subs.length||!readSession()||document.hidden)return
        running=true
        try{
          await Promise.all(subs.map(async sub=>{
            try{const data=await request<unknown[]>({action:'query',table:sub.table,mode:'select',filters:sub.filters});const signature=JSON.stringify(data);if(sub.previous&&signature!==sub.previous)sub.callback();sub.previous=signature}catch{}
          }))
        }finally{running=false}
      }
      if(timer!==null)clearInterval(timer)
      void poll();timer=setInterval(()=>void poll(),15000);return subscription
    },
    unsubscribe:()=>subscription.unsubscribe()
  }
  return channel
  },
 removeChannel:(channel:unknown)=>{const c=channel as {unsubscribe?:()=>void};c.unsubscribe?.()},
 auth:{
 getSession:async()=>({data:{session:readSession()},error:null}),getUser:async()=>({data:{user:readSession()?.user??null},error:null}),
 signUp:async({email,password,options}:{email:string;password:string;options?:{data?:{display_name?:string}}})=>{try{const d=await request<{token:string;user:{id:string;email:string}}>({action:'signup',email,password,name:options?.data?.display_name});const s=saveSession(d);notify('SIGNED_IN',s);return{data:{user:s?.user??null,session:s},error:null}}catch(e){return{data:{user:null,session:null},error:new Error(e instanceof Error?e.message:'Ошибка регистрации')}}},
 signInWithPassword:async({email,password}:{email:string;password:string})=>{try{const d=await request<{token:string;user:{id:string;email:string}}>({action:'signin',email,password});const s=saveSession(d);notify('SIGNED_IN',s);return{data:{user:s?.user??null,session:s},error:null}}catch(e){return{data:{user:null,session:null},error:new Error(e instanceof Error?e.message:'Ошибка входа')}}},
 signOut:async()=>{try{await request({action:'signout'})}catch{}saveSession(null);notify('SIGNED_OUT',null);return{error:null}},
 onAuthStateChange:(cb:(event:string,session:GoogleSession|null)=>void)=>{const f=(e:string,s:GoogleSession|null)=>cb(e,s|null);listeners.add(f);return{data:{subscription:{unsubscribe:()=>{listeners.delete(f)}}}}}
 }
};