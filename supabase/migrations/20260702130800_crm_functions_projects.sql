-- Phase 1: CRM & Projects — project mutation functions & conversion
--
-- Project state machine (see docs/22-phase-1-state-machines.md and
-- docs/adr/0012-project-state-machine-for-phase-1.md): draft, inspection_pending,
-- inspection_completed, ready_for_estimate, cancelled, archived. Same
-- change_status/archive/restore permission split as opportunities.

create or replace function public.create_project(
  p_tenant_id uuid,
  p_client_id uuid,
  p_name text,
  p_service_type text default null,
  p_description text default null,
  p_assigned_to uuid default null,
  p_tentative_start_date date default null
)
returns public.projects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_client public.clients;
  v_project public.projects;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.user_has_permission(p_tenant_id, 'projects.create') then
    raise exception 'Missing permission: projects.create' using errcode = '42501';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Project name is required' using errcode = '22023';
  end if;

  select * into v_client from public.clients where id = p_client_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'Client not found in this tenant' using errcode = 'P0002';
  end if;

  if p_assigned_to is not null and not public.is_active_member_of_tenant(p_assigned_to, p_tenant_id) then
    raise exception 'Assignee must be an active member of this tenant' using errcode = '22023';
  end if;

  insert into public.projects (tenant_id, client_id, name, service_type, description, assigned_to, tentative_start_date, created_by)
  values (p_tenant_id, p_client_id, btrim(p_name), p_service_type, p_description, p_assigned_to, p_tentative_start_date, v_user_id)
  returning * into v_project;

  perform public.log_audit_event(p_tenant_id, v_user_id, 'project.created', 'project', v_project.id,
    jsonb_build_object('name', v_project.name));
  perform public.log_crm_activity(p_tenant_id, p_client_id, null, v_project.id, 'project_created', v_user_id,
    jsonb_build_object('name', v_project.name));

  return v_project;
end;
$$;

comment on function public.create_project(uuid, uuid, text, text, text, uuid, date) is
  'Creates a project directly (not from an opportunity) in status=draft. Never auto-promoted to any other status on creation.';

create or replace function public.update_project(
  p_project_id uuid,
  p_name text,
  p_service_type text,
  p_description text,
  p_assigned_to uuid,
  p_tentative_start_date date,
  p_primary_contact_id uuid default null
)
returns public.projects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.projects;
  v_result public.projects;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.projects where id = p_project_id;
  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'projects.update') then
    raise exception 'Missing permission: projects.update' using errcode = '42501';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Project name is required' using errcode = '22023';
  end if;

  if p_assigned_to is not null and not public.is_active_member_of_tenant(p_assigned_to, v_row.tenant_id) then
    raise exception 'Assignee must be an active member of this tenant' using errcode = '22023';
  end if;

  if p_primary_contact_id is not null and not exists (
    select 1 from public.client_contacts where id = p_primary_contact_id and client_id = v_row.client_id
  ) then
    raise exception 'Primary contact must belong to this project''s client' using errcode = '22023';
  end if;

  update public.projects
     set name = btrim(p_name),
         service_type = p_service_type,
         description = p_description,
         assigned_to = p_assigned_to,
         tentative_start_date = p_tentative_start_date,
         primary_contact_id = p_primary_contact_id
   where id = p_project_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'project.updated', 'project', p_project_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.update_project(uuid, text, text, text, uuid, date, uuid) is
  'Replaces a project''s editable fields. primary_contact_id must belong to the same client as the project (checked explicitly — the composite FK only guarantees same tenant, not same client).';

create or replace function public.change_project_status(
  p_project_id uuid,
  p_new_status text,
  p_inspection_scheduled_at timestamptz default null
)
returns public.projects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.projects;
  v_result public.projects;
  v_valid_transition boolean;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.projects where id = p_project_id;
  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'projects.update') then
    raise exception 'Missing permission: projects.update' using errcode = '42501';
  end if;

  if v_row.status = p_new_status then
    return v_row;
  end if;

  select exists (
    select 1 from (values
      ('draft', 'inspection_pending'), ('draft', 'cancelled'),
      ('inspection_pending', 'inspection_completed'), ('inspection_pending', 'cancelled'),
      ('inspection_completed', 'ready_for_estimate'), ('inspection_completed', 'inspection_pending'), ('inspection_completed', 'cancelled'),
      ('ready_for_estimate', 'inspection_completed'), ('ready_for_estimate', 'cancelled'),
      ('cancelled', 'draft')
    ) as t(from_status, to_status)
    where t.from_status = v_row.status and t.to_status = p_new_status
  ) into v_valid_transition;

  if not v_valid_transition then
    raise exception 'Invalid transition: % -> % (archiving/restoring uses archive_project()/restore_project() instead)', v_row.status, p_new_status
      using errcode = '22023';
  end if;

  if p_new_status = 'inspection_pending' and p_inspection_scheduled_at is null then
    raise exception 'inspection_scheduled_at is required for this transition' using errcode = '22023';
  end if;

  update public.projects
     set status = p_new_status,
         inspection_scheduled_at = case when p_new_status = 'inspection_pending' then p_inspection_scheduled_at else inspection_scheduled_at end
   where id = p_project_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'project.updated', 'project', p_project_id,
    jsonb_build_object('from_status', v_row.status, 'to_status', p_new_status));
  perform public.log_crm_activity(v_row.tenant_id, v_row.client_id, null, p_project_id,
    case when p_new_status = 'inspection_pending' then 'inspection_scheduled' else 'status_changed' end,
    v_user_id, jsonb_build_object('from_status', v_row.status, 'to_status', p_new_status));

  return v_result;
