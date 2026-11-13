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

  // Read the existing sheet directly. rows_() can create a missing sheet outside
  // a request context, so it is deliberately not used by this read-only diagnostic.
  var profileTimezones = [];
  var profilesSheetPresent = false;
  var profileTimezoneReadOk = true;
  try {
    var profilesSheet = spreadsheet.getSheetByName('profiles');
    profilesSheetPresent = !!profilesSheet;
    if (profilesSheet) {
      var lastRow = profilesSheet.getLastRow();
      var lastColumn = profilesSheet.getLastColumn();
      if (lastRow > 1 && lastColumn > 0) {
        var headers = profilesSheet.getRange(1, 1, 1, lastColumn).getValues()[0];
        var timezoneColumn = headers.indexOf('timezone');
        if (timezoneColumn >= 0) {
          profileTimezones = Array.from(new Set(
            profilesSheet.getRange(2, timezoneColumn + 1, lastRow - 1, 1).getValues()
              .map(function(row) { return String(row[0] || '').trim(); })
              .filter(Boolean)
          )).sort();
        }
      }
    }
  } catch (error) {
    profileTimezoneReadOk = false;
    profileTimezones = ['READ_ERROR'];
  }

  var deploymentUrl = '';
  try { deploymentUrl = String(ScriptApp.getService().getUrl() || '').trim(); } catch (_) {}
  var deploymentUrlHost = '';
  var deploymentUrlShape = 'empty';
  var deploymentParts = deploymentUrl.match(/^https:\/\/([^/?#]+)(\/[^?#]*)?(?:[?#].*)?$/i);
  if (deploymentParts) {
    deploymentUrlHost = deploymentParts[1].toLowerCase();
    var deploymentPath = deploymentParts[2] || '/';
    if (deploymentUrlHost === 'script.google.com' &&
        /^\/macros\/s\/[A-Za-z0-9_-]+\/exec\/?$/i.test(deploymentPath)) {
      deploymentUrlShape = 'standard_exec';
    } else if (deploymentUrlHost === 'script.google.com' &&
        /^\/a\/macros\/[^/]+\/s\/[A-Za-z0-9_-]+\/exec\/?$/i.test(deploymentPath)) {
      deploymentUrlShape = 'account_exec';
    } else if (deploymentUrlHost === 'script.google.com' &&
        /^\/macros\/s\/[A-Za-z0-9_-]+\/dev\/?$/i.test(deploymentPath)) {
      deploymentUrlShape = 'development_url';
    } else {
      deploymentUrlShape = 'other_url_shape';
    }
  } else if (deploymentUrl) {
    deploymentUrlShape = 'unrecognized_url';
  }
  var deploymentMatch = deploymentUrl.match(/^https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec\/?(?:[?#].*)?$/i);
  var report = {
    diagnostic: 'read-only backend security and timezone metadata',
    timestamp: new Date().toISOString(),
    scriptIdSuffix: scriptId.slice(-6),
    spreadsheetIdSuffix: spreadsheet.getId().slice(-6),
    spreadsheetNameIsTest: /test|тест/i.test(spreadsheet.getName()),
    scriptTimezone: Session.getScriptTimeZone(),
    spreadsheetTimezone: spreadsheet.getSpreadsheetTimeZone(),
    profilesSheetPresent: profilesSheetPresent,
    profileTimezoneReadOk: profileTimezoneReadOk,
    profileTimezoneValues: profileTimezones,
    timezoneOk: Session.getScriptTimeZone() === 'Europe/Moscow' && spreadsheet.getSpreadsheetTimeZone() === 'Europe/Moscow',
    apiVersion: API_VERSION,
    pbkdf2Iterations: PW_ITERATIONS,
    signupDisabled: String(props.getProperty('SIGNUP_DISABLED') || '') === '1',
    signupDisabledPropertyPresent: props.getProperty('SIGNUP_DISABLED') !== null,
    debugInfoEnabled: String(props.getProperty('DEBUG_INFO') || '') === '1',
    debugInfoPropertyPresent: props.getProperty('DEBUG_INFO') !== null,
    deploymentUrlPresent: !!deploymentUrl,
    deploymentUrlHost: deploymentUrlHost || null,
    deploymentUrlShape: deploymentUrlShape,
    webAppDeploymentPresent: deploymentUrlShape === 'standard_exec' || deploymentUrlShape === 'account_exec',
    webAppDeploymentIdSuffix: deploymentMatch ? deploymentMatch[1].slice(-6) : null,
    result: profileTimezoneReadOk ? 'DIAGNOSTIC_COMPLETE' : 'DIAGNOSTIC_INCOMPLETE'
  };
  Logger.log(JSON.stringify(report));
  return report;
}
