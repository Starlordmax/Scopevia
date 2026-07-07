-- Phase 2A: Proposal-centric pivot — minimal, additive change to the existing
-- opportunity pipeline (see docs/31-proposal-state-machines.md and
-- docs/adr/0025-proposal-before-project.md).
--
-- Adds exactly ONE new status, `proposal_in_progress`, reachable from
-- `qualified`/`inspection_scheduled`/`ready_for_estimate` (an opportunity can
-- start a proposal at any of those points — the brief's recommended flow is
-- new -> contacted -> qualified -> proposal_in_progress, but an opportunity
-- that already went through inspection under the Phase 1 flow must not be
-- blocked from also getting a proposal). `inspection_scheduled` and
-- `ready_for_estimate` are deliberately KEPT, not replaced, even though the
-- brief's own "recommended" list omits them — removing them would break
-- Phase 1's existing E2E/RLS coverage and existing data with no compatibility
-- migration, which section 7 of the brief explicitly forbids. This is the
-- "minimal modification, documented" path the brief asks for when its
-- suggestion conflicts with "do not break existing behavior."
--
-- `proposal_sent` and a proposal-driven `won` are intentionally NOT added
-- yet: no function in Phase 2A can reach them (sending/acceptance don't
-- exist until a later phase), and this project's established pattern (see
-- ADR 0012) is to not add status values no code path can reach. They will be
-- added in the phase that actually implements sending/acceptance.

do $$
begin
  begin
    alter table public.opportunities drop constraint opportunities_status_check;
  exception when undefined_object then
    execute (
      select format('alter table public.opportunities drop constraint %I', conname)
      from pg_constraint
      where conrelid = 'public.opportunities'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%status = ANY%'
      limit 1
    );
  end;
end $$;

alter table public.opportunities add constraint opportunities_status_check check (
  status in (
    'new', 'contacted', 'qualified', 'inspection_scheduled', 'ready_for_estimate',
    'proposal_in_progress', 'won', 'lost', 'archived'
  )
);

-- Extend the transition table: qualified/inspection_scheduled/ready_for_estimate
-- can all move into proposal_in_progress; from there, back to qualified or
-- to lost (same lost_reason requirement as every other lost transition).
-- Archiving a proposal_in_progress opportunity still requires moving it to
-- won/lost first, unchanged from Phase 1 — see archive_opportunity().
create or replace function public.change_opportunity_status(
  p_opportunity_id uuid,
  p_new_status text,
  p_lost_reason text default null,
  p_inspection_scheduled_at timestamptz default null
)
returns public.opportunities
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.opportunities;
  v_result public.opportunities;
  v_valid_transition boolean;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.opportunities where id = p_opportunity_id;
  if not found then
    raise exception 'Opportunity not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'opportunities.change_status') then
    raise exception 'Missing permission: opportunities.change_status' using errcode = '42501';
  end if;

  if v_row.status = p_new_status then
    return v_row; -- idempotent no-op
  end if;

  select exists (
    select 1 from (values
      ('new', 'contacted'), ('new', 'lost'),
      ('contacted', 'qualified'), ('contacted', 'lost'),
      ('qualified', 'inspection_scheduled'), ('qualified', 'ready_for_estimate'), ('qualified', 'proposal_in_progress'), ('qualified', 'lost'),
      ('inspection_scheduled', 'qualified'), ('inspection_scheduled', 'ready_for_estimate'), ('inspection_scheduled', 'proposal_in_progress'), ('inspection_scheduled', 'lost'),
      ('ready_for_estimate', 'qualified'), ('ready_for_estimate', 'proposal_in_progress'), ('ready_for_estimate', 'won'), ('ready_for_estimate', 'lost'),
      ('proposal_in_progress', 'qualified'), ('proposal_in_progress', 'lost'),
      ('lost', 'contacted'), ('lost', 'qualified')
    ) as t(from_status, to_status)
    where t.from_status = v_row.status and t.to_status = p_new_status
  ) into v_valid_transition;

  if not v_valid_transition then
    raise exception 'Invalid transition: % -> % (archiving/restoring a won or lost opportunity uses archive_opportunity()/restore_opportunity() instead)', v_row.status, p_new_status
      using errcode = '22023';
  end if;

  if p_new_status = 'lost' and (p_lost_reason is null or btrim(p_lost_reason) = '') then
    raise exception 'lost_reason is required when marking an opportunity as lost' using errcode = '22023';
  end if;

  if p_new_status = 'inspection_scheduled' and p_inspection_scheduled_at is null then
    raise exception 'inspection_scheduled_at is required for this transition' using errcode = '22023';
  end if;

  update public.opportunities
     set status = p_new_status,
         -- lost_reason is deliberately preserved (not cleared) when leaving
         -- 'lost' — see docs/adr/0011-opportunity-state-machine-for-phase-1.md.
         lost_reason = case when p_new_status = 'lost' then btrim(p_lost_reason) else lost_reason end,
         inspection_scheduled_at = case when p_new_status = 'inspection_scheduled' then p_inspection_scheduled_at else inspection_scheduled_at end
   where id = p_opportunity_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'opportunity.status_changed', 'opportunity', p_opportunity_id,
    jsonb_build_object('from_status', v_row.status, 'to_status', p_new_status));
  perform public.log_crm_activity(v_row.tenant_id, v_row.client_id, p_opportunity_id, null,
    case p_new_status
      when 'won' then 'opportunity_won'
      when 'lost' then 'opportunity_lost'
      when 'inspection_scheduled' then 'inspection_scheduled'
      else 'status_changed'
    end,
    v_user_id,
    jsonb_build_object('from_status', v_row.status, 'to_status', p_new_status));

  return v_result;
end;
$$;

comment on function public.change_opportunity_status(uuid, text, text, timestamptz) is
  'Enforces the opportunity pipeline transition table server-side — the ONLY way to change opportunities.status. Phase 2A adds proposal_in_progress as a reachable status (from qualified/inspection_scheduled/ready_for_estimate); proposal_sent/won-via-proposal are deliberately not yet reachable — see migration header.';

-- Extend crm_activities.activity_type with the new proposal-facing events
-- (docs/31, section "Auditoría y actividad"). Same defensive drop pattern as
-- above, applied to the activity_type CHECK.
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
  'portfolio_project_attached'
));
