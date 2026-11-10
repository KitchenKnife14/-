export interface TransactionAttributionInput {
  created_by?: string | null
  responsible_user_id?: string | null
}

export interface TransactionAttribution {
  authorId: string | null
  responsibleId: string | null
}

export function getTransactionAttribution(transaction: TransactionAttributionInput): TransactionAttribution
export function matchesTransactionAttribution(
  transaction: TransactionAttributionInput,
  authorFilter?: string,
  responsibleFilter?: string,
): boolean