end;
$$;

comment on function public.change_project_status(uuid, text, timestamptz) is
  'Enforces the Phase 1 project status transition table server-side.';

create or replace function public.archive_project(p_project_id uuid)
returns public.projects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.projects;
  v_result public.projects;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.projects where id = p_project_id;
  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'projects.archive') then
    raise exception 'Missing permission: projects.archive' using errcode = '42501';
  end if;

  if v_row.status = 'archived' then
    return v_row;
  end if;

  if v_row.status not in ('cancelled', 'ready_for_estimate') then
    raise exception 'Only a cancelled or ready_for_estimate project can be archived' using errcode = '22023';
  end if;

  update public.projects
     set status = 'archived', pre_archive_status = v_row.status, archived_at = now(), archived_by = v_user_id
   where id = p_project_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'project.archived', 'project', p_project_id, '{}'::jsonb);
  perform public.log_crm_activity(v_row.tenant_id, v_row.client_id, null, p_project_id, 'project_archived', v_user_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.archive_project(uuid) is
  'Archives a cancelled or ready_for_estimate project. Does not cascade to project_addresses/notes.';

create or replace function public.restore_project(p_project_id uuid)
returns public.projects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.projects;
  v_result public.projects;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.projects where id = p_project_id;
  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'projects.restore') then
    raise exception 'Missing permission: projects.restore' using errcode = '42501';
  end if;

  if v_row.status <> 'archived' then
    return v_row;
  end if;

  update public.projects
     set status = v_row.pre_archive_status, pre_archive_status = null, archived_at = null, archived_by = null
   where id = p_project_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'project.restored', 'project', p_project_id, '{}'::jsonb);
  perform public.log_crm_activity(v_row.tenant_id, v_row.client_id, null, p_project_id, 'project_restored', v_user_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.restore_project(uuid) is 'Restores an archived project to its pre-archive status.';

-- =============================================================================
-- Opportunity -> Project conversion (atomic, idempotent)
-- =============================================================================

create or replace function public.convert_opportunity_to_project(
  p_opportunity_id uuid,
  p_project_name text default null,
  p_service_type text default null,
  p_description text default null
)
returns public.projects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_opportunity public.opportunities;
  v_existing_project public.projects;
  v_project public.projects;
  v_primary_contact_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_opportunity from public.opportunities where id = p_opportunity_id;
  if not found then
    raise exception 'Opportunity not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_opportunity.tenant_id, 'opportunities.convert_to_project') then
    raise exception 'Missing permission: opportunities.convert_to_project' using errcode = '42501';
  end if;

  -- Lock the opportunity row so two concurrent conversion attempts serialize
  -- rather than race to insert; the projects_opportunity_id_key unique index
  -- (plus the exception handler below) is the final safety net regardless.
  perform 1 from public.opportunities where id = p_opportunity_id for update;

  select * into v_existing_project from public.projects where opportunity_id = p_opportunity_id;
  if found then
    return v_existing_project; -- idempotent: reuse the existing conversion
  end if;

  if v_opportunity.status not in ('ready_for_estimate', 'won') then
    raise exception 'Opportunity must be ready_for_estimate or won before converting to a project' using errcode = '22023';
  end if;

  select id into v_primary_contact_id
  from public.client_contacts
  where client_id = v_opportunity.client_id and is_primary = true and archived_at is null
  limit 1;

  insert into public.projects (
    tenant_id, client_id, opportunity_id, primary_contact_id, name, service_type, description, assigned_to, created_by
  )
  values (
    v_opportunity.tenant_id, v_opportunity.client_id, p_opportunity_id, v_primary_contact_id,
    coalesce(nullif(btrim(coalesce(p_project_name, '')), ''), v_opportunity.title),
    p_service_type, p_description, v_opportunity.assigned_to, v_user_id
  )
  returning * into v_project;

  perform public.log_audit_event(v_opportunity.tenant_id, v_user_id, 'opportunity.converted_to_project', 'opportunity', p_opportunity_id,
    jsonb_build_object('project_id', v_project.id));
  perform public.log_audit_event(v_opportunity.tenant_id, v_user_id, 'project.created', 'project', v_project.id,
    jsonb_build_object('opportunity_id', p_opportunity_id));
  perform public.log_crm_activity(v_opportunity.tenant_id, v_opportunity.client_id, p_opportunity_id, v_project.id,
    'opportunity_converted_to_project', v_user_id, jsonb_build_object('project_id', v_project.id));

  return v_project;
exception
  when unique_violation then
    -- A second, truly-concurrent conversion lost the race to insert despite
    -- the row lock above (e.g. a direct script bypassing this function's
    -- locking discipline) — return the winner's project instead of erroring.
    select * into v_existing_project from public.projects where opportunity_id = p_opportunity_id;
    return v_existing_project;
end;
$$;

comment on function public.convert_opportunity_to_project(uuid, text, text, text) is
  'Atomically creates a project from an opportunity (ready_for_estimate or won only). Idempotent: retrying, or a losing concurrent call, always returns the SAME project rather than erroring or duplicating — backed by the projects_opportunity_id_key unique index. Opportunity status is left untouched (see docs/22-phase-1-state-machines.md, "Why conversion does not change opportunity status").';

-- =============================================================================
-- Grants
-- =============================================================================

revoke execute on function public.create_project(uuid, uuid, text, text, text, uuid, date) from public;
grant execute on function public.create_project(uuid, uuid, text, text, text, uuid, date) to authenticated;

revoke execute on function public.update_project(uuid, text, text, text, uuid, date, uuid) from public;
grant execute on function public.update_project(uuid, text, text, text, uuid, date, uuid) to authenticated;

revoke execute on function public.change_project_status(uuid, text, timestamptz) from public;
grant execute on function public.change_project_status(uuid, text, timestamptz) to authenticated;

revoke execute on function public.archive_project(uuid) from public;
grant execute on function public.archive_project(uuid) to authenticated;

revoke execute on function public.restore_project(uuid) from public;
grant execute on function public.restore_project(uuid) to authenticated;

revoke execute on function public.convert_opportunity_to_project(uuid, text, text, text) from public;
grant execute on function public.convert_opportunity_to_project(uuid, text, text, text) to authenticated;

-- =============================================================================
-- Project addresses
-- =============================================================================

create or replace function public.create_project_address(
  p_project_id uuid,
  p_address_line_1 text,
  p_city text,
  p_state text,
  p_postal_code text,
  p_address_line_2 text default null,
  p_country_code text default 'US',
  p_access_instructions text default null,
  p_is_primary boolean default false
)
returns public.project_addresses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_project public.projects;
  v_address public.project_addresses;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_project from public.projects where id = p_project_id;
  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_project.tenant_id, 'projects.update') then
    raise exception 'Missing permission: projects.update' using errcode = '42501';
  end if;

  if p_address_line_1 is null or btrim(p_address_line_1) = '' then
    raise exception 'Address line 1 is required' using errcode = '22023';
  end if;
  if p_city is null or btrim(p_city) = '' then
    raise exception 'City is required' using errcode = '22023';
  end if;

  -- Lock the project row: serializes concurrent primary-address assignment
  -- exactly like set_primary_contact()'s client-row lock.
  perform 1 from public.projects where id = p_project_id for update;

  if coalesce(p_is_primary, false) then
    update public.project_addresses
       set is_primary = false
     where project_id = p_project_id and is_primary = true and archived_at is null;
  end if;

  insert into public.project_addresses (
    tenant_id, project_id, address_line_1, address_line_2, city, state, postal_code, country_code,
    access_instructions, is_primary, created_by
  )
  values (
    v_project.tenant_id, p_project_id, btrim(p_address_line_1), p_address_line_2, btrim(p_city), p_state, p_postal_code,
    coalesce(nullif(p_country_code, ''), 'US'), p_access_instructions, coalesce(p_is_primary, false), v_user_id
  )
  returning * into v_address;

  perform public.log_audit_event(v_project.tenant_id, v_user_id, 'project_address.created', 'project_address', v_address.id,
    jsonb_build_object('project_id', p_project_id));

  return v_address;
