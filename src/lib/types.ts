export type TxType = 'income' | 'expense' | 'transfer'
export type CategoryKind = 'expense' | 'income' | 'transfer'
export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'
export type GoalStatus = 'active' | 'paused' | 'done' | 'cancelled'
export type PurchaseStatus = 'planned' | 'saving' | 'ready' | 'bought' | 'postponed' | 'cancelled'
export type PlanType = 'income' | 'expense' | 'savings'
export type DigestMode = 'off' | 'daily' | 'weekly'

export interface Profile {
  id: string
  display_name: string
  avatar_color: string
  timezone: string
  created_at: string
}

export interface Family {
  id: string
  name: string
  invite_code: string
  currency: string
  created_at: string
}

export interface FamilyMember {
  id: string
  family_id: string
  user_id: string
  role: 'owner' | 'member'
  joined_at: string
}

export interface Category {
  id: string
  family_id: string
  parent_id: string | null
  name: string
  kind: CategoryKind
  color: string
  icon: string
  archived: boolean
  sort_order: number
  created_at: string
}

export interface Account {
  id: string
  family_id: string
  name: string
  kind: 'cash' | 'bank' | 'savings' | 'other'
  owner_user_id: string | null
  starting_balance_kopecks: number
  archived: boolean
  created_at: string
}

export interface Transaction {
  id: string
  family_id: string
  type: TxType
  amount_kopecks: number
  operation_date: string
  operation_time: string | null
  category_id: string | null
  account_id: string | null
  to_account_id: string | null
  description: string
  created_by: string | null
  updated_by: string | null
  planned: boolean
  parent_recurring_id: string | null
  created_at: string
  updated_at: string
}

export interface RecurringPayment {
  id: string
  family_id: string
  type: TxType
  amount_kopecks: number
  category_id: string | null
  account_id: string | null
  description: string
  start_date: string
  end_date: string | null
  frequency: RecurringFrequency
  custom_interval_days: number | null
  next_due_date: string
  remind: boolean
  active: boolean
  created_by: string | null
  created_at: string
}

export interface Budget {
  id: string
  family_id: string
  category_id: string
  month_date: string
  limit_kopecks: number
  warn_75: boolean
  warn_90: boolean
  warn_100: boolean
}

export interface Goal {
  id: string
  family_id: string
  name: string
  description: string
  target_kopecks: number
  saved_kopecks: number
  target_date: string | null
  priority: number
  status: GoalStatus
  responsible_user_id: string | null
  created_at: string
}

export interface GoalContribution {
  id: string
  goal_id: string
  amount_kopecks: number
  contribution_date: string
  note: string
  created_by: string | null
  created_at: string
}

export interface PlannedPurchase {
  id: string
  family_id: string
  name: string
  category_id: string | null
  estimated_kopecks: number
  priority: number
  desired_month: string | null
  desired_date: string | null
  url: string
  comment: string
  status: PurchaseStatus
  responsible_user_id: string | null
  goal_id: string | null
  linked_transaction_id: string | null
  created_by: string | null
  created_at: string
}

export interface MonthlyPlan {
  id: string
  family_id: string
  month_date: string
  category_id: string | null
  type: PlanType
  planned_kopecks: number
  note: string
}

export interface AppNotification {
  id: string
  family_id: string
  user_id: string
  kind: string
  title: string
  body: string
  read: boolean
  created_at: string
}
