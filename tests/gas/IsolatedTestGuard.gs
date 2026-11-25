/**
 * Shared fail-closed guard for live concurrency probes.
 * The existing Script Properties must agree with the approved TEST project:
 * BACKEND_DIAGNOSTICS_ALLOWED_SCRIPT_ID=<ScriptApp.getScriptId()>
 * GAS_TEST_ALLOWED_SPREADSHEET_ID=<test spreadsheet ID>
 */
function assertIsolatedGasTestEnvironment_(props, confirmation, webAppUrl) {
  if (String(confirmation || '') !== 'ISOLATED_TEST_ONLY') {
    throw new Error('Тест остановлен: требуется подтверждение ISOLATED_TEST_ONLY.');
  }
  var scriptId = ScriptApp.getScriptId();
  var allowedScriptId = String(props.getProperty('BACKEND_DIAGNOSTICS_ALLOWED_SCRIPT_ID') || '').trim();
  var testScriptId = '1lTzvWps76sbMFYdkcaDSz7QuRRF4zXzOwQyBzjasC-jrssOaJAKMTZTF';
  if (scriptId !== testScriptId || allowedScriptId !== testScriptId) {
    throw new Error('Тест остановлен: Script ID не совпадает с разрешённым TEST-проектом.');
  }
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var allowedSpreadsheetId = String(props.getProperty('GAS_TEST_ALLOWED_SPREADSHEET_ID') || '').trim();
  var testSpreadsheetId = '17S6SptviXszBA4tMNgSWqVv3crktxIdY6BdS6bqT8qQ';
  if (!spreadsheet || !/test|тест/i.test(spreadsheet.getName()) ||
      spreadsheet.getId() !== testSpreadsheetId || allowedSpreadsheetId !== testSpreadsheetId) {
    throw new Error('Тест остановлен: активная таблица не совпадает с разрешённой TEST-таблицей.');
  }
  var testWebAppUrl = 'https://script.google.com/macros/s/AKfycbyfEQe7t5YTDHfH5SwYDwe7oiQKMPViU3ZNmoo4X5HruDpBwqPAeMMMUbIbFsyWsbCe/exec';
  if (webAppUrl !== testWebAppUrl) {
    throw new Error('Тест остановлен: нужен отдельный TEST Web App deployment URL.');
  }
  return spreadsheet;
}
