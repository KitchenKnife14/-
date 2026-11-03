import type { Account, Transaction } from './types'
export function calculateAccountBalances(accounts: Account[], transactions: Transaction[]): Map<string, number>
