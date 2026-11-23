const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

// Both the maintained GAS source and the single-file TEST deployment bundle must
// stop before the next probe unless cleanup was explicitly confirmed.
const sources = [
  'tests/gas/RuntimeAcceptanceBatch.gs',
  'tests/gas/RuntimeAcceptanceBundle.gs',
]
const probeNames = [
  'runTelegramUpdateConcurrencyTest',
  'runReadConsistencyConcurrencyTest',
  'runMonthlyPlanConcurrencyTest',
  'runTransactionConcurrencyTest',
]

function simulateBatch(path, responses) {
  const calls = []
  const logged = []
  let index = 0
  const properties = {
    getProperty: key => ({
      CONCURRENT_ROW_TEST_WEB_APP_URL: 'https://script.google.com/macros/s/synthetic-test-id/exec',
      CONCURRENT_ROW_TEST_CONFIRM: 'ISOLATED_TEST_ONLY',
    })[key] ?? null,
  }
  const context = {
    PropertiesService: { getScriptProperties: () => properties },
    Logger: { log: value => logged.push(JSON.parse(value)) },
    assertIsolatedGasTestEnvironment_: (_props, confirmation, url) => {
      assert.equal(confirmation, 'ISOLATED_TEST_ONLY')
      assert.match(url, /^https:\/\/script\.google\.com\/macros\/s\//)
    },
  }
  vm.createContext(context)
  vm.runInContext(fs.readFileSync(path, 'utf8'), context, { filename: path })
  // The bundle declares the real probe functions. Override them with safe,
  // in-memory stubs; this regression must never contact Google or Telegram.
  for (const name of probeNames) {
    context[name] = () => {
      calls.push(name)
      const reply = responses[index++]
      if (reply instanceof Error) throw reply
      return reply
    }
  }
  const output = vm.runInContext('runIsolatedRuntimeAcceptanceBatch()', context)
  return { output: JSON.parse(JSON.stringify(output)), calls, logged }
}

for (const path of sources) {
  test(`${path}: all probes pass with verified cleanup`, () => {
    const reports = probeNames.map(() => ({ result: 'PASS', cleanup: 'PASS' }))
    const { output, calls, logged } = simulateBatch(path, reports)
    assert.equal(output.result, 'PASS')
    assert.equal(output.completed, 4)
    assert.equal(output.passed, 4)
    assert.equal(output.stopped_for_cleanup_failure, false)
    assert.deepEqual(calls, probeNames)
    assert.deepEqual(logged, [output])
  })

  test(`${path}: ordinary failure may continue only when cleanup is verified`, () => {
    const reports = [
      { result: 'FAIL', cleanup: 'PASS' },
      ...probeNames.slice(1).map(() => ({ result: 'PASS', cleanup: 'PASS' })),
    ]
    const { output, calls } = simulateBatch(path, reports)
    assert.equal(output.result, 'FAIL')
    assert.equal(output.completed, 4)
    assert.equal(output.failed, 1)
    assert.equal(output.stopped_for_cleanup_failure, false)
    assert.deepEqual(calls, probeNames)
  })

  for (const [label, response] of [
    ['failed cleanup', { result: 'FAIL', cleanup: 'FAILED' }],
    ['missing cleanup confirmation', { result: 'FAIL' }],
    ['missing report', null],
    ['exception with no cleanup keyword', new Error('Network timed out')],
  ]) {
    test(`${path}: stop on ${label}`, () => {
      const { output, calls } = simulateBatch(path, [
        response,
        ...probeNames.slice(1).map(() => ({ result: 'PASS', cleanup: 'PASS' })),
      ])
      assert.equal(output.result, 'FAIL')
      assert.equal(output.completed, 1)
      assert.equal(output.failed, 1)
      assert.equal(output.stopped_for_cleanup_failure, true)
      assert.deepEqual(calls, [probeNames[0]])
    })
  }
}
