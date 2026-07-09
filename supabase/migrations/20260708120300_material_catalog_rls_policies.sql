-- Phase 2B: Material catalog & ZIP pricing — Row Level Security.
--
-- Same discipline as 20260706141500_proposal_rls_policies.sql: RLS
-- enabled, SELECT-only policies, `to authenticated` only, no
-- insert/update/delete grant anywhere -- every mutation goes through the
-- SECURITY DEFINER functions in 20260708120400_material_catalog_functions.sql.
--
-- Global-vs-tenant visibility: user_has_permission() always takes a
-- specific tenant_id and cannot express "does this user have X in ANY
-- tenant they belong to" -- the same problem the existing `roles` table
-- has for is_system=true rows (see the roles_select policy in
-- 20260701120800_rls_policies.sql). That policy's answer is to treat
-- global/system rows as plain shared reference data, visible to any
-- authenticated user with no permission check at all. We follow the same
-- precedent here: scope='global' materials and tenant_id-null prices are
-- Scopevia's own shared reference data (seed/migration-only in this
-- phase -- see 20260708120000_material_catalog.sql), not a tenant's
-- private information, so they carry no permission gate. A tenant's own
-- rows (scope='tenant' materials, tenant-owned price overrides) DO carry
-- the usual user_has_permission() gate, so Tenant A can never read
-- Tenant B's custom materials or price overrides.

alter table public.material_catalog_items enable row level security;
create policy material_catalog_items_select on public.material_catalog_items
  for select to authenticated
  using (
    scope = 'global'
    or (scope = 'tenant' and public.user_has_permission(tenant_id, 'materials.view'))
  );
grant select on public.material_catalog_items to authenticated;

alter table public.material_zip_prices enable row level security;
create policy material_zip_prices_select on public.material_zip_prices
  for select to authenticated
  using (
    tenant_id is null
    or public.user_has_permission(tenant_id, 'material_prices.view')
  );
grant select on public.material_zip_prices to authenticated;
