const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

test('read-consistency recovery audit is fail-closed, read-only, and reports 93 synthetic rows only', () => {
  const source = fs.readFileSync('tests/gas/ReadConsistencyFixtureRecoveryAudit.gs', 'utf8')
  assert.match(source, /assertIsolatedGasTestEnvironment_/)
  assert.match(source, /CONCURRENT_ROW_TEST_CONFIRM/)
  assert.match(source, /TEST fixture audit/)
  assert.doesNotMatch(source, /(?:^|[^\w])(?:setValues|setValue|deleteRows|deleteRow|deleteProperty|setProperty|clearContent|appendRow|insertRow|remove[A-Z]\w*)\s*\(/)
  const suffix = 'ab'.repeat(16)
  const userId = 'SYNTHETIC-UID'
  const familyId = 'SYNTHETIC-FAMILY'
  const headers = { _auth:6, profiles:5, families:6, family_members:5, categories:10,
    accounts:8, transactions:17, recurring_payments:17, budgets:8, goals:11,
    planned_purchases:16, monthly_plans:7, notifications:8, telegram_links:6, telegram_link_codes:7 }
  const tabs = Object.fromEntries(Object.entries(headers).map(([name,n]) => [name, [['hdr'],...[]]]))
  function put(table, row, col, value) {
    tabs[table][row] ||= Array(headers[table]).fill('')
    tabs[table][row][col-1] = value
  }
  // Use a fixed 1-based spreadsheet row; array index == spreadsheet row - 1.
  put('_auth',2,1,userId); put('_auth',2,2,'read-consistency+'+suffix+'@example.test'); put('_auth',2,6,'2026-11-24T05:52:43Z')
  put('profiles',2,1,userId)
  put('families',2,1,familyId); put('families',2,2,'TEST read consistency '+suffix)
  put('families',2,5,'2026-11-24T05:52:47Z'); put('families',2,6,userId)
  put('family_members',2,2,familyId); put('family_members',2,3,userId)
  put('planned_purchases',2,1,'readcheck_'+suffix);put('planned_purchases',2,2,familyId)
  put('transactions',2,1,'purchase_readcheck_'+suffix);put('transactions',2,2,familyId)
  for (let row=2;row<=88;row++){put('categories',row,2,familyId);put('categories',row,10,'2026-11-24T05:52:47Z')}
  const sheet = {getSpreadsheetTimeZone:()=> 'Europe/Moscow',
    getSheetByName:name => tabs[name] && ({getLastRow:()=>tabs[name].length,
      getRange:(row,col,count)=>({getDisplayValues:()=>Array.from({length:count},(_,i)=>[String(tabs[name][row+i]?.[col-1]||'')])})})}
  const properties={'CONCURRENT_ROW_TEST_CONFIRM':'ISOLATED_TEST_ONLY',
    'CONCURRENT_ROW_TEST_WEB_APP_URL':'https://script.google.com/macros/s/TEST/exec',
    'session:one':JSON.stringify({userId}),
    'session:other':JSON.stringify({userId:'DIFFERENT'})}
  const context = {PropertiesService:{getScriptProperties:()=>({
    getProperty:k=>properties[k]??null,getProperties:()=>properties
  })},assertIsolatedGasTestEnvironment_:()=>sheet,Logger:{log:()=>{}}}
  vm.createContext(context);vm.runInContext(source,context)
  const output=context.auditCancelledReadConsistencyFixture()
  assert.equal(output.status,'READY_FOR_SEPARATE_CLEANUP')
  assert.equal(output.totalFixtureRows,93)
  assert.equal(output.found.categories,87)
  assert.equal(output.abandonedUserSessionCount,1)
  assert.equal(output.scriptPropertiesSessionCount,2)
  assert.equal(output.unreadableSessionCount,0)
  tabs.categories[50][1]='DIFFERENT-FAMILY'
  assert.throws(()=>context.auditCancelledReadConsistencyFixture(),/seeded category count/)
})
