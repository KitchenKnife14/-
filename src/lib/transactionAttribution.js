/**
 * Resolve transaction author and responsible participant independently.
 * Legacy rows without a responsible_user_id retain the historical author fallback.
 */
export function getTransactionAttribution(transaction) {
  return {
    authorId: transaction?.created_by || null,
    responsibleId: transaction?.responsible_user_id || transaction?.created_by || null,
  };
}

export function matchesTransactionAttribution(transaction, authorFilter = '', responsibleFilter = '') {
  const attribution = getTransactionAttribution(transaction);
  if (authorFilter && attribution.authorId !== authorFilter) return false;
  if (responsibleFilter && attribution.responsibleId !== responsibleFilter) return false;
  return true;
}
