import type { Session, User } from '@supabase/supabase-js'
type Filter = { column: string; op: string; value?: unknown; values?: unknown[] }
type LocalSession = { access_token: string; token_type: 'bearer'; expires_at: number; user: User }
const API_URL = import.meta.env.VITE_GOOGLE_APPS_SCRIPT_URL as string | undefined
const SESSION_KEY = 'budget_google_session_v1'
function readSession(): LocalSession | null { try { const s=JSON.parse(localStorage.getItem(SESSION_KEY)||'null') as LocalSession|null; if(s&&s.expires_at*1000>Date.now())return s;localStorage.removeItem(SESSION_KEY);return null } catch{return null} }
function saveSession(data:{token:string;user:{id:string;email:string}}|null){if(!data){localStorage.removeItem(SESSION_KEY);return null}const s:LocalSession={access_token:data.token,token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+1209600,user:{id:data.user.id,email:data.user.email,app_metadata:{},user_metadata:{},aud:'authenticated',created_at:new Date().toISOString()} as User};localStorage.setItem(SESSION_KEY,JSON.stringify(s));return s}
async function request<T>(payload:Record<string,unknown>):Promise<T>{if(!API_URL)throw new Error('Не настроен VITE_GOOGLE_APPS_SCRIPT_URL');const response=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,token:readSession()?.access_token})});const result=await response.json() as {data?:T;error?:{message:string}};if(result.error)throw new Error(result.error.message);return result.data as T}
class QueryBuilder<T=Record<string,unknown>> implements PromiseLike<{data:T[]|null;error:{message:string}|null}>{
 private mode='select';private filters:Filter[]=[];private values:Record<string,unknown>|Record<string,unknown>[]={};private returning=false;private limitValue?:number;private orderValue?:{column:string;ascending:boolean};private conflict?:string;private singleMode:'single'|'maybeSingle'|null=null;
 constructor(private table:string){}
 select(_columns='*'){this.returning=true;return this} insert(v:Record<string,unknown>|Record<string,unknown>[]){this.mode='insert';this.values=v;return this} update(v:Record<string,unknown>){this.mode='update';this.values=v;return this} delete(){this.mode='delete';return this} upsert(v:Record<string,unknown>|Record<string,unknown>[],o?:{onConflict?:string}){this.mode='upsert';this.values=v;this.conflict=o?.onConflict;return this}
 eq(column:string,value:unknown){this.filters.push({column,op:'eq',value});return this} neq(column:string,value:unknown){this.filters.push({column,op:'neq',value});return this} gt(column:string,value:unknown){this.filters.push({column,op:'gt',value});return this} gte(column:string,value:unknown){this.filters.push({column,op:'gte',value});return this} lt(column:string,value:unknown){this.filters.push({column,op:'lt',value});return this} lte(column:string,value:unknown){this.filters.push({column,op:'lte',value});return this} in(column:string,values:unknown[]){this.filters.push({column,op:'in',values});return this} is(column:string,value:unknown){this.filters.push({column,op:'is',value});return this}
 order(column:string,o?:{ascending?:boolean}){this.orderValue={column,ascending:o?.ascending!==false};return this} limit(n:number){this.limitValue=n;return this} single(){this.singleMode='single';return this.execute() as Promise<{data:T|null;error:{message:string}|null}>} maybeSingle(){this.singleMode='maybeSingle';return this.execute() as Promise<{data:T|null;error:{message:string}|null}>}
 private async execute():Promise<{data:any;error:{message:string}|null}>{try{const d=await request<any>({action:'query',table:this.table,mode:this.mode,filters:this.filters,values:this.values,returning:this.returning,limit:this.limitValue,order:this.orderValue,onConflict:this.conflict});if(this.singleMode){const a=Array.isArray(d)?d:d==null?[]:[d];if(!a.length&&this.singleMode==='single')throw new Error('Запись не найдена');if(a.length>1)throw new Error('Найдено несколько записей');return{data:a[0]??null,error:null}}return{data:d,error:null}}catch(e){return{data:null,error:{message:e instanceof Error?e.message:'Ошибка запроса'}}}}
 then<A= {data:T[]|null;error:{message:string}|null},B=never>(ok?:((v:{data:T[]|null;error:{message:string}|null})=>A|PromiseLike<A>)|null,bad?:((e:unknown)=>B|PromiseLike<B>)|null):PromiseLike<A|B>{return this.execute().then(ok,bad)}
}
const listeners=new Set<(event:string,session:LocalSession|null)=>void>();function notify(event:string,s:LocalSession|null){listeners.forEach(f=>f(event,s))}
export const supabase={
 from:(table:string)=>new QueryBuilder(table),
 rpc:async(name:string,params:Record<string,unknown>={})=>{try{return{data:await request({action:'rpc',name,params}),error:null}}catch(e){return{data:null,error:{message:e instanceof Error?e.message:'Ошибка RPC'}}}},
 channel:(_name:string)=>{
  let table=''; let filters:Filter[]=[]; let callback:(()=>void)|null=null; let timer:ReturnType<typeof setInterval>|null=null; let previous='';
  const subscription={unsubscribe:()=>{if(timer!==null)clearInterval(timer);timer=null}};
  const channel: {on:(event:string,config:unknown,cb:()=>void)=>any;subscribe:()=>{unsubscribe:()=>void}}={on:(_event:string,config:unknown,cb:()=>void)=>{
    const cfg=config as {table?:string;filter?:string};table=cfg.table||'';callback=cb;
    const match=(cfg.filter||'').match(/^([a-zA-Z0-9_]+)=eq\\.(.+)$/);
    filters=match?[{column:match[1],op:'eq',value:match[2]}]:[];
    return channel;
  },subscribe:()=>{
    const poll=async()=>{if(!table||!callback||!readSession())return;try{const data=await request<unknown[]>({action:'query',table,mode:'select',filters});const signature=JSON.stringify(data);if(previous&&signature!==previous)callback();previous=signature}catch{}};
    void poll();timer=setInterval(()=>void poll(),15000);return subscription;
  }};
  return channel;
  },
  removeChannel:(channel:unknown)=>{const c=channel as {unsubscribe?:()=>void};c.unsubscribe?.()},
 auth:{
 getSession:async()=>({data:{session:readSession() as unknown as Session|null},error:null}),getUser:async()=>({data:{user:readSession()?.user??null},error:null}),
 signUp:async({email,password,options}:{email:string;password:string;options?:{data?:{display_name?:string}}})=>{try{const d=await request<{token:string;user:{id:string;email:string}}>({action:'signup',email,password,name:options?.data?.display_name});const s=saveSession(d);notify('SIGNED_IN',s);return{data:{user:s?.user??null,session:s as unknown as Session},error:null}}catch(e){return{data:{user:null,session:null},error:{message:e instanceof Error?e.message:'Ошибка регистрации'}}}},
 signInWithPassword:async({email,password}:{email:string;password:string})=>{try{const d=await request<{token:string;user:{id:string;email:string}}>({action:'signin',email,password});const s=saveSession(d);notify('SIGNED_IN',s);return{data:{user:s?.user??null,session:s as unknown as Session},error:null}}catch(e){return{data:{user:null,session:null},error:{message:e instanceof Error?e.message:'Ошибка входа'}}}},
 signOut:async()=>{try{await request({action:'signout'})}catch{}saveSession(null);notify('SIGNED_OUT',null);return{error:null}},
 onAuthStateChange:(cb:(event:string,session:Session|null)=>void)=>{const f=(e:string,s:LocalSession|null)=>cb(e,s as unknown as Session|null);listeners.add(f);return{data:{subscription:{unsubscribe:()=>listeners.delete(f)}}}}
 }
};
