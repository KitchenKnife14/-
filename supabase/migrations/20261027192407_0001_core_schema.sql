/*
# Core schema for "Бюджет для двоих" (Budget for Two)

Family budget manager for two members of one family.
Money is stored as integer kopecks (bigint) to avoid rounding errors.
Dates stored with timezone awareness.

1. New Tables
- profiles — public profile per auth user (display name, avatar color, timezone)
- families — a single family space with invite code
- family_members — membership user<->family with role (owner/member)
- categories — expense/income/transfer categories & subcategories, scoped to family
- accounts — cash/bank/savings accounts with starting balance, scoped to family
- transactions — income/expense/transfer records, scoped to family
- recurring_payments — repeating operations
- budgets — monthly category limits
- goals — savings goals
- goal_contributions — money added to a goal
- planned_purchases — wishlist with priority/status
- monthly_plans — planned income/expenses/savings for a month
- notifications — in-app notification center
- telegram_links — verified binding of telegram chat to a family member

2. Security
- RLS enabled on every table.
- Access scoped to the family the authenticated user belongs to.
- Grants only to authenticated role (app requires sign-in); service_role granted for the Telegram edge function.
- Helper current_family_id() defined after family_members exists.

3. Notes
- amount_kopecks always positive; type field marks income vs expense.
- type='transfer' excluded from income/expense totals.
- planned=true excluded from realized totals.
- Recurring payments create planned transactions only on user confirmation, never automatically.
*/

-- Profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  avatar_color text NOT NULL DEFAULT '#2563eb',
  timezone text NOT NULL DEFAULT 'Europe/Moscow',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated, service_role;
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Families
CREATE TABLE IF NOT EXISTS public.families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Наша семья',
  invite_code text UNIQUE NOT NULL DEFAULT upper(substring(encode(gen_random_bytes(6), 'hex') for 8)),
  currency text NOT NULL DEFAULT 'RUB',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.families ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.families TO authenticated, service_role;

-- Family members
CREATE TABLE IF NOT EXISTS public.family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id, user_id)
);
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_members TO authenticated, service_role;

-- Helper: returns the family id of the currently authenticated user (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.current_family_id()
RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT family_id FROM public.family_members WHERE user_id = auth.uid() LIMIT 1;
$$;

-- family_members policies
DROP POLICY IF EXISTS "fm_select_member" ON public.family_members;
CREATE POLICY "fm_select_member" ON public.family_members
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = family_members.family_id));
DROP POLICY IF EXISTS "fm_insert_member" ON public.family_members;
CREATE POLICY "fm_insert_member" ON public.family_members
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "fm_update_member" ON public.family_members;
CREATE POLICY "fm_update_member" ON public.family_members
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = family_members.family_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = family_members.family_id));
DROP POLICY IF EXISTS "fm_delete_member" ON public.family_members;
CREATE POLICY "fm_delete_member" ON public.family_members
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- families policies
DROP POLICY IF EXISTS "families_select_member" ON public.families;
CREATE POLICY "families_select_member" ON public.families
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = families.id));
DROP POLICY IF EXISTS "families_insert" ON public.families;
CREATE POLICY "families_insert" ON public.families
  FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "families_update_member" ON public.families;
CREATE POLICY "families_update_member" ON public.families
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = families.id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = families.id));

-- Categories
CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense','income','transfer')),
  color text NOT NULL DEFAULT '#64748b',
  icon text NOT NULL DEFAULT '🏷️',
  archived boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated, service_role;
DROP POLICY IF EXISTS "cat_select" ON public.categories;
CREATE POLICY "cat_select" ON public.categories
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = categories.family_id));
DROP POLICY IF EXISTS "cat_insert" ON public.categories;
CREATE POLICY "cat_insert" ON public.categories
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = categories.family_id));
DROP POLICY IF EXISTS "cat_update" ON public.categories;
CREATE POLICY "cat_update" ON public.categories
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = categories.family_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = categories.family_id));
DROP POLICY IF EXISTS "cat_delete" ON public.categories;
CREATE POLICY "cat_delete" ON public.categories
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = categories.family_id));

