-- Keep account links and transfer semantics consistent in the Supabase backend.
-- This migration is intentionally additive; it does not rewrite existing transactions.

CREATE OR REPLACE FUNCTION public.validate_financial_account_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'transactions' THEN
    IF NEW.type = 'transfer' THEN
      IF NEW.account_id IS NULL OR NEW.to_account_id IS NULL OR NEW.account_id = NEW.to_account_id THEN
        RAISE EXCEPTION 'Для перевода нужны два разных счёта';
      END IF;
    ELSIF NEW.to_account_id IS NOT NULL THEN
      RAISE EXCEPTION 'Счёт зачисления допустим только для перевода';
    END IF;

    IF NEW.account_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.accounts a
      WHERE a.id = NEW.account_id AND a.family_id = NEW.family_id
    ) THEN
      RAISE EXCEPTION 'Счёт списания не найден в этой семье';
    END IF;

    IF NEW.to_account_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.accounts a
      WHERE a.id = NEW.to_account_id AND a.family_id = NEW.family_id
    ) THEN
      RAISE EXCEPTION 'Счёт зачисления не найден в этой семье';
    END IF;

    IF NEW.category_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.categories c
      WHERE c.id = NEW.category_id AND c.family_id = NEW.family_id
    ) THEN
      RAISE EXCEPTION 'Категория не найдена в этой семье';
    END IF;

    IF NEW.parent_recurring_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.recurring_payments r
      WHERE r.id = NEW.parent_recurring_id AND r.family_id = NEW.family_id
    ) THEN
      RAISE EXCEPTION 'Регулярный платёж не найден в этой семье';
    END IF;
  ELSIF TG_TABLE_NAME = 'recurring_payments' THEN
    IF NEW.type = 'transfer' THEN
      RAISE EXCEPTION 'Регулярные переводы пока не поддерживаются';
    END IF;

    IF NEW.account_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.accounts a
      WHERE a.id = NEW.account_id AND a.family_id = NEW.family_id
    ) THEN
      RAISE EXCEPTION 'Счёт не найден в этой семье';
    END IF;

    IF NEW.category_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.categories c
      WHERE c.id = NEW.category_id AND c.family_id = NEW.family_id
    ) THEN
      RAISE EXCEPTION 'Категория не найдена в этой семье';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_transaction_account_links ON public.transactions;
CREATE TRIGGER trg_validate_transaction_account_links
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.validate_financial_account_links();

DROP TRIGGER IF EXISTS trg_validate_recurring_account_links ON public.recurring_payments;
CREATE TRIGGER trg_validate_recurring_account_links
  BEFORE INSERT OR UPDATE ON public.recurring_payments
  FOR EACH ROW EXECUTE FUNCTION public.validate_financial_account_links();

CREATE OR REPLACE FUNCTION public.prevent_deleting_used_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.account_id = OLD.id OR t.to_account_id = OLD.id
  ) OR EXISTS (
    SELECT 1 FROM public.recurring_payments r
    WHERE r.account_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Счёт используется в истории. Архивируйте его вместо удаления.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_deleting_used_account ON public.accounts;
CREATE TRIGGER trg_prevent_deleting_used_account
  BEFORE DELETE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_deleting_used_account();
