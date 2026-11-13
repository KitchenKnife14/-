/**
 * Read-only runtime diagnostics for the isolated TEST Apps Script project.
 * Reports configuration flags and timezone metadata only; no secrets or personal data.
 *
 * Script Properties:
 * BACKEND_DIAGNOSTICS_CONFIRM=ISOLATED_TEST_ONLY
 * BACKEND_DIAGNOSTICS_ALLOWED_SCRIPT_ID=<test Script ID>
 * BACKEND_DIAGNOSTICS_ALLOWED_SPREADSHEET_ID=<test Spreadsheet ID>
 */
function runBackendSecurityDiagnostics() {
  var props = PropertiesService.getScriptProperties();
  if (String(props.getProperty('BACKEND_DIAGNOSTICS_CONFIRM') || '') !== 'ISOLATED_TEST_ONLY') {
    throw new Error('Диагностика остановлена: требуется подтверждение изолированной среды.');
  }
  var scriptId = ScriptApp.getScriptId();
  var allowedScriptId = String(props.getProperty('BACKEND_DIAGNOSTICS_ALLOWED_SCRIPT_ID') || '').trim();
  if (!allowedScriptId || scriptId !== allowedScriptId) {
    throw new Error('Диагностика остановлена: Script ID не совпадает.');
  }
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var allowedSpreadsheetId = String(props.getProperty('BACKEND_DIAGNOSTICS_ALLOWED_SPREADSHEET_ID') || '').trim();
  if (!spreadsheet || !/test|тест/i.test(spreadsheet.getName()) ||
      !allowedSpreadsheetId || spreadsheet.getId() !== allowedSpreadsheetId) {
    throw new Error('Диагностика остановлена: требуется разрешённая TEST/ТЕСТ таблица.');
  }

  var profileTimezones = [];
  try {
    profileTimezones = Array.from(new Set(rows_('profiles')
      .map(function(row) { return String(row.timezone || '').trim(); })
      .filter(Boolean))).sort();
  } catch (error) {
    profileTimezones = ['READ_ERROR'];
  }

  var deploymentUrl = '';
  try { deploymentUrl = String(ScriptApp.getService().getUrl() || ''); } catch (_) {}
  var deploymentMatch = deploymentUrl.match(/^https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec$/);
  var report = {
    diagnostic: 'read-only backend security and timezone metadata',
    timestamp: new Date().toISOString(),
    scriptIdSuffix: scriptId.slice(-6),
    spreadsheetIdSuffix: spreadsheet.getId().slice(-6),
    spreadsheetNameIsTest: /test|тест/i.test(spreadsheet.getName()),
    scriptTimezone: Session.getScriptTimeZone(),
    spreadsheetTimezone: spreadsheet.getSpreadsheetTimeZone(),
    profileTimezoneValues: profileTimezones,
    apiVersion: API_VERSION,
    pbkdf2Iterations: PW_ITERATIONS,
    signupDisabled: String(props.getProperty('SIGNUP_DISABLED') || '') === '1',
    signupDisabledPropertyPresent: props.getProperty('SIGNUP_DISABLED') !== null,
    debugInfoEnabled: String(props.getProperty('DEBUG_INFO') || '') === '1',
    debugInfoPropertyPresent: props.getProperty('DEBUG_INFO') !== null,
    webAppDeploymentPresent: !!deploymentMatch,
    webAppDeploymentIdSuffix: deploymentMatch ? deploymentMatch[1].slice(-6) : null,
    result: 'PASS'
  };
  Logger.log(JSON.stringify(report));
  return report;
}
