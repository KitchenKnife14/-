-- Secure family joining: invite-code lookup and membership insertion happen atomically.
-- Users may add themselves directly only to a family they just created.
DROP POLICY IF EXISTS "fm_insert_member" ON public.family_members;
DROP POLICY IF EXISTS "fm_insert" ON public.family_members;
CREATE POLICY "fm_insert_creator" ON public.family_members
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.families f
      WHERE f.id = family_members.family_id
        AND f.created_by = auth.uid()
    )
  );

-- Avoid recursive RLS evaluation on family_members by using the SECURITY DEFINER helper.
DROP POLICY IF EXISTS "fm_select_member" ON public.family_members;
CREATE POLICY "fm_select_member" ON public.family_members
  FOR SELECT TO authenticated
  USING (family_id = public.current_family_id());

-- Membership roles are not editable directly by ordinary family members.
DROP POLICY IF EXISTS "fm_update_member" ON public.family_members;

CREATE OR REPLACE FUNCTION public.join_family_by_invite(p_invite_code text)
RETURNS TABLE (family_id uuid, family_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_family public.families%ROWTYPE;
  member_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.family_members fm
    WHERE fm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Ваш аккаунт уже состоит в семье';
  END IF;

  SELECT f.* INTO target_family
  FROM public.families f
  WHERE f.invite_code = upper(trim(p_invite_code))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Семья с таким кодом не найдена. Проверьте код приглашения.';
  END IF;

  SELECT count(*) INTO member_count
  FROM public.family_members fm
  WHERE fm.family_id = target_family.id;

  IF member_count >= 2 THEN
    RAISE EXCEPTION 'В этой семье уже два участника. Дополнительные приглашения недоступны.';
  END IF;

  INSERT INTO public.family_members (family_id, user_id, role)
  VALUES (target_family.id, auth.uid(), 'member');

  RETURN QUERY SELECT target_family.id, target_family.name;
END;
$$;

REVOKE ALL ON FUNCTION public.join_family_by_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_family_by_invite(text) TO authenticated;

-- Foreign keys use ON DELETE SET NULL, so their columns must permit NULL values.
ALTER TABLE public.transactions ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.recurring_payments ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.goal_contributions ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.planned_purchases ALTER COLUMN created_by DROP NOT NULL;
