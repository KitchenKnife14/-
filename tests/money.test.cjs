const test = require('node:test');
const assert = require('node:assert/strict');

test('RUB text is converted to exact integer kopecks', async () => {
  const { parseRublesToKopecks } = await import('../src/lib/moneyRuntime.js');
  assert.equal(parseRublesToKopecks('1'), 100);
  assert.equal(parseRublesToKopecks('1.2'), 120);
  assert.equal(parseRublesToKopecks('1,20'), 120);
  assert.equal(parseRublesToKopecks('0,01'), 1);
  assert.equal(parseRublesToKopecks('.5'), 50);
  assert.equal(parseRublesToKopecks('1 000,05'), 100005);
  assert.equal(parseRublesToKopecks('1\u00a0000,05'), 100005);
  assert.equal(parseRublesToKopecks('1\u202f000,05'), 100005);
});

test('RUB text with more than two decimal places is rejected rather than rounded', async () => {
  const { parseRublesToKopecks } = await import('../src/lib/moneyRuntime.js');
  for (const value of ['1.001', '1,005', '0.009', '5.', '1,2,3', '1e3', '', '   ', 'abc']) {
    assert.equal(parseRublesToKopecks(value), null, 'Expected rejection for ' + JSON.stringify(value));
  }
});

test('negative RUB values are accepted only when the calling form allows them', async () => {
  const { parseRublesToKopecks } = await import('../src/lib/moneyRuntime.js');
  assert.equal(parseRublesToKopecks('-12,34'), null);
  assert.equal(parseRublesToKopecks('-12,34', true), -1234);
  assert.equal(parseRublesToKopecks('+12,34'), 1234);
  assert.equal(parseRublesToKopecks('-0,00', true), 0);
});

test('RUB parsing rejects values outside JavaScript safe integer kopecks', async () => {
  const { parseRublesToKopecks } = await import('../src/lib/moneyRuntime.js');
  assert.equal(parseRublesToKopecks('90071992547409,91'), Number.MAX_SAFE_INTEGER);
  assert.equal(parseRublesToKopecks('90071992547409,92'), null);
  assert.equal(parseRublesToKopecks('999999999999999999999999'), null);
});
