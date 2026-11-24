const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const code = fs.readFileSync('tests/gas/ReadConsistencyFixtureCleanup.gs','utf8')
const backend = fs.readFileSync('google-apps-script/Code.gs','utf8')
const TABLES = vm.runInNewContext('('+backend.match(/const TABLES = (\{[\s\S]*?\n\});/)[1]+')')
const schema = {_auth:['id','email','salt','password_hash','display_name','created_at'],...TABLES}
function setup(options={}) {
 const suffix='ab'.repeat(16), uid='fixture-user', fid='fixture-family'
 const date='2026-11-24T05:52:47Z'
 const tabs = Object.fromEntries(Object.entries(schema).map(([n,h],i)=>[n,{id:i+1,data:[Array.from(h)],hidden:n==='_auth'}]))
 function row(n,fields){tabs[n].data.push(schema[n].map(k=>String(fields[k]??'')))}
 row('_auth',{id:'old',email:'monthly-plan-a+old@example.test',created_at:'2026-11-15'})
 row('_auth',{id:uid,email:'read-consistency+'+suffix+'@example.test',created_at:date})
 row('profiles',{id:'old'});row('profiles',{id:uid})
 row('families',{id:'old-family',name:'TEST monthly plan old',created_at:'2026-11-15',created_by:'old'})
 row('families',{id:fid,name:'TEST read consistency '+suffix,created_at:date,created_by:uid})
 row('family_members',{id:'member-old',family_id:'old-family',user_id:'old'})
 row('family_members',{id:'member-new',family_id:fid,user_id:uid})
 row('categories',{id:'old-category',family_id:'old-family',created_at:'2026-11-15'})
 for(let i=0;i<87;i++)row('categories',{id:'category-'+i,family_id:fid,created_at:date})
 row('planned_purchases',{id:'readcheck_'+suffix,family_id:fid,created_by:uid})
 row('transactions',{id:'purchase_readcheck_'+suffix,family_id:fid,created_by:uid})
 if(options.extraRef)row('goal_contributions',{id:'unrelated',created_by:uid})
 if(options.badCategory)tabs.categories.data[20][1]='other-family'
 const props={'CONCURRENT_ROW_TEST_CONFIRM':'ISOLATED_TEST_ONLY','CONCURRENT_ROW_TEST_WEB_APP_URL':'https://script.google.com/macros/s/TESTWsbCe/exec'}
 for(let i=0;i<7;i++)props['session:'+i]=JSON.stringify({userId:i===0?uid:'other-'+i})
 if(options.extraSession)props['session:extra']=JSON.stringify({userId:'other'})
 let deletions=[],deleted=[],locked=false,finished=false,markerStarted=false,backupCreates=0
 function range(n,r,c,nr,nc){
   return {
     getDisplayValues:()=>Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>String(tabs[n].data[r-1+i]?.[c-1+j]??''))),
     getFormulas:()=>Array.from({length:nr},()=>Array(nc).fill(options.formula?'=1':'') ),
     setValues:values=>{
       assert.equal(locked,true);assert.equal(markerStarted,true)
       values.forEach((row,i)=>row.forEach((value,j)=>{
         tabs[n].data[r-1+i] ||= []
         tabs[n].data[r-1+i][c-1+j]=String(value)
       }))
     },
     copyTo:dest=>{
       if(options.backupFail)throw Error('simulated backup failure')
       dest.setValues(range(n,r,c,nr,nc).getDisplayValues())
     }
   }
 }
 const mockSheet=n=>tabs[n]&&({getSheetId:()=>tabs[n].id,getLastRow:()=>tabs[n].data.length,
   getLastColumn:()=>tabs[n].data[0]?.length||0,isSheetHidden:()=>tabs[n].hidden,
   hideSheet:()=>{tabs[n].hidden=true},getRange:(...a)=>range(n,...a),
   deleteRows:(start,count)=>{
     assert.equal(locked,true);assert.equal(markerStarted,true)
     assert.equal(tabs._m04_fixture_backup_20261124.data.length,93)
     if(options.deleteFail&&deletions.length===1)throw Error('simulated deletion failure')
     deletions.push({n,start,count});tabs[n].data.splice(start-1,count)
   }})
 const ss={getSpreadsheetTimeZone:()=> 'Europe/Moscow',getId:()=> 'TESTbqT8qQ',getName:()=> 'Семейный бюджет Тестирование',
  getSheetByName:mockSheet,insertSheet:n=>{
    assert.equal(locked,true);assert.equal(markerStarted,true);backupCreates++
    tabs[n]={id:1000,data:[],hidden:false};return mockSheet(n)
  }}
 const context={TABLES,ScriptApp:{getScriptId:()=>options.wrongProject?'WRONG':'TESTKMTZTF'},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,getProperties:()=>({...props}),
    deleteProperty:k=>{deleted.push(k);delete props[k]}})},
  assertIsolatedGasTestEnvironment_:()=>ss,SpreadsheetApp:{flush(){}},
  LockService:{getScriptLock:()=>({tryLock:()=>{if(options.lockBusy)return false;locked=true;return true},releaseLock:()=>{locked=false}})},
  beginWriteConsistency_:()=>{assert.equal(locked,true);markerStarted=true;return 'stable:new'},
  finishWriteConsistency_:()=>{finished=true},Logger:{log(){}}
 }
 vm.createContext(context);vm.runInContext(code,context)
 return {context,tabs,props,stats:()=>({backupCreates,deletions,deleted,locked,finished})}
}
test('native TEST recovery verifies backup first, removes 93 rows and only one session',()=>{
 const x=setup(),out=x.context.cleanupCancelledReadConsistencyFixtureNative()
 assert.equal(out.status,'PASS');assert.equal(out.mode,'NATIVE_SPREADSHEET_APP');assert.equal(out.removedRows,93);assert.equal(out.verifiedApplicationSheets,16)
 assert.equal(x.tabs.categories.data.length,2);assert.equal(x.tabs.categories.data[1][0],'old-category')
 assert.equal(x.tabs._auth.data[1][0],'old');assert.equal(x.tabs._m04_fixture_backup_20261124.data.length,93)
 assert.equal(x.tabs._m04_fixture_backup_20261124.hidden,true)
 assert.equal(x.stats().backupCreates,1);assert.deepEqual(x.stats().deleted,['session:0']);assert.equal(x.stats().finished,true)
 assert.equal(Object.keys(x.props).filter(k=>k.startsWith('session:')).length,6)
 assert.equal(x.stats().deletions.length,7)
 assert.equal(x.stats().deletions.reduce((n,r)=>n+r.count,0),93)
 assert.throws(()=>x.context.cleanupCancelledReadConsistencyFixtureNative(),/STOP/)
 assert.equal(x.stats().backupCreates,1)
})
test('native recovery stops before mutation when fixture, references, sessions, formula or target differ',()=>{
 for(const options of [{extraRef:true},{badCategory:true},{extraSession:true},{wrongProject:true},{formula:true}]){
   const x=setup(options);assert.throws(()=>x.context.cleanupCancelledReadConsistencyFixtureNative(),/STOP/)
   assert.equal(x.stats().backupCreates,0);assert.deepEqual(x.stats().deletions,[]);assert.deepEqual(x.stats().deleted,[]);assert.equal(x.stats().locked,false)
 }
})
test('native backup failure prevents all deletion and session revocation',()=>{
 const x=setup({backupFail:true});assert.throws(()=>x.context.cleanupCancelledReadConsistencyFixtureNative(),/backup failure/)
 assert.equal(x.stats().backupCreates,1);assert.deepEqual(x.stats().deletions,[]);assert.deepEqual(x.stats().deleted,[]);assert.equal(x.tabs.categories.data.length,89)
 assert.equal(x.stats().finished,true);assert.equal(x.stats().locked,false)
})
test('partial native deletion preserves complete backup and does not revoke session',()=>{
 const x=setup({deleteFail:true});assert.throws(()=>x.context.cleanupCancelledReadConsistencyFixtureNative(),/deletion failure/)
 assert.equal(x.stats().deletions.length,1);assert.equal(x.tabs._m04_fixture_backup_20261124.data.length,93)
 assert.deepEqual(x.stats().deleted,[]);assert.throws(()=>x.context.cleanupCancelledReadConsistencyFixtureNative(),/STOP/)
 assert.equal(x.stats().deletions.length,1);assert.equal(x.stats().backupCreates,1)
})
