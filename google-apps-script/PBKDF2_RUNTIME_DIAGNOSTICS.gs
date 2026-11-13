/**
 * Test-only PBKDF2 runtime benchmark.
 * Run manually from the isolated TEST Apps Script project only.
 * Uses synthetic credentials and performs no spreadsheet reads/writes.
 */
function runPbkdf2RuntimeDiagnostics() {
  var props = PropertiesService.getScriptProperties();
  if (String(props.getProperty('PBKDF2_DIAGNOSTICS_CONFIRM') || '') !== 'ISOLATED_TEST_ONLY') {
    throw new Error('Тест остановлен: требуется PBKDF2_DIAGNOSTICS_CONFIRM=ISOLATED_TEST_ONLY.');
  }

  // Script ID and deployment ID are different identifiers. Allow only the exact
  // Apps Script project explicitly allow-listed in this project's own properties.
  var currentScriptId = ScriptApp.getScriptId();
  var allowedScriptId = String(props.getProperty('PBKDF2_ALLOWED_SCRIPT_ID') || '');
  if (!allowedScriptId || currentScriptId !== allowedScriptId) {
    throw new Error('Тест остановлен: Script ID проекта не совпадает с PBKDF2_ALLOWED_SCRIPT_ID.');
  }

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet || !/test|тест/i.test(spreadsheet.getName())) {
    throw new Error('Тест остановлен: требуется отдельная таблица TEST/ТЕСТ.');
  }
  var allowedSpreadsheetId = String(props.getProperty('PBKDF2_ALLOWED_SPREADSHEET_ID') || '');
  if (!allowedSpreadsheetId || spreadsheet.getId() !== allowedSpreadsheetId) {
    throw new Error('Тест остановлен: ID таблицы не совпадает с PBKDF2_ALLOWED_SPREADSHEET_ID.');
  }

  const password = 'synthetic-runtime-benchmark-password';
  const salt = 'synthetic-runtime-benchmark-salt';

  const samples = (iterations, count) => {
    const timings = [];
    for (let i = 0; i < count; i++) {
      const started = Date.now();
      const result = pbkdf2Hex_(password, salt, iterations);
      timings.push(Date.now() - started);
      if (!/^[0-9a-f]{64}$/.test(result)) {
        throw new Error('PBKDF2 returned an invalid digest');
      }
    }
    const sorted = timings.slice().sort((a, b) => a - b);
    return {
      iterations: iterations,
      samplesMs: timings,
      minMs: sorted[0],
      medianMs: sorted[Math.floor(sorted.length / 2)],
      maxMs: sorted[sorted.length - 1]
    };
  };

  // Warm up the JS path with synthetic input before collecting measurements.
  pbkdf2Hex_(password, salt, 1000);
  const result = {
    benchmark: 'PBKDF2-HMAC-SHA256 synthetic credentials; no spreadsheet data access',
    runtime: 'Google Apps Script V8',
    timestamp: new Date().toISOString(),
    scriptIdSuffix: currentScriptId.slice(-6),
    pbkdf2_30000: samples(30000, 5),
    pbkdf2_600000: samples(600000, 3)
  };
  Logger.log(JSON.stringify(result));
  return result;
}
