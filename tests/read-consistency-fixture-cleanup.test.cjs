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
 let requests=[],calls=0,deleted=[],locked=false,finished=false,markerStarted=false
 const mockSheet=n=>tabs[n]&&({getSheetId:()=>tabs[n].id,getLastRow:()=>tabs[n].data.length,
  getLastColumn:()=>tabs[n].data[0]?.length||0,isSheetHidden:()=>tabs[n].hidden,
  getRange:(r,c,nr,nc)=>({getDisplayValues:()=>Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>String(tabs[n].data[r-1+i]?.[c-1+j]??'')))})})
 const ss={getSpreadsheetTimeZone:()=> 'Europe/Moscow',getId:()=> 'TESTbqT8qQ',getName:()=> 'Семейный бюджет Тестирование',
  getSheetByName:mockSheet,getSheets:()=>Object.keys(tabs).map(mockSheet)}
 const byId=id=>Object.values(tabs).find(s=>s.id===id)
 const context={TABLES,ScriptApp:{getScriptId:()=>options.wrongProject?'WRONG':'TESTKMTZTF',getOAuthToken:()=> 'not-real'},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,getProperties:()=>({...props}),
    deleteProperty:k=>{deleted.push(k);delete props[k]}})},
  assertIsolatedGasTestEnvironment_:()=>ss,SpreadsheetApp:{flush(){},openById:()=>ss},
  LockService:{getScriptLock:()=>({tryLock:()=>{locked=true;return !options.lockBusy},releaseLock:()=>{locked=false}})},
  beginWriteConsistency_:()=>{assert.equal(locked,true);markerStarted=true;return 'stable:new'},
  finishWriteConsistency_:()=>{finished=true},Logger:{log(){}},
  UrlFetchApp:{fetch:(url,req)=>{
    calls++;assert.equal(locked,true);assert.equal(markerStarted,true)
    assert.equal(url,'https://sheets.googleapis.com/v4/spreadsheets/TESTbqT8qQ:batchUpdate')
    requests=JSON.parse(req.payload).requests
    if(options.httpFail)return {getResponseCode:()=>403}
    for(const r of requests){
      if(r.addSheet){const p=r.addSheet.properties;tabs[p.title]={id:p.sheetId,data:[],hidden:p.hidden}}
      if(r.copyPaste){const {source:s,destination:d}=r.copyPaste;const from=byId(s.sheetId),to=byId(d.sheetId)
        for(let i=0;i<s.endRowIndex-s.startRowIndex;i++){
          to.data[d.startRowIndex+i] ||= []
          for(let j=s.startColumnIndex;j<s.endColumnIndex;j++)to.data[d.startRowIndex+i][d.startColumnIndex+j-s.startColumnIndex]=from.data[s.startRowIndex+i][j]
        }}
      if(r.updateCells){const {start,rows}=r.updateCells;const to=byId(start.sheetId)
        rows.forEach((r,i)=>r.values.forEach((v,j)=>{to.data[start.rowIndex+i][start.columnIndex+j]=String(v.userEnteredValue.stringValue??v.userEnteredValue.numberValue)}))}
      if(r.deleteDimension){const x=r.deleteDimension.range;byId(x.sheetId).data.splice(x.startIndex,x.endIndex-x.startIndex)}
    }
    return {getResponseCode:()=>200}
  }}}
 vm.createContext(context);vm.runInContext(code,context)
 return {context,tabs,props,stats:()=>({calls,requests,deleted,locked,finished})}
}
test('atomic TEST recovery quarantines 93 rows and revokes only the abandoned session',()=>{
 const x=setup(),out=x.context.cleanupCancelledReadConsistencyFixture()
 assert.equal(out.status,'PASS');assert.equal(out.removedRows,93);assert.equal(out.verifiedApplicationSheets,16)
 assert.equal(x.tabs.categories.data.length,2);assert.equal(x.tabs.categories.data[1][0],'old-category')
 assert.equal(x.tabs._auth.data[1][0],'old');assert.equal(x.tabs._m04_fixture_backup_20261124.data.length,93)
 assert.equal(x.tabs._m04_fixture_backup_20261124.hidden,true)
 assert.equal(x.stats().calls,1);assert.deepEqual(x.stats().deleted,['session:0']);assert.equal(x.stats().finished,true)
 assert.equal(Object.keys(x.props).filter(k=>k.startsWith('session:')).length,6)
 assert.equal(x.stats().requests.filter(r=>r.deleteDimension).length,7)
 assert.throws(()=>x.context.cleanupCancelledReadConsistencyFixture(),/STOP/)
 assert.equal(x.stats().calls,1)
})
test('recovery stops before mutation when fixture, references, sessions or target differ',()=>{
 for(const options of [{extraRef:true},{badCategory:true},{extraSession:true},{wrongProject:true}]){
   const x=setup(options);assert.throws(()=>x.context.cleanupCancelledReadConsistencyFixture(),/STOP/)
   assert.equal(x.stats().calls,0);assert.deepEqual(x.stats().deleted,[]);assert.equal(x.stats().locked,false)
 }
})
test('API refusal does not revoke sessions or fall back to partial deletion',()=>{
 const x=setup({httpFail:true});assert.throws(()=>x.context.cleanupCancelledReadConsistencyFixture(),/HTTP 403/)
 assert.equal(x.stats().calls,1);assert.deepEqual(x.stats().deleted,[]);assert.equal(x.tabs.categories.data.length,89)
 assert.equal(x.stats().finished,true);assert.equal(x.stats().locked,false)
})
