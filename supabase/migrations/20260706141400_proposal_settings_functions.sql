-- Phase 2A: Proposal-centric pivot — tenant proposal settings, public
-- surface. Wraps the internal ensure_tenant_proposal_settings() with a real
-- permission check so it's safe to grant to `authenticated`.

create or replace function public.get_tenant_proposal_settings(p_tenant_id uuid)
returns public.tenant_proposal_settings
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

  if not public.user_has_permission(p_tenant_id, 'proposal_settings.view') then
    raise exception 'Missing permission: proposal_settings.view' using errcode = '42501';
  end if;

  return public.ensure_tenant_proposal_settings(p_tenant_id);
end;
$$;

comment on function public.get_tenant_proposal_settings(uuid) is
  'Permission-checked, idempotent get-or-create for a tenant''s proposal settings. Safe to call on every Settings page load.';

create or replace function public.update_tenant_proposal_settings(
  p_tenant_id uuid,
  p_default_customer_hourly_rate_cents bigint,
  p_default_hours_per_day numeric,
  p_default_tax_rate_bps int,
  p_default_proposal_valid_days int,
  p_default_terms text,
  p_default_exclusions text,
  p_proposal_number_prefix text
)
returns public.tenant_proposal_settings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.tenant_proposal_settings;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.user_has_permission(p_tenant_id, 'proposal_settings.update') then
    raise exception 'Missing permission: proposal_settings.update' using errcode = '42501';
  end if;

  perform public.ensure_tenant_proposal_settings(p_tenant_id);

  if p_default_customer_hourly_rate_cents is null or p_default_customer_hourly_rate_cents < 0 then
    raise exception 'Default hourly rate cannot be negative' using errcode = '22023';
  end if;
  if p_default_hours_per_day is null or p_default_hours_per_day <= 0 or p_default_hours_per_day > 24 then
    raise exception 'Default hours per day must be between 0 and 24' using errcode = '22023';
  end if;
  if p_default_tax_rate_bps is null or p_default_tax_rate_bps < 0 or p_default_tax_rate_bps > 10000 then
    raise exception 'Default tax rate must be between 0 and 10000 basis points' using errcode = '22023';
  end if;
  if p_default_proposal_valid_days is null or p_default_proposal_valid_days <= 0 then
    raise exception 'Default validity must be greater than zero days' using errcode = '22023';
  end if;
  if p_proposal_number_prefix is null or btrim(p_proposal_number_prefix) = '' then
    raise exception 'Proposal number prefix is required' using errcode = '22023';
  end if;

  -- next_proposal_number is deliberately NOT a parameter here — it is only
  -- ever advanced by allocate_next_proposal_number(). currency_code is also
  -- not a parameter — Phase 2A is USD-only (see docs/39, "Proposal
  -- Settings"); changing it later needs its own reviewed migration path,
  -- not a plain field edit.
  update public.tenant_proposal_settings
     set default_customer_hourly_rate_cents = p_default_customer_hourly_rate_cents,
         default_hours_per_day = p_default_hours_per_day,
         default_tax_rate_bps = p_default_tax_rate_bps,
         default_proposal_valid_days = p_default_proposal_valid_days,
         default_terms = coalesce(p_default_terms, ''),
         default_exclusions = coalesce(p_default_exclusions, ''),
         proposal_number_prefix = btrim(p_proposal_number_prefix)
   where tenant_id = p_tenant_id
   returning * into v_result;

  perform public.log_audit_event(p_tenant_id, v_user_id, 'proposal_settings.updated', 'tenant_proposal_settings', p_tenant_id, '{}'::jsonb);

  return v_result;
end;
$$;

revoke execute on function public.get_tenant_proposal_settings(uuid) from public;
grant execute on function public.get_tenant_proposal_settings(uuid) to authenticated;

revoke execute on function public.update_tenant_proposal_settings(uuid, bigint, numeric, int, int, text, text, text) from public;
grant execute on function public.update_tenant_proposal_settings(uuid, bigint, numeric, int, int, text, text, text) to authenticated;