-- Accounts
CREATE TABLE IF NOT EXISTS public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'cash' CHECK (kind IN ('cash','bank','savings','other')),
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  starting_balance_kopecks bigint NOT NULL DEFAULT 0,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts TO authenticated, service_role;
DROP POLICY IF EXISTS "acc_select" ON public.accounts;
CREATE POLICY "acc_select" ON public.accounts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = accounts.family_id));
DROP POLICY IF EXISTS "acc_insert" ON public.accounts;
CREATE POLICY "acc_insert" ON public.accounts
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = accounts.family_id));
DROP POLICY IF EXISTS "acc_update" ON public.accounts;
CREATE POLICY "acc_update" ON public.accounts
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = accounts.family_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = accounts.family_id));
DROP POLICY IF EXISTS "acc_delete" ON public.accounts;
CREATE POLICY "acc_delete" ON public.accounts
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = accounts.family_id));

-- Recurring payments (defined before transactions so FK works)
CREATE TABLE IF NOT EXISTS public.recurring_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('income','expense','transfer')),
  amount_kopecks bigint NOT NULL CHECK (amount_kopecks > 0),
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  start_date date NOT NULL,
  end_date date,
  frequency text NOT NULL CHECK (frequency IN ('daily','weekly','monthly','yearly','custom')),
  custom_interval_days int,
  next_due_date date NOT NULL,
  remind boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.recurring_payments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_payments TO authenticated, service_role;
DROP POLICY IF EXISTS "rp_select" ON public.recurring_payments;
CREATE POLICY "rp_select" ON public.recurring_payments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = recurring_payments.family_id));
DROP POLICY IF EXISTS "rp_insert" ON public.recurring_payments;
CREATE POLICY "rp_insert" ON public.recurring_payments
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = recurring_payments.family_id));
DROP POLICY IF EXISTS "rp_update" ON public.recurring_payments;
CREATE POLICY "rp_update" ON public.recurring_payments
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = recurring_payments.family_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = recurring_payments.family_id));
DROP POLICY IF EXISTS "rp_delete" ON public.recurring_payments;
CREATE POLICY "rp_delete" ON public.recurring_payments
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = recurring_payments.family_id));

-- Transactions
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('income','expense','transfer')),
  amount_kopecks bigint NOT NULL CHECK (amount_kopecks > 0),
  operation_date date NOT NULL,
  operation_time time,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  to_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  planned boolean NOT NULL DEFAULT false,
  parent_recurring_id uuid REFERENCES public.recurring_payments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated, service_role;
CREATE INDEX IF NOT EXISTS idx_transactions_family_date ON public.transactions (family_id, operation_date);
CREATE INDEX IF NOT EXISTS idx_transactions_family_cat ON public.transactions (family_id, category_id);
DROP POLICY IF EXISTS "tx_select" ON public.transactions;
CREATE POLICY "tx_select" ON public.transactions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = transactions.family_id));
DROP POLICY IF EXISTS "tx_insert" ON public.transactions;
CREATE POLICY "tx_insert" ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = transactions.family_id));
DROP POLICY IF EXISTS "tx_update" ON public.transactions;
CREATE POLICY "tx_update" ON public.transactions
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = transactions.family_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = transactions.family_id));
DROP POLICY IF EXISTS "tx_delete" ON public.transactions;
CREATE POLICY "tx_delete" ON public.transactions
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = transactions.family_id));

-- Budgets
CREATE TABLE IF NOT EXISTS public.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  month_date date NOT NULL,
  limit_kopecks bigint NOT NULL CHECK (limit_kopecks > 0),
  warn_75 boolean NOT NULL DEFAULT true,
  warn_90 boolean NOT NULL DEFAULT true,
  warn_100 boolean NOT NULL DEFAULT true,
  UNIQUE (family_id, category_id, month_date)
);
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budgets TO authenticated, service_role;
DROP POLICY IF EXISTS "bud_select" ON public.budgets;
CREATE POLICY "bud_select" ON public.budgets
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = budgets.family_id));
DROP POLICY IF EXISTS "bud_insert" ON public.budgets;
CREATE POLICY "bud_insert" ON public.budgets
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = budgets.family_id));
DROP POLICY IF EXISTS "bud_update" ON public.budgets;
CREATE POLICY "bud_update" ON public.budgets
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = budgets.family_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = budgets.family_id));
DROP POLICY IF EXISTS "bud_delete" ON public.budgets;
CREATE POLICY "bud_delete" ON public.budgets
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = budgets.family_id));

