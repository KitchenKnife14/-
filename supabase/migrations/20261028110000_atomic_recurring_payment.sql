-- Confirm a recurring payment atomically: advance schedule and create transaction
-- in one database transaction. The expected due date makes repeated clicks idempotent.
CREATE OR REPLACE FUNCTION public.confirm_recurring_payment(
  p_recurring_id uuid,
  p_expected_due_date date,
  p_operation_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.recurring_payments%ROWTYPE;
  v_next_due date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация';
  END IF;

  SELECT *
    INTO v_payment
    FROM public.recurring_payments
   WHERE id = p_recurring_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Регулярный платёж не найден';
  END IF;

  IF v_payment.family_id IS DISTINCT FROM public.current_family_id() THEN
    RAISE EXCEPTION 'Нет доступа к этому семейному бюджету';
  END IF;

  IF NOT v_payment.active THEN
    RAISE EXCEPTION 'Регулярный платёж приостановлен';
  END IF;

  IF v_payment.next_due_date <> p_expected_due_date THEN
    RAISE EXCEPTION 'Этот платёж уже подтверждён или его дата изменилась. Обновите список.';
  END IF;

  v_next_due := CASE v_payment.frequency
    WHEN 'daily' THEN v_payment.next_due_date + 1
    WHEN 'weekly' THEN v_payment.next_due_date + 7
    WHEN 'monthly' THEN (v_payment.next_due_date + INTERVAL '1 month')::date
    WHEN 'yearly' THEN (v_payment.next_due_date + INTERVAL '1 year')::date
    WHEN 'custom' THEN v_payment.next_due_date + GREATEST(COALESCE(v_payment.custom_interval_days, 30), 1)
    ELSE v_payment.next_due_date + 30
  END;

  INSERT INTO public.transactions (
    family_id, type, amount_kopecks, operation_date, category_id,
    account_id, description, planned, created_by, parent_recurring_id
  ) VALUES (
    v_payment.family_id, v_payment.type, v_payment.amount_kopecks, p_operation_date,
    v_payment.category_id, v_payment.account_id, v_payment.description,
    false, auth.uid(), v_payment.id
  );

  UPDATE public.recurring_payments
     SET next_due_date = v_next_due,
         active = (end_date IS NULL OR v_next_due <= end_date)
   WHERE id = v_payment.id;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_recurring_payment(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_recurring_payment(uuid, date, date) TO authenticated;
