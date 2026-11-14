/**
 * One-click orchestrator for the pending isolated TEST GAS runtime probes.
 * Copy this file together with the four referenced probe files into TEST GAS.
 * Every probe creates and cleans its own synthetic fixtures.
 */
function runIsolatedRuntimeAcceptanceBatch() {
  var props=PropertiesService.getScriptProperties();
  var url=String(props.getProperty('CONCURRENT_ROW_TEST_WEB_APP_URL')||'').trim();
  var confirmation=String(props.getProperty('CONCURRENT_ROW_TEST_CONFIRM')||'');
  assertIsolatedGasTestEnvironment_(props,confirmation,url);

  var tests=[
    {name:'Telegram duplicate delivery and retry',run:function(){return runTelegramUpdateConcurrencyTest();}},
    {name:'Optimistic read/write consistency',run:function(){return runReadConsistencyConcurrencyTest();}},
    {name:'Monthly-plan concurrent stale update',run:function(){return runMonthlyPlanConcurrencyTest();}},
    {name:'Two-member transaction insert concurrency',run:function(){return runTransactionConcurrencyTest();}}
  ];
  var results=[];
  var stoppedForCleanup=false;

  tests.forEach(function(test) {
    if(stoppedForCleanup)return;
    resetRuntimeAcceptanceCaches_();
    try {
      var report=test.run();
      var passed=!!report&&report.result==='PASS'&&report.cleanup==='PASS';
      results.push({test:test.name,result:passed?'PASS':'FAIL',report:report||null});
      if(!passed&&report&&report.cleanup==='FAILED')stoppedForCleanup=true;
    } catch(error) {
      var message=String(error&&error.message||error);
      results.push({test:test.name,result:'FAIL',error:message});
      if(/cleanup|очистк/i.test(message))stoppedForCleanup=true;
    } finally {
      resetRuntimeAcceptanceCaches_();
    }
  });

  var passedCount=results.filter(function(item){return item.result==='PASS';}).length;
  var failedCount=results.length-passedCount;
  var output={
    test:'isolated TEST runtime acceptance batch',
    completed:results.length,
    passed:passedCount,
    failed:failedCount,
    stopped_for_cleanup_failure:stoppedForCleanup,
    result:failedCount===0&&results.length===tests.length?'PASS':'FAIL',
    tests:results
  };
  Logger.log(JSON.stringify(output));
  return output;
}


/**
 * Each probe talks to the Web App in a separate Apps Script execution, but
 * cleanup reads the spreadsheet directly in this orchestrator execution.
 * Clear per-execution caches between probes so later cleanup never sees a
 * stale snapshot left by an earlier probe.
 */
function resetRuntimeAcceptanceCaches_() {
  ROWS_CACHE = {};
  TZ_CACHE = null;
  SS_CACHE = null;
  SHEET_SCHEMA_VALIDATED = {};
}
