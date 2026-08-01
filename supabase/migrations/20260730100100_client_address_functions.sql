-- Extends create_client()/update_client() with the new address columns.
-- New params appended at the end (all `default null`), so no existing
-- caller (the general /clients/new form, Quick Create Client) breaks by
-- omitting them. Same CHECK-then-clear-friendly-message discipline as the
-- table's own constraints (defense in depth for a caller that bypasses
-- the app's own zod validation).

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
  p_source text default null,
  p_address_line1 text default null,
  p_address_line2 text default null,
  p_city text default null,
  p_state text default null,
  p_postal_code text default null,
  p_country_code text default null
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

  if p_postal_code is not null and btrim(p_postal_code) <> '' and p_postal_code !~ '^[A-Za-z0-9 -]{3,12}$' then
    raise exception 'Please enter a valid ZIP or postal code' using errcode = '22023';
  end if;

  insert into public.clients (
    tenant_id, client_type, display_name, legal_name, first_name, last_name,
    email, phone, secondary_phone, website, tax_exempt, preferred_contact_method, source, created_by,
    address_line_1, address_line_2, city, state, postal_code, country_code
  )
  values (
    p_tenant_id, p_client_type, btrim(p_display_name), p_legal_name, p_first_name, p_last_name,
    p_email, p_phone, p_secondary_phone, p_website, coalesce(p_tax_exempt, false), p_preferred_contact_method, p_source, v_user_id,
    p_address_line1, p_address_line2, p_city, p_state, nullif(btrim(coalesce(p_postal_code, '')), ''), p_country_code
  )
  returning * into v_client;

  perform public.log_audit_event(p_tenant_id, v_user_id, 'client.created', 'client', v_client.id,
    jsonb_build_object('display_name', v_client.display_name));
  perform public.log_crm_activity(p_tenant_id, v_client.id, null, null, 'client_created', v_user_id,
    jsonb_build_object('display_name', v_client.display_name));

  return v_client;
end;
$$;

comment on function public.create_client(uuid, text, text, text, text, text, text, text, text, text, boolean, text, text, text, text, text, text, text, text) is
  'Creates a client. Requires clients.create in p_tenant_id. Atomic with its audit_logs + crm_activities entries. Address fields are all optional and independent -- a client may have partial or no address at all.';

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
  p_source text,
  p_address_line1 text default null,
  p_address_line2 text default null,
  p_city text default null,
  p_state text default null,
  p_postal_code text default null,
  p_country_code text default null
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

  if p_postal_code is not null and btrim(p_postal_code) <> '' and p_postal_code !~ '^[A-Za-z0-9 -]{3,12}$' then
    raise exception 'Please enter a valid ZIP or postal code' using errcode = '22023';
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
         source = p_source,
         address_line_1 = p_address_line1,
         address_line_2 = p_address_line2,
         city = p_city,
         state = p_state,
         postal_code = nullif(btrim(coalesce(p_postal_code, '')), ''),
         country_code = p_country_code
   where id = p_client_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'client.updated', 'client', p_client_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.update_client(uuid, text, text, text, text, text, text, text, text, text, boolean, text, text, text, text, text, text, text, text) is
  'Updates a client. Requires clients.update. Address fields are all optional and independent, same as create_client().';
