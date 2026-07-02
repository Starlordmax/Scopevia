-- Phase 1: CRM & Projects — forward-fix: nullable defaults on update_* functions
--
-- Found while generating TypeScript types from the live schema: update_client(),
-- update_client_contact(), update_opportunity(), update_project() and
-- update_project_address() declared their optional fields (legal_name, email,
-- source, description, address_line_2, etc.) WITHOUT `default null`. This is a
-- genuine defect, not just a typing inconvenience: without a default, Postgres
-- requires every one of these arguments to be present in the call, and
-- `supabase gen types` correctly reflected that by typing them as required
-- (non-nullable) — which in turn made it impossible for application code to
-- express "clear this optional field" through the normal, type-safe call
-- shape.
--
-- Per this phase's migration discipline, the ALREADY-APPLIED migrations
-- (20260702130600, 20260702130700, 20260702130800) are left exactly as
-- deployed; this is a new, additive migration that only adds `default null`
-- to existing optional parameters (or `default 'US'` where the column itself
-- has that business default). Adding a default to a previously-required
-- parameter is backwards compatible — every existing call site that already
-- passes a value for these parameters continues to work unchanged.

create or replace function public.update_client(
  p_client_id uuid,
  p_client_type text,
  p_display_name text,
  p_legal_name text default null,
  p_first_name text default null,
  p_last_name text default null,
  p_email text default null,
  p_phone text default null,
  p_secondary_phone text default null,
  p_website text default null,
  p_tax_exempt boolean default false,
  p_preferred_contact_method text default null,
  p_source text default null
)
returns public.clients
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.clients;
  v_result public.clients;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.clients where id = p_client_id;
  if not found then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'clients.update') then
    raise exception 'Missing permission: clients.update' using errcode = '42501';
  end if;

  if p_display_name is null or btrim(p_display_name) = '' then
    raise exception 'Display name is required' using errcode = '22023';
  end if;

  update public.clients
     set client_type = p_client_type,
         display_name = btrim(p_display_name),
         legal_name = p_legal_name,
         first_name = p_first_name,
         last_name = p_last_name,
         email = p_email,
         phone = p_phone,
         secondary_phone = p_secondary_phone,
         website = p_website,
         tax_exempt = coalesce(p_tax_exempt, false),
         preferred_contact_method = p_preferred_contact_method,
         source = p_source
   where id = p_client_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'client.updated', 'client', p_client_id, '{}'::jsonb);

  return v_result;
end;
$$;

create or replace function public.update_client_contact(
  p_contact_id uuid,
  p_first_name text,
  p_last_name text default null,
  p_job_title text default null,
  p_email text default null,
  p_phone text default null,
  p_preferred_contact_method text default null,
  p_notes text default null
)
returns public.client_contacts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.client_contacts;
  v_result public.client_contacts;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.client_contacts where id = p_contact_id;
  if not found then
    raise exception 'Contact not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'contacts.update') then
    raise exception 'Missing permission: contacts.update' using errcode = '42501';
  end if;

  if p_first_name is null or btrim(p_first_name) = '' then
    raise exception 'First name is required' using errcode = '22023';
  end if;

  update public.client_contacts
     set first_name = btrim(p_first_name),
         last_name = p_last_name,
         job_title = p_job_title,
         email = p_email,
         phone = p_phone,
         preferred_contact_method = p_preferred_contact_method,
         notes = p_notes
   where id = p_contact_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'contact.updated', 'client_contact', p_contact_id, '{}'::jsonb);

  return v_result;
end;
$$;

create or replace function public.update_opportunity(
  p_opportunity_id uuid,
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

create or replace function public.update_project(
  p_project_id uuid,
  p_name text,
  p_service_type text default null,
  p_description text default null,
  p_assigned_to uuid default null,
  p_tentative_start_date date default null,
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

create or replace function public.update_project_address(
  p_address_id uuid,
  p_address_line_1 text,
  p_city text,
  p_state text,
  p_postal_code text,
  p_address_line_2 text default null,
  p_country_code text default 'US',
  p_access_instructions text default null
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
