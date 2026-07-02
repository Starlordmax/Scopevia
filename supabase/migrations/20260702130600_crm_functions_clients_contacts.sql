-- Phase 1: CRM & Projects — client & client_contact mutation functions
--
-- clients/client_contacts have NO insert/update/delete RLS policy and NO write
-- grants for `authenticated` (see 20260702131000_crm_rls_policies.sql) — every
-- mutation goes through one of the SECURITY DEFINER functions below, exactly the
-- pattern Phase 0 used for tenant_memberships. This guarantees the row change and
-- its audit_logs + crm_activities entries are always in the same transaction.
--
-- Update functions replace the full set of editable fields (REST "PUT" semantics),
-- not a COALESCE-based partial patch — the edit form always submits the complete
-- current state, which avoids any ambiguity between "field not provided" and
-- "field explicitly cleared to null."

create or replace function public.create_client(
  p_tenant_id uuid,
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
  v_client public.clients;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.user_has_permission(p_tenant_id, 'clients.create') then
    raise exception 'Missing permission: clients.create' using errcode = '42501';
  end if;

  if p_display_name is null or btrim(p_display_name) = '' then
    raise exception 'Display name is required' using errcode = '22023';
  end if;

  if p_client_type not in ('individual', 'business') then
    raise exception 'Unknown client_type: %', p_client_type using errcode = '22023';
  end if;

  insert into public.clients (
    tenant_id, client_type, display_name, legal_name, first_name, last_name,
    email, phone, secondary_phone, website, tax_exempt, preferred_contact_method, source, created_by
  )
  values (
    p_tenant_id, p_client_type, btrim(p_display_name), p_legal_name, p_first_name, p_last_name,
    p_email, p_phone, p_secondary_phone, p_website, coalesce(p_tax_exempt, false), p_preferred_contact_method, p_source, v_user_id
  )
  returning * into v_client;

  perform public.log_audit_event(p_tenant_id, v_user_id, 'client.created', 'client', v_client.id,
    jsonb_build_object('display_name', v_client.display_name));
  perform public.log_crm_activity(p_tenant_id, v_client.id, null, null, 'client_created', v_user_id,
    jsonb_build_object('display_name', v_client.display_name));

  return v_client;
end;
$$;

comment on function public.create_client(uuid, text, text, text, text, text, text, text, text, text, boolean, text, text) is
  'Creates a client. Requires clients.create in p_tenant_id. Atomic with its audit_logs + crm_activities entries.';

create or replace function public.update_client(
  p_client_id uuid,
  p_client_type text,
  p_display_name text,
  p_legal_name text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_secondary_phone text,
  p_website text,
  p_tax_exempt boolean,
  p_preferred_contact_method text,
  p_source text
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

comment on function public.update_client(uuid, text, text, text, text, text, text, text, text, text, boolean, text, text) is
  'Replaces a client''s editable fields. Requires clients.update in the client''s own tenant.';

create or replace function public.archive_client(p_client_id uuid)
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

  if not public.user_has_permission(v_row.tenant_id, 'clients.archive') then
    raise exception 'Missing permission: clients.archive' using errcode = '42501';
  end if;

  if v_row.archived_at is not null then
    return v_row; -- already archived: idempotent no-op
  end if;

  update public.clients
     set archived_at = now(), archived_by = v_user_id
   where id = p_client_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'client.archived', 'client', p_client_id, '{}'::jsonb);
  perform public.log_crm_activity(v_row.tenant_id, p_client_id, null, null, 'client_archived', v_user_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.archive_client(uuid) is
  'Archives a client (archived_at/archived_by) without touching related contacts/opportunities/projects — see docs/20-phase-1-crm-and-projects.md, "Archiving." Idempotent: archiving an already-archived client is a no-op, not an error.';

create or replace function public.restore_client(p_client_id uuid)
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

  if not public.user_has_permission(v_row.tenant_id, 'clients.restore') then
    raise exception 'Missing permission: clients.restore' using errcode = '42501';
  end if;

  if v_row.archived_at is null then
    return v_row; -- already active: idempotent no-op
  end if;

  update public.clients
     set archived_at = null, archived_by = null
   where id = p_client_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'client.restored', 'client', p_client_id, '{}'::jsonb);
  perform public.log_crm_activity(v_row.tenant_id, p_client_id, null, null, 'client_restored', v_user_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.restore_client(uuid) is 'Restores an archived client. Idempotent.';

-- =============================================================================
-- client_contacts
-- =============================================================================

create or replace function public.create_client_contact(
  p_client_id uuid,
  p_first_name text,
  p_last_name text default null,
  p_job_title text default null,
  p_email text default null,
  p_phone text default null,
  p_preferred_contact_method text default null,
  p_notes text default null,
  p_is_primary boolean default false
)
returns public.client_contacts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_client public.clients;
  v_contact public.client_contacts;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_client from public.clients where id = p_client_id;
  if not found then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_client.tenant_id, 'contacts.create') then
    raise exception 'Missing permission: contacts.create' using errcode = '42501';
  end if;

  if p_first_name is null or btrim(p_first_name) = '' then
    raise exception 'First name is required' using errcode = '22023';
  end if;

  -- Lock the client row so a concurrent "create with is_primary=true" for the
  -- same client can't race past this clear-then-set sequence — same pattern
  -- as protect_last_owner()'s tenant-row lock.
  perform 1 from public.clients where id = p_client_id for update;

  if coalesce(p_is_primary, false) then
    update public.client_contacts
       set is_primary = false
     where client_id = p_client_id and is_primary = true and archived_at is null;
  end if;

  insert into public.client_contacts (
    tenant_id, client_id, first_name, last_name, job_title, email, phone,
    preferred_contact_method, is_primary, notes, created_by
  )
  values (
    v_client.tenant_id, p_client_id, btrim(p_first_name), p_last_name, p_job_title, p_email, p_phone,
    p_preferred_contact_method, coalesce(p_is_primary, false), p_notes, v_user_id
  )
  returning * into v_contact;

  perform public.log_audit_event(v_client.tenant_id, v_user_id, 'contact.created', 'client_contact', v_contact.id,
    jsonb_build_object('client_id', p_client_id));
  perform public.log_crm_activity(v_client.tenant_id, p_client_id, null, null, 'contact_created', v_user_id,
    jsonb_build_object('contact_name', btrim(p_first_name) || coalesce(' ' || p_last_name, '')));

  return v_contact;
end;
$$;

comment on function public.create_client_contact(uuid, text, text, text, text, text, text, text, boolean) is
  'Creates a contact for a client. If p_is_primary, atomically clears any existing primary contact first (tenant/client row lock prevents a concurrent race — see client_contacts_one_primary_per_client as the final safety net).';

create or replace function public.update_client_contact(
  p_contact_id uuid,
  p_first_name text,
  p_last_name text,
  p_job_title text,
  p_email text,
  p_phone text,
  p_preferred_contact_method text,
  p_notes text
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

comment on function public.update_client_contact(uuid, text, text, text, text, text, text, text) is
  'Replaces a contact''s editable fields (not is_primary — use set_primary_contact()).';

create or replace function public.set_primary_contact(p_contact_id uuid)
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

  if v_row.archived_at is not null then
    raise exception 'Cannot make an archived contact primary' using errcode = '22023';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'contacts.update') then
    raise exception 'Missing permission: contacts.update' using errcode = '42501';
  end if;

  -- Lock the parent client row: serializes concurrent set_primary_contact()
  -- calls for the same client so the clear-then-set below is atomic even
  -- under concurrency (mirrors protect_last_owner()'s pattern exactly).
  perform 1 from public.clients where id = v_row.client_id for update;

  update public.client_contacts
     set is_primary = false
   where client_id = v_row.client_id and is_primary = true and archived_at is null and id <> p_contact_id;

  update public.client_contacts
     set is_primary = true
   where id = p_contact_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'contact.primary_changed', 'client_contact', p_contact_id,
    jsonb_build_object('client_id', v_row.client_id));
  perform public.log_crm_activity(v_row.tenant_id, v_row.client_id, null, null, 'contact_primary_changed', v_user_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.set_primary_contact(uuid) is
  'Atomically promotes a contact to primary for its client, clearing any previous primary in the same transaction.';

create or replace function public.archive_client_contact(p_contact_id uuid)
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

  if not public.user_has_permission(v_row.tenant_id, 'contacts.archive') then
    raise exception 'Missing permission: contacts.archive' using errcode = '42501';
  end if;

  if v_row.archived_at is not null then
    return v_row;
  end if;

  -- Archiving the primary contact clears the primary flag too — an archived
  -- contact should never remain "the" primary contact of an active client.
  update public.client_contacts
     set archived_at = now(), archived_by = v_user_id, is_primary = false
   where id = p_contact_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'contact.archived', 'client_contact', p_contact_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.archive_client_contact(uuid) is
  'Archives a contact. If it was the primary contact, clears is_primary as part of the same update (an archived contact cannot remain primary).';

create or replace function public.restore_client_contact(p_contact_id uuid)
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

  if not public.user_has_permission(v_row.tenant_id, 'contacts.restore') then
    raise exception 'Missing permission: contacts.restore' using errcode = '42501';
  end if;

  if v_row.archived_at is null then
    return v_row;
  end if;

  update public.client_contacts
     set archived_at = null, archived_by = null
   where id = p_contact_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'contact.restored', 'client_contact', p_contact_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.restore_client_contact(uuid) is
  'Restores an archived contact. Does NOT automatically re-promote it to primary.';

-- =============================================================================
-- Grants
-- =============================================================================

revoke execute on function public.create_client(uuid, text, text, text, text, text, text, text, text, text, boolean, text, text) from public;
grant execute on function public.create_client(uuid, text, text, text, text, text, text, text, text, text, boolean, text, text) to authenticated;

revoke execute on function public.update_client(uuid, text, text, text, text, text, text, text, text, text, boolean, text, text) from public;
grant execute on function public.update_client(uuid, text, text, text, text, text, text, text, text, text, boolean, text, text) to authenticated;

revoke execute on function public.archive_client(uuid) from public;
grant execute on function public.archive_client(uuid) to authenticated;

revoke execute on function public.restore_client(uuid) from public;
grant execute on function public.restore_client(uuid) to authenticated;

revoke execute on function public.create_client_contact(uuid, text, text, text, text, text, text, text, boolean) from public;
grant execute on function public.create_client_contact(uuid, text, text, text, text, text, text, text, boolean) to authenticated;

revoke execute on function public.update_client_contact(uuid, text, text, text, text, text, text, text) from public;
grant execute on function public.update_client_contact(uuid, text, text, text, text, text, text, text) to authenticated;

revoke execute on function public.set_primary_contact(uuid) from public;
grant execute on function public.set_primary_contact(uuid) to authenticated;

revoke execute on function public.archive_client_contact(uuid) from public;
grant execute on function public.archive_client_contact(uuid) to authenticated;

revoke execute on function public.restore_client_contact(uuid) from public;
grant execute on function public.restore_client_contact(uuid) to authenticated;
