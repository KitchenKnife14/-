/**
 * Test-only PBKDF2 runtime benchmark.
 * Run manually from the isolated TEST Apps Script project only.
 * Uses synthetic credentials and never reads or writes Sheets or Properties.
 */
function runPbkdf2RuntimeDiagnostics() {
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
    benchmark: 'PBKDF2-HMAC-SHA256 synthetic credentials; no spreadsheet access',
    runtime: 'Google Apps Script V8',
    timestamp: new Date().toISOString(),
    pbkdf2_30000: samples(30000, 5),
    pbkdf2_600000: samples(600000, 3)
  };
  Logger.log(JSON.stringify(result));
  return result;
}
