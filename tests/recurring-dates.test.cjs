const test = require('node:test')
const assert = require('node:assert/strict')

test('monthly recurring dates preserve the original day after short months', async () => {
  const { advanceRecurringDate } = await import('../src/lib/recurringDates.js')
  const february = advanceRecurringDate('2027-01-31', 'monthly', null, '2027-01-31')
  assert.equal(february, '2027-02-28')
  assert.equal(advanceRecurringDate(february, 'monthly', null, '2027-01-31'), '2027-03-31')
})

test('yearly recurring dates preserve leap-day anchor across non-leap years', async () => {
  const { advanceRecurringDate } = await import('../src/lib/recurringDates.js')
  const nextYear = advanceRecurringDate('2028-02-29', 'yearly', null, '2028-02-29')
  assert.equal(nextYear, '2029-02-28')
  assert.equal(advanceRecurringDate(nextYear, 'yearly', null, '2028-02-29'), '2030-02-28')
  assert.equal(advanceRecurringDate('2031-02-28', 'yearly', null, '2028-02-29'), '2032-02-29')
})

test('daily, weekly and custom recurring dates advance by exact calendar days', async () => {
  const { advanceRecurringDate } = await import('../src/lib/recurringDates.js')
  assert.equal(advanceRecurringDate('2026-12-31', 'daily'), '2027-01-01')
  assert.equal(advanceRecurringDate('2026-12-31', 'weekly'), '2027-01-07')
  assert.equal(advanceRecurringDate('2026-12-31', 'custom', 10), '2027-01-10')
})

test('invalid date-only values and unsupported frequencies fail closed', async () => {
  const { advanceRecurringDate } = await import('../src/lib/recurringDates.js')
  assert.equal(advanceRecurringDate('2027-02-30', 'monthly', null, '2027-01-31'), null)
  assert.equal(advanceRecurringDate('2027-01-31', 'monthly', null, 'bad-date'), null)
  assert.equal(advanceRecurringDate('2027-01-31', 'unknown'), null)
})
