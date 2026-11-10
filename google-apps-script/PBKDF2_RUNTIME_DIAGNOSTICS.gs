/**
 * Test-only benchmark. Run manually from the Apps Script editor in the isolated
 * TEST project after Code.gs has been copied there. This function never reads
 * or writes Google Sheets and uses only synthetic credentials.
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
      if (!/^[0-9a-f]{64}$/.test(result)) throw new Error('PBKDF2 returned an invalid digest');
    }
    const sorted = timings.slice().sort((a, b) => a - b);
    return { iterations: iterations, samplesMs: timings, minMs: sorted[0], medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: sorted[sorted.length - 1] };
  };

  // Warm the JavaScript path without using any real account data.
  pbkdf2Hex_(password, salt, 1000);
  const startedLegacy = Date.now();
  const legacyDigest = hash_(password, salt);
  const legacyMs = Date.now() - startedLegacy;
  if (!/^[A-Za-z0-9+/]+=*$/.test(legacyDigest)) throw new Error('Legacy hash returned an invalid digest');

  const result = {
    benchmark: 'PBKDF2-HMAC-SHA256 synthetic credentials; no spreadsheet access',
    runtime: 'Google Apps Script',
    timestamp: new Date().toISOString(),
    legacySha256_10000CallsMs: legacyMs,
    pbkdf2_30000: samples(30000, 5),
    pbkdf2_60000: samples(60000, 3)
  };
  Logger.log(JSON.stringify(result));
  return result;
}