-- Goals
CREATE TABLE IF NOT EXISTS public.goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  target_kopecks bigint NOT NULL CHECK (target_kopecks > 0),
  saved_kopecks bigint NOT NULL DEFAULT 0,
  target_date date,
  priority int NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','done','cancelled')),
  responsible_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.goals TO authenticated, service_role;
DROP POLICY IF EXISTS "goal_select" ON public.goals;
CREATE POLICY "goal_select" ON public.goals
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = goals.family_id));
DROP POLICY IF EXISTS "goal_insert" ON public.goals;
CREATE POLICY "goal_insert" ON public.goals
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = goals.family_id));
DROP POLICY IF EXISTS "goal_update" ON public.goals;
CREATE POLICY "goal_update" ON public.goals
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = goals.family_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = goals.family_id));
DROP POLICY IF EXISTS "goal_delete" ON public.goals;
CREATE POLICY "goal_delete" ON public.goals
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = goals.family_id));

-- Goal contributions
CREATE TABLE IF NOT EXISTS public.goal_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  amount_kopecks bigint NOT NULL,
  contribution_date date NOT NULL,
  note text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.goal_contributions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.goal_contributions TO authenticated, service_role;
DROP POLICY IF EXISTS "gc_select" ON public.goal_contributions;
CREATE POLICY "gc_select" ON public.goal_contributions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.goals g JOIN public.family_members fm ON fm.family_id = g.family_id WHERE g.id = goal_contributions.goal_id AND fm.user_id = auth.uid()));
DROP POLICY IF EXISTS "gc_insert" ON public.goal_contributions;
CREATE POLICY "gc_insert" ON public.goal_contributions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.goals g JOIN public.family_members fm ON fm.family_id = g.family_id WHERE g.id = goal_contributions.goal_id AND fm.user_id = auth.uid()));
DROP POLICY IF EXISTS "gc_update" ON public.goal_contributions;
CREATE POLICY "gc_update" ON public.goal_contributions
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.goals g JOIN public.family_members fm ON fm.family_id = g.family_id WHERE g.id = goal_contributions.goal_id AND fm.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.goals g JOIN public.family_members fm ON fm.family_id = g.family_id WHERE g.id = goal_contributions.goal_id AND fm.user_id = auth.uid()));
DROP POLICY IF EXISTS "gc_delete" ON public.goal_contributions;
CREATE POLICY "gc_delete" ON public.goal_contributions
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.goals g JOIN public.family_members fm ON fm.family_id = g.family_id WHERE g.id = goal_contributions.goal_id AND fm.user_id = auth.uid()));

-- Planned purchases
CREATE TABLE IF NOT EXISTS public.planned_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  name text NOT NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  estimated_kopecks bigint NOT NULL CHECK (estimated_kopecks > 0),
  priority int NOT NULL DEFAULT 4 CHECK (priority BETWEEN 1 AND 5),
  desired_month date,
  desired_date date,
  url text NOT NULL DEFAULT '',
  comment text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','saving','ready','bought','postponed','cancelled')),
  responsible_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  goal_id uuid REFERENCES public.goals(id) ON DELETE SET NULL,
  linked_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.planned_purchases ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.planned_purchases TO authenticated, service_role;
DROP POLICY IF EXISTS "pp_select" ON public.planned_purchases;
CREATE POLICY "pp_select" ON public.planned_purchases
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = planned_purchases.family_id));
DROP POLICY IF EXISTS "pp_insert" ON public.planned_purchases;
CREATE POLICY "pp_insert" ON public.planned_purchases
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = planned_purchases.family_id));
DROP POLICY IF EXISTS "pp_update" ON public.planned_purchases;
CREATE POLICY "pp_update" ON public.planned_purchases
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = planned_purchases.family_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = planned_purchases.family_id));
DROP POLICY IF EXISTS "pp_delete" ON public.planned_purchases;
CREATE POLICY "pp_delete" ON public.planned_purchases
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = planned_purchases.family_id));