end;
$$;

comment on function public.create_project_address(uuid, text, text, text, text, text, text, text, boolean) is
  'Creates a work-site address for a project. If p_is_primary, atomically clears any existing primary address first.';

create or replace function public.update_project_address(
  p_address_id uuid,
  p_address_line_1 text,
  p_city text,
  p_state text,
  p_postal_code text,
  p_address_line_2 text,
  p_country_code text,
  p_access_instructions text
)
returns public.project_addresses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.project_addresses;
  v_result public.project_addresses;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.project_addresses where id = p_address_id;
  if not found then
    raise exception 'Address not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'projects.update') then
    raise exception 'Missing permission: projects.update' using errcode = '42501';
  end if;

  if p_address_line_1 is null or btrim(p_address_line_1) = '' then
    raise exception 'Address line 1 is required' using errcode = '22023';
  end if;
  if p_city is null or btrim(p_city) = '' then
    raise exception 'City is required' using errcode = '22023';
  end if;

  update public.project_addresses
     set address_line_1 = btrim(p_address_line_1),
         city = btrim(p_city),
         state = p_state,
         postal_code = p_postal_code,
         address_line_2 = p_address_line_2,
         country_code = coalesce(nullif(p_country_code, ''), 'US'),
         access_instructions = p_access_instructions
   where id = p_address_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'project_address.updated', 'project_address', p_address_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.update_project_address(uuid, text, text, text, text, text, text, text) is 'Replaces an address''s editable fields (not is_primary — use set_primary_project_address()).';

