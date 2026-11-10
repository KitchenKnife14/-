/** Derive account balances from the ledger; internal transfers do not change family net worth. */
export function calculateAccountBalances(accounts, transactions) {
  const balances = new Map();
  for (const account of accounts) {
    const opening = Number(account.starting_balance_kopecks ?? 0);
    balances.set(account.id, Number.isSafeInteger(opening) ? opening : 0);
  }
  for (const transaction of transactions) {
    if (transaction.planned) continue;
    const amount = Number(transaction.amount_kopecks);
    if (!Number.isSafeInteger(amount) || amount <= 0) continue;

    if (transaction.type === 'income' && transaction.account_id && balances.has(transaction.account_id)) {
      const current = balances.get(transaction.account_id);
      const next = current + amount;
      if (Number.isSafeInteger(next)) balances.set(transaction.account_id, next);
    } else if (transaction.type === 'expense' && transaction.account_id && balances.has(transaction.account_id)) {
      const current = balances.get(transaction.account_id);
      const next = current - amount;
      if (Number.isSafeInteger(next)) balances.set(transaction.account_id, next);
    } else if (transaction.type === 'transfer') {
      const from = transaction.account_id, to = transaction.to_account_id;
      if (!from || !to || from === to || !balances.has(from) || !balances.has(to)) continue;
      const nextFrom = balances.get(from) - amount;
      const nextTo = balances.get(to) + amount;
      // A transfer is atomic: never update one side if the other side would overflow.
      if (Number.isSafeInteger(nextFrom) && Number.isSafeInteger(nextTo)) {
        balances.set(from, nextFrom);
        balances.set(to, nextTo);
      }
    }
  }
  return balances;
}
