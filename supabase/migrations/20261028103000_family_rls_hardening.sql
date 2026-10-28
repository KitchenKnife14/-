-- Idempotent hardening follow-up for installations that already applied the initial
-- secure-family-invites migration before its RLS/FK corrections were finalized.
DROP POLICY IF EXISTS "fm_insert_member" ON public.family_members;
DROP POLICY IF EXISTS "fm_insert" ON public.family_members;
DROP POLICY IF EXISTS "fm_insert_creator" ON public.family_members;
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

DROP POLICY IF EXISTS "fm_select_member" ON public.family_members;
CREATE POLICY "fm_select_member" ON public.family_members
  FOR SELECT TO authenticated
  USING (family_id = public.current_family_id());

DROP POLICY IF EXISTS "fm_update_member" ON public.family_members;

ALTER TABLE public.transactions ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.recurring_payments ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.goal_contributions ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.planned_purchases ALTER COLUMN created_by DROP NOT NULL;