-- Monthly plans
CREATE TABLE IF NOT EXISTS public.monthly_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  month_date date NOT NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('income','expense','savings')),
  planned_kopecks bigint NOT NULL DEFAULT 0,
  note text NOT NULL DEFAULT '',
  UNIQUE (family_id, month_date, category_id, type)
);
ALTER TABLE public.monthly_plans ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monthly_plans TO authenticated, service_role;
DROP POLICY IF EXISTS "mp_select" ON public.monthly_plans;
CREATE POLICY "mp_select" ON public.monthly_plans
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = monthly_plans.family_id));
DROP POLICY IF EXISTS "mp_insert" ON public.monthly_plans;
CREATE POLICY "mp_insert" ON public.monthly_plans
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = monthly_plans.family_id));
DROP POLICY IF EXISTS "mp_update" ON public.monthly_plans;
CREATE POLICY "mp_update" ON public.monthly_plans
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = monthly_plans.family_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = monthly_plans.family_id));
DROP POLICY IF EXISTS "mp_delete" ON public.monthly_plans;
CREATE POLICY "mp_delete" ON public.monthly_plans
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.user_id = auth.uid() AND fm.family_id = monthly_plans.family_id));

-- Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated, service_role;
CREATE INDEX IF NOT EXISTS idx_notif_user ON public.notifications (user_id, read);
DROP POLICY IF EXISTS "notif_select" ON public.notifications;
CREATE POLICY "notif_select" ON public.notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "notif_insert" ON public.notifications;
CREATE POLICY "notif_insert" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "notif_update" ON public.notifications;
CREATE POLICY "notif_update" ON public.notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "notif_delete" ON public.notifications;
CREATE POLICY "notif_delete" ON public.notifications
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Telegram links
CREATE TABLE IF NOT EXISTS public.telegram_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_member_id uuid NOT NULL REFERENCES public.family_members(id) ON DELETE CASCADE,
  telegram_chat_id bigint NOT NULL UNIQUE,
  telegram_username text NOT NULL DEFAULT '',
  notify_new_tx boolean NOT NULL DEFAULT true,
  notify_budget boolean NOT NULL DEFAULT true,
  notify_recurring boolean NOT NULL DEFAULT true,
  notify_purchases boolean NOT NULL DEFAULT true,
  notify_goals boolean NOT NULL DEFAULT true,
  notify_partner_changes boolean NOT NULL DEFAULT true,
  digest_mode text NOT NULL DEFAULT 'off' CHECK (digest_mode IN ('off','daily','weekly')),
  digest_time time NOT NULL DEFAULT '09:00',
  timezone text NOT NULL DEFAULT 'Europe/Moscow',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_links TO authenticated, service_role;
DROP POLICY IF EXISTS "tl_select" ON public.telegram_links;
CREATE POLICY "tl_select" ON public.telegram_links
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.id = telegram_links.family_member_id AND fm.user_id = auth.uid()));
DROP POLICY IF EXISTS "tl_insert" ON public.telegram_links;
CREATE POLICY "tl_insert" ON public.telegram_links
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.id = telegram_links.family_member_id AND fm.user_id = auth.uid()));
DROP POLICY IF EXISTS "tl_update" ON public.telegram_links;
CREATE POLICY "tl_update" ON public.telegram_links
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.id = telegram_links.family_member_id AND fm.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.id = telegram_links.family_member_id AND fm.user_id = auth.uid()));
DROP POLICY IF EXISTS "tl_delete" ON public.telegram_links;
CREATE POLICY "tl_delete" ON public.telegram_links
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.id = telegram_links.family_member_id AND fm.user_id = auth.uid()));

-- Triggers
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_transactions_updated_at ON public.transactions;
CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.recompute_goal_saved()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g_id uuid;
BEGIN
  g_id := COALESCE(NEW.goal_id, OLD.goal_id);
  IF g_id IS NOT NULL THEN
    UPDATE public.goals SET saved_kopecks = COALESCE((SELECT COALESCE(SUM(amount_kopecks),0) FROM public.goal_contributions WHERE goal_id = g_id),0) WHERE id = g_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_gc_recompute ON public.goal_contributions;
CREATE TRIGGER trg_gc_recompute
  AFTER INSERT OR UPDATE OR DELETE ON public.goal_contributions
  FOR EACH ROW EXECUTE FUNCTION public.recompute_goal_saved();