create or replace function public.set_primary_project_address(p_address_id uuid)
returns public.project_addresses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.project_addresses;
  v_result public.project_addresses;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.project_addresses where id = p_address_id;
  if not found then
    raise exception 'Address not found' using errcode = 'P0002';
  end if;

  if v_row.archived_at is not null then
    raise exception 'Cannot make an archived address primary' using errcode = '22023';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'projects.update') then
    raise exception 'Missing permission: projects.update' using errcode = '42501';
  end if;

  perform 1 from public.projects where id = v_row.project_id for update;

  update public.project_addresses
     set is_primary = false
   where project_id = v_row.project_id and is_primary = true and archived_at is null and id <> p_address_id;

  update public.project_addresses
     set is_primary = true
   where id = p_address_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'project_address.primary_changed', 'project_address', p_address_id,
    jsonb_build_object('project_id', v_row.project_id));
  perform public.log_crm_activity(v_row.tenant_id, null, null, v_row.project_id, 'address_primary_changed', v_user_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.set_primary_project_address(uuid) is 'Atomically promotes an address to primary for its project, clearing any previous primary in the same transaction.';

create or replace function public.archive_project_address(p_address_id uuid)
returns public.project_addresses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.project_addresses;
  v_result public.project_addresses;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.project_addresses where id = p_address_id;
  if not found then
    raise exception 'Address not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'projects.update') then
    raise exception 'Missing permission: projects.update' using errcode = '42501';
  end if;

  if v_row.archived_at is not null then
    return v_row;
  end if;

  update public.project_addresses
     set archived_at = now(), archived_by = v_user_id, is_primary = false
   where id = p_address_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'project_address.updated', 'project_address', p_address_id,
    jsonb_build_object('archived', true));

  return v_result;
end;
$$;

comment on function public.archive_project_address(uuid) is 'Archives an address, clearing is_primary if it was set.';

create or replace function public.restore_project_address(p_address_id uuid)
returns public.project_addresses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.project_addresses;
  v_result public.project_addresses;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.project_addresses where id = p_address_id;
  if not found then
    raise exception 'Address not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'projects.update') then
    raise exception 'Missing permission: projects.update' using errcode = '42501';
  end if;

  if v_row.archived_at is null then
    return v_row;
  end if;

  update public.project_addresses
     set archived_at = null, archived_by = null
   where id = p_address_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'project_address.updated', 'project_address', p_address_id,
    jsonb_build_object('restored', true));

  return v_result;
end;
$$;

comment on function public.restore_project_address(uuid) is 'Restores an archived address. Does not automatically re-promote it to primary.';

revoke execute on function public.create_project_address(uuid, text, text, text, text, text, text, text, boolean) from public;
grant execute on function public.create_project_address(uuid, text, text, text, text, text, text, text, boolean) to authenticated;

revoke execute on function public.update_project_address(uuid, text, text, text, text, text, text, text) from public;
grant execute on function public.update_project_address(uuid, text, text, text, text, text, text, text) to authenticated;

revoke execute on function public.set_primary_project_address(uuid) from public;
grant execute on function public.set_primary_project_address(uuid) to authenticated;

revoke execute on function public.archive_project_address(uuid) from public;
grant execute on function public.archive_project_address(uuid) to authenticated;

revoke execute on function public.restore_project_address(uuid) from public;
grant execute on function public.restore_project_address(uuid) to authenticated;
