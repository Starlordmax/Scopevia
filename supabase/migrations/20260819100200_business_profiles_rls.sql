-- AI-assisted proposal text — business_profiles RLS.
-- Same discipline as every other phase: RLS enabled, SELECT-only policy
-- keyed on user_has_permission(), `to authenticated` only, no
-- insert/update/delete grant — every mutation goes through
-- update_business_profile() (20260819100100_business_profiles_functions.sql).

alter table public.business_profiles enable row level security;
create policy business_profiles_select on public.business_profiles
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'tenant.view'));
grant select on public.business_profiles to authenticated;
