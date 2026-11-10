/** Derive account balances from the ledger without displaying a misleading partial result. */
export function calculateAccountBalances(accounts, transactions) {
  const balances = new Map();
  const invalidAccountIds = new Set();
  const issues = [];

  const invalidate = (accountId, transactionId, reason) => {
    if (!accountId || !balances.has(accountId) || invalidAccountIds.has(accountId)) return;
    invalidAccountIds.add(accountId);
    issues.push({ accountId, transactionId: transactionId ?? null, reason });
  };

  for (const account of accounts) {
    const opening = account.starting_balance_kopecks ?? 0;
    if (typeof opening !== 'number' || !Number.isSafeInteger(opening)) {
      balances.set(account.id, 0);
      invalidAccountIds.add(account.id);
      issues.push({ accountId: account.id, transactionId: null, reason: 'invalid-opening-balance' });
    } else {
      balances.set(account.id, opening);
    }
  }

  for (const transaction of transactions) {
    if (transaction.planned) continue;
    const amount = transaction.amount_kopecks;

    if (transaction.type === 'income' || transaction.type === 'expense') {
      const accountId = transaction.account_id;
      if (!accountId || !balances.has(accountId) || invalidAccountIds.has(accountId)) continue;
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
        invalidate(accountId, transaction.id, 'invalid-transaction-amount');
        continue;
      }
      const current = balances.get(accountId);
      const next = transaction.type === 'income' ? current + amount : current - amount;
      if (Number.isSafeInteger(next)) balances.set(accountId, next);
      else invalidate(accountId, transaction.id, 'balance-overflow');
      continue;
    }

    if (transaction.type === 'transfer') {
      const from = transaction.account_id, to = transaction.to_account_id;
      const knownAccounts = [from, to].filter(id => id && balances.has(id));
      if (!from || !to || from === to || !balances.has(from) || !balances.has(to)) {
        knownAccounts.forEach(id => invalidate(id, transaction.id, 'invalid-transfer-accounts'));
        continue;
      }
      if (invalidAccountIds.has(from) || invalidAccountIds.has(to)) {
        invalidate(from, transaction.id, 'related-account-invalid');
        invalidate(to, transaction.id, 'related-account-invalid');
        continue;
      }
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
        invalidate(from, transaction.id, 'invalid-transaction-amount');
        invalidate(to, transaction.id, 'invalid-transaction-amount');
        continue;
      }
      const nextFrom = balances.get(from) - amount;
      const nextTo = balances.get(to) + amount;
      if (Number.isSafeInteger(nextFrom) && Number.isSafeInteger(nextTo)) {
        balances.set(from, nextFrom);
        balances.set(to, nextTo);
      } else {
        // A transfer is atomic: both balances become untrusted if either side overflows.
        invalidate(from, transaction.id, 'balance-overflow');
        invalidate(to, transaction.id, 'balance-overflow');
      }
    }
  }

  balances.invalidAccountIds = invalidAccountIds;
  balances.issues = issues;
  return balances;
}
