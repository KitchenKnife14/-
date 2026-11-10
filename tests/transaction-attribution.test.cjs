const test = require('node:test')
const assert = require('node:assert/strict')

test('transaction author and responsible participant are filtered independently', async () => {
  const { getTransactionAttribution, matchesTransactionAttribution } = await import('../src/lib/transactionAttribution.js')
  const transaction = { created_by: 'author-a', responsible_user_id: 'responsible-b' }

  assert.deepEqual(getTransactionAttribution(transaction), {
    authorId: 'author-a',
    responsibleId: 'responsible-b',
  })
  assert.equal(matchesTransactionAttribution(transaction, 'author-a', ''), true)
  assert.equal(matchesTransactionAttribution(transaction, '', 'responsible-b'), true)
  assert.equal(matchesTransactionAttribution(transaction, 'author-a', 'responsible-b'), true)
  assert.equal(matchesTransactionAttribution(transaction, 'responsible-b', ''), false)
  assert.equal(matchesTransactionAttribution(transaction, '', 'author-a'), false)
})

test('legacy transactions without explicit attribution do not invent an author', async () => {
  const { getTransactionAttribution, matchesTransactionAttribution } = await import('../src/lib/transactionAttribution.js')
  const transaction = { responsible_user_id: 'responsible-b' }
  assert.deepEqual(getTransactionAttribution(transaction), {
    authorId: null,
    responsibleId: 'responsible-b',
  })
  assert.equal(matchesTransactionAttribution(transaction, 'author-a', ''), false)
  assert.equal(matchesTransactionAttribution(transaction, '', 'responsible-b'), true)

  const oldRow = { created_by: 'author-a' }
  assert.deepEqual(getTransactionAttribution(oldRow), {
    authorId: 'author-a',
    responsibleId: 'author-a',
  })
  assert.equal(matchesTransactionAttribution(oldRow, 'author-a', 'author-a'), true)
})
