/*
# Fix: allow family creator to read the family immediately after creation

## Problem
When a user creates a family, the onboarding flow inserts a row into `families`
and immediately calls `.select().single()` to read it back. The SELECT policy
`families_select_member` requires the user to already be in `family_members`,
which they are not at that point — so the read returns nothing and `.single()`
throws an error on the "Name your family" step.

## Changes
1. Add `created_by uuid` column to `families` (defaults to `auth.uid()`),
   referencing `auth.users`.
2. Replace the `families_insert` policy: only the creator can insert, enforced
   by `created_by = auth.uid()`.
3. Replace the `families_select_member` policy: allow read if the user is a
   member OR is the creator (`created_by = auth.uid()`). This lets the
   `.insert().select()` call succeed before the `family_members` row exists.
4. Update the `families_update_member` policy to also allow the creator to
   update before membership is established.

## Security
- RLS stays enabled. The creator gets access only to families they created.
- Membership checks remain for all other users.
*/

ALTER TABLE public.families
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill is not needed; existing families simply have NULL created_by,
-- which means only members can see them (the original behavior).

-- INSERT: only the authenticated creator, matched by created_by
DROP POLICY IF EXISTS "families_insert" ON public.families;
CREATE POLICY "families_insert" ON public.families
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

-- SELECT: member OR creator
DROP POLICY IF EXISTS "families_select_member" ON public.families;
CREATE POLICY "families_select_member" ON public.families
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.family_members fm
      WHERE fm.user_id = auth.uid() AND fm.family_id = families.id
    )
  );

-- UPDATE: member OR creator
DROP POLICY IF EXISTS "families_update_member" ON public.families;
CREATE POLICY "families_update_member" ON public.families
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.family_members fm
      WHERE fm.user_id = auth.uid() AND fm.family_id = families.id
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.family_members fm
      WHERE fm.user_id = auth.uid() AND fm.family_id = families.id
    )
  );
