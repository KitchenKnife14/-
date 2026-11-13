/**
 * Shared fail-closed guard for live concurrency probes.
 * Set these two properties once in the isolated TEST Apps Script project:
 * GAS_TEST_ALLOWED_SCRIPT_ID=<ScriptApp.getScriptId()>
 * GAS_TEST_ALLOWED_SPREADSHEET_ID=<test spreadsheet ID>
 */
function assertIsolatedGasTestEnvironment_(props, confirmation, webAppUrl) {
  if (String(confirmation || '') !== 'ISOLATED_TEST_ONLY') {
    throw new Error('Тест остановлен: требуется подтверждение ISOLATED_TEST_ONLY.');
  }
  var scriptId = ScriptApp.getScriptId();
  var allowedScriptId = String(props.getProperty('GAS_TEST_ALLOWED_SCRIPT_ID') || '').trim();
  if (!allowedScriptId || scriptId !== allowedScriptId) {
    throw new Error('Тест остановлен: Script ID не совпадает с разрешённым TEST-проектом.');
  }
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var allowedSpreadsheetId = String(props.getProperty('GAS_TEST_ALLOWED_SPREADSHEET_ID') || '').trim();
  if (!spreadsheet || !/test|тест/i.test(spreadsheet.getName()) ||
      !allowedSpreadsheetId || spreadsheet.getId() !== allowedSpreadsheetId) {
    throw new Error('Тест остановлен: активная таблица не совпадает с разрешённой TEST-таблицей.');
  }
  var match = String(webAppUrl || '').trim().match(/^https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec$/);
  var productionDeploymentId = 'AKfycbxQLSZXG-R_AGZG5clVDGnMqd4_cwvwsPsf3_9mJ79Rnas7CZVeuIhtSi7FM5MMagkqqg';
  if (!match || match[1] === productionDeploymentId) {
    throw new Error('Тест остановлен: нужен отдельный TEST Web App deployment URL.');
  }
  return spreadsheet;
}
