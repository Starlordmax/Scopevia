-- Phase 1: CRM & Projects — opportunity mutation functions & state machine
--
-- Three DISTINCT permissions gate three DISTINCT operations, matching
-- docs/20-phase-1-crm-and-projects.md's permission matrix exactly:
--   * opportunities.change_status — ordinary pipeline movement (new through
--     won/lost), available to Sales/Estimator.
--   * opportunities.archive / opportunities.restore — the won/lost <-> archived
--     transition specifically, Owner/Admin only. Kept separate from
--     change_opportunity_status() rather than folded in, because it is a
--     genuinely different authorization tier, not just another pipeline step.
-- See docs/22-phase-1-state-machines.md for the full transition table and the
-- rationale for every included/excluded transition.

create or replace function public.create_opportunity(
  p_tenant_id uuid,
  p_client_id uuid,
  p_title text,
  p_source text default null,
  p_estimated_value_cents bigint default null,
  p_probability int default null,
  p_expected_close_date date default null,
  p_assigned_to uuid default null
)
returns public.opportunities
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_client public.clients;
  v_opportunity public.opportunities;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.user_has_permission(p_tenant_id, 'opportunities.create') then
    raise exception 'Missing permission: opportunities.create' using errcode = '42501';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'Title is required' using errcode = '22023';
  end if;

  select * into v_client from public.clients where id = p_client_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'Client not found in this tenant' using errcode = 'P0002';
  end if;

  if p_assigned_to is not null and not public.is_active_member_of_tenant(p_assigned_to, p_tenant_id) then
    raise exception 'Assignee must be an active member of this tenant' using errcode = '22023';
  end if;

  insert into public.opportunities (
    tenant_id, client_id, title, source, estimated_value_cents, probability, expected_close_date, assigned_to, created_by
  )
  values (
    p_tenant_id, p_client_id, btrim(p_title), p_source, p_estimated_value_cents, p_probability, p_expected_close_date, p_assigned_to, v_user_id
  )
  returning * into v_opportunity;

  perform public.log_audit_event(p_tenant_id, v_user_id, 'opportunity.created', 'opportunity', v_opportunity.id,
    jsonb_build_object('title', v_opportunity.title));
  perform public.log_crm_activity(p_tenant_id, p_client_id, v_opportunity.id, null, 'opportunity_created', v_user_id,
    jsonb_build_object('title', v_opportunity.title));

  return v_opportunity;
end;
$$;

comment on function public.create_opportunity(uuid, uuid, text, text, bigint, int, date, uuid) is
  'Creates an opportunity in status=new. Client must already exist in the same tenant — creating a client inline is a separate create_client() call from the UI, not bundled here.';

create or replace function public.update_opportunity(
  p_opportunity_id uuid,
  p_title text,
  p_source text,
  p_estimated_value_cents bigint,
  p_probability int,
  p_expected_close_date date,
  p_assigned_to uuid
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
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.opportunities where id = p_opportunity_id;
  if not found then
    raise exception 'Opportunity not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'opportunities.update') then
    raise exception 'Missing permission: opportunities.update' using errcode = '42501';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'Title is required' using errcode = '22023';
  end if;

  if p_assigned_to is not null and not public.is_active_member_of_tenant(p_assigned_to, v_row.tenant_id) then
    raise exception 'Assignee must be an active member of this tenant' using errcode = '22023';
  end if;

  update public.opportunities
     set title = btrim(p_title),
         source = p_source,
         estimated_value_cents = p_estimated_value_cents,
         probability = p_probability,
         expected_close_date = p_expected_close_date,
         assigned_to = p_assigned_to
   where id = p_opportunity_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'opportunity.updated', 'opportunity', p_opportunity_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.update_opportunity(uuid, text, text, bigint, int, date, uuid) is
  'Replaces an opportunity''s editable fields. Never touches status/client_id — use change_opportunity_status() for status, and re-create for a different client.';

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
      ('qualified', 'inspection_scheduled'), ('qualified', 'ready_for_estimate'), ('qualified', 'lost'),
      ('inspection_scheduled', 'qualified'), ('inspection_scheduled', 'ready_for_estimate'), ('inspection_scheduled', 'lost'),
      ('ready_for_estimate', 'qualified'), ('ready_for_estimate', 'won'), ('ready_for_estimate', 'lost'),
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
  'Enforces the Phase 1 opportunity pipeline transition table server-side — the ONLY way to change opportunities.status. Rejects any transition not in the explicit allow-list, including archived/won/lost boundary cases (see archive_opportunity()/restore_opportunity()).';

create or replace function public.archive_opportunity(p_opportunity_id uuid)
returns public.opportunities
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.opportunities;
  v_result public.opportunities;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.opportunities where id = p_opportunity_id;
  if not found then
    raise exception 'Opportunity not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'opportunities.archive') then
    raise exception 'Missing permission: opportunities.archive' using errcode = '42501';
  end if;

  if v_row.status = 'archived' then
    return v_row;
  end if;

  if v_row.status not in ('won', 'lost') then
    raise exception 'Only a won or lost opportunity can be archived (move it to won or lost first)' using errcode = '22023';
  end if;

  update public.opportunities
     set status = 'archived',
         pre_archive_status = v_row.status,
         archived_at = now(),
         archived_by = v_user_id
   where id = p_opportunity_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'opportunity.archived', 'opportunity', p_opportunity_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.archive_opportunity(uuid) is
  'Archives a won or lost opportunity. Distinct permission (opportunities.archive) from ordinary pipeline movement — Owner/Admin only per the Phase 1 role matrix.';

create or replace function public.restore_opportunity(p_opportunity_id uuid)
returns public.opportunities
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.opportunities;
  v_result public.opportunities;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.opportunities where id = p_opportunity_id;
  if not found then
    raise exception 'Opportunity not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'opportunities.restore') then
    raise exception 'Missing permission: opportunities.restore' using errcode = '42501';
  end if;

  if v_row.status <> 'archived' then
    return v_row;
  end if;

  update public.opportunities
     set status = v_row.pre_archive_status,
         pre_archive_status = null,
         archived_at = null,
         archived_by = null
   where id = p_opportunity_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'opportunity.restored', 'opportunity', p_opportunity_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.restore_opportunity(uuid) is
  'Restores an archived opportunity to whichever of won/lost it was before archiving.';

-- =============================================================================
-- Grants
-- =============================================================================

revoke execute on function public.create_opportunity(uuid, uuid, text, text, bigint, int, date, uuid) from public;
grant execute on function public.create_opportunity(uuid, uuid, text, text, bigint, int, date, uuid) to authenticated;

revoke execute on function public.update_opportunity(uuid, text, text, bigint, int, date, uuid) from public;
grant execute on function public.update_opportunity(uuid, text, text, bigint, int, date, uuid) to authenticated;

revoke execute on function public.change_opportunity_status(uuid, text, text, timestamptz) from public;
grant execute on function public.change_opportunity_status(uuid, text, text, timestamptz) to authenticated;

revoke execute on function public.archive_opportunity(uuid) from public;
grant execute on function public.archive_opportunity(uuid) to authenticated;

revoke execute on function public.restore_opportunity(uuid) from public;
grant execute on function public.restore_opportunity(uuid) to authenticated;
