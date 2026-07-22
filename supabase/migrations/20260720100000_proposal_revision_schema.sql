-- Phase 3B.1: Proposal Revision / New Version Flow — schema-level prep.
--
-- No new tables. Two changes:
--
-- 1. crm_activities.activity_type gains 'proposal_revision_created' (same
--    defensive drop + re-add pattern as every prior phase — see
--    20260718100000_proposal_client_responses_schema.sql).
--
-- 2. A real latent gap, found while designing create_proposal_revision()
--    below: prevent_locked_proposal_version_mutation() and
--    prevent_locked_version_child_mutation() (both from
--    20260706140300_proposal_versions.sql, Phase 2A) only ever protected a
--    version/its children while version_status = 'locked'. The instant a
--    version transitions to 'superseded' (the terminal state a version
--    reaches once a revision replaces it — see create_proposal_revision()),
--    BOTH triggers stop firing for that row entirely, since their guard
--    conditions check `old.version_status = 'locked'` specifically. This was
--    never exercised before this phase — create_new_proposal_version()
--    (2A's dormant "architecture prep for sending," never exposed in any
--    UI) is the only prior code path that ever produced a 'superseded' row,
--    and nothing ever tried to mutate one afterward. Phase 3B.1 makes
--    'superseded' a real, live, reachable state via the contractor-facing
--    revision flow, so this gap is now worth closing: both functions are
--    forward-fixed (CREATE OR REPLACE, same signatures/return shapes,
--    originals never edited) to treat 'locked' and 'superseded' identically
--    — both are terminal, immutable states; the only legal transition
--    between them is locked -> superseded itself, which both functions
--    still explicitly allow.
do $$
begin
  begin
    alter table public.crm_activities drop constraint crm_activities_activity_type_check;
  exception when undefined_object then
    execute (
      select format('alter table public.crm_activities drop constraint %I', conname)
      from pg_constraint
      where conrelid = 'public.crm_activities'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%activity_type = ANY%'
      limit 1
    );
  end;
end $$;

alter table public.crm_activities add constraint crm_activities_activity_type_check check (activity_type in (
  'note_added', 'call_logged', 'email_logged', 'meeting_logged',
  'inspection_scheduled', 'status_changed',
  'client_created', 'client_archived', 'client_restored',
  'contact_created', 'contact_primary_changed', 'contact_archived', 'contact_restored',
  'opportunity_created', 'opportunity_won', 'opportunity_lost',
  'opportunity_archived', 'opportunity_restored', 'opportunity_converted_to_project',
  'project_created', 'project_archived', 'project_restored',
  'address_primary_changed',
  'proposal_created', 'proposal_marked_ready', 'proposal_returned_to_draft',
  'proposal_archived', 'proposal_restored', 'proposal_media_attached',
  'portfolio_project_attached',
  'client_portal_link_created', 'client_portal_link_revoked', 'proposal_viewed_by_client',
  'proposal_accepted_by_client', 'proposal_declined_by_client',
  'proposal_revision_created'
));

create or replace function public.prevent_locked_proposal_version_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.version_status in ('locked', 'superseded') then
    -- Allow only version_status itself to change (locked -> superseded),
    -- and allow updated_at/current housekeeping columns; reject any change
    -- to commercial content, from either terminal state.
    if new.version_status not in ('locked', 'superseded') then
      raise exception 'Cannot modify a locked proposal version''s status to %', new.version_status using errcode = '55000';
    end if;
    if new.summary is distinct from old.summary
      or new.scope_intro is distinct from old.scope_intro
      or new.estimated_start_date is distinct from old.estimated_start_date
      or new.estimated_duration_days is distinct from old.estimated_duration_days
      or new.default_hours_per_day is distinct from old.default_hours_per_day
      or new.terms is distinct from old.terms
      or new.exclusions is distinct from old.exclusions
      or new.notes_for_client is distinct from old.notes_for_client
      or new.discount_type is distinct from old.discount_type
      or new.discount_value is distinct from old.discount_value
      or new.tax_rate_bps is distinct from old.tax_rate_bps
      or new.labor_total_cents is distinct from old.labor_total_cents
      or new.line_items_subtotal_cents is distinct from old.line_items_subtotal_cents
      or new.subtotal_cents is distinct from old.subtotal_cents
      or new.discount_cents is distinct from old.discount_cents
      or new.taxable_subtotal_cents is distinct from old.taxable_subtotal_cents
      or new.tax_cents is distinct from old.tax_cents
      or new.total_cents is distinct from old.total_cents
    then
      raise exception 'A locked or superseded proposal version is immutable' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.prevent_locked_version_child_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_version_id uuid;
  v_status text;
begin
  if tg_op = 'DELETE' then
    v_version_id := old.proposal_version_id;
  else
    v_version_id := new.proposal_version_id;
  end if;

  select version_status into v_status from public.proposal_versions where id = v_version_id;
  if v_status in ('locked', 'superseded') then
    raise exception 'Cannot modify children of a locked or superseded proposal version' using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
