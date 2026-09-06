-- AI-assisted proposal text — business_profiles get/update RPCs.
-- Same shape as 20260706141400_proposal_settings_functions.sql: an
-- internal idempotent get-or-create, then a public, permission-checked
-- get + update pair, gated on tenant.view/tenant.update (reused, not a
-- new permission — see 20260819100000_business_profiles_schema.sql).

create or replace function public.ensure_business_profile(p_tenant_id uuid)
returns public.business_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.business_profiles;
begin
  insert into public.business_profiles (tenant_id)
  values (p_tenant_id)
  on conflict (tenant_id) do nothing;

  select * into v_profile from public.business_profiles where tenant_id = p_tenant_id;
  return v_profile;
end;
$$;

comment on function public.ensure_business_profile(uuid) is
  'Get-or-create a tenant''s business profile row with defaults. Called internally by get_business_profile() and by the AI generation action — never fails on "already exists."';

create or replace function public.get_business_profile(p_tenant_id uuid)
returns public.business_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.user_has_permission(p_tenant_id, 'tenant.view') then
    raise exception 'Missing permission: tenant.view' using errcode = '42501';
  end if;

  return public.ensure_business_profile(p_tenant_id);
end;
$$;

comment on function public.get_business_profile(uuid) is
  'Permission-checked, idempotent get-or-create for a tenant''s business profile. Safe to call on every Profile page load.';

create or replace function public.update_business_profile(
  p_tenant_id uuid,
  p_business_name text,
  p_industry text,
  p_main_services text,
  p_service_area text,
  p_business_address text,
  p_business_phone text,
  p_business_email text,
  p_license_number text,
  p_insurance_statement text,
  p_default_warranty_policy text,
  p_default_payment_terms text,
  p_default_deposit_policy text,
  p_default_change_order_policy text,
  p_default_cancellation_policy text,
  p_default_cleanup_policy text,
  p_default_materials_policy text,
  p_default_client_responsibilities text,
  p_default_exclusions text,
  p_tone_preference text
)
returns public.business_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.business_profiles;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.user_has_permission(p_tenant_id, 'tenant.update') then
    raise exception 'Missing permission: tenant.update' using errcode = '42501';
  end if;

  perform public.ensure_business_profile(p_tenant_id);

  if p_business_name is null or btrim(p_business_name) = '' then
    raise exception 'Business name is required' using errcode = '22023';
  end if;
  if p_tone_preference is null or p_tone_preference not in ('professional', 'friendly', 'direct', 'detailed', 'simple') then
    raise exception 'Invalid tone preference' using errcode = '22023';
  end if;

  update public.business_profiles
     set business_name = btrim(p_business_name),
         industry = coalesce(p_industry, ''),
         main_services = coalesce(p_main_services, ''),
         service_area = coalesce(p_service_area, ''),
         business_address = coalesce(p_business_address, ''),
         business_phone = coalesce(p_business_phone, ''),
         business_email = coalesce(p_business_email, ''),
         license_number = coalesce(p_license_number, ''),
         insurance_statement = coalesce(p_insurance_statement, ''),
         default_warranty_policy = coalesce(p_default_warranty_policy, ''),
         default_payment_terms = coalesce(p_default_payment_terms, ''),
         default_deposit_policy = coalesce(p_default_deposit_policy, ''),
         default_change_order_policy = coalesce(p_default_change_order_policy, ''),
         default_cancellation_policy = coalesce(p_default_cancellation_policy, ''),
         default_cleanup_policy = coalesce(p_default_cleanup_policy, ''),
         default_materials_policy = coalesce(p_default_materials_policy, ''),
         default_client_responsibilities = coalesce(p_default_client_responsibilities, ''),
         default_exclusions = coalesce(p_default_exclusions, ''),
         tone_preference = p_tone_preference
   where tenant_id = p_tenant_id
   returning * into v_result;

  perform public.log_audit_event(p_tenant_id, v_user_id, 'business_profile.updated', 'business_profiles', p_tenant_id, '{}'::jsonb);

  return v_result;
end;
$$;

comment on function public.update_business_profile(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) is
  'Permission-checked update for a tenant''s business profile. business_name is required; every other field is optional free text with a sensible empty default.';

-- Internal helper only -- never directly callable, exactly like
-- ensure_tenant_proposal_settings(). Real callers go through
-- get_business_profile()/update_business_profile() below, both of which
-- check tenant.view/tenant.update themselves before calling this.
revoke execute on function public.ensure_business_profile(uuid) from public, authenticated;

revoke execute on function public.get_business_profile(uuid) from public;
grant execute on function public.get_business_profile(uuid) to authenticated;

revoke execute on function public.update_business_profile(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.update_business_profile(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) to authenticated;
