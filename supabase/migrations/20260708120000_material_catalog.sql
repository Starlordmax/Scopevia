-- Phase 2B: Material catalog by ZIP code (docs/42-material-catalog-by-zip.md).
--
-- material_catalog_items: the catalog of materials a contractor can add to
-- a proposal, either Scopevia's shared "global" catalog (scope='global',
-- tenant_id null) or a contractor's own custom material
-- (scope='tenant', tenant_id required). No exposed function creates a
-- global item in this phase — the global catalog is seed/migration-only
-- ("catálogo global solo editable por operación administrativa
-- controlada o seed"); every exposed create function only ever creates
-- scope='tenant' rows.

create table public.material_catalog_items (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global', 'tenant')),
  tenant_id uuid references public.tenants (id),
  name text not null check (btrim(name) <> ''),
  description text,
  category text not null check (category in (
    'paint', 'primer', 'tape', 'brushes', 'rollers', 'drop_cloths', 'drywall',
    'tile', 'flooring', 'wood', 'plumbing', 'electrical', 'hardware',
    'disposal', 'other'
  )),
  service_type text check (service_type is null or service_type in (
    'interior_painting', 'exterior_painting', 'bathroom_remodeling',
    'general_remodeling', 'flooring', 'custom'
  )),
  default_unit text not null check (default_unit in ('each', 'hour', 'day', 'gallon', 'sq_ft', 'linear_ft', 'fixed')),
  brand text,
  sku text,
  supplier_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, tenant_id),
  constraint material_catalog_items_scope_tenant_check check (
    (scope = 'global' and tenant_id is null)
    or (scope = 'tenant' and tenant_id is not null)
  )
);

comment on table public.material_catalog_items is
  'The material catalog a contractor picks from in the Materials & Costs step. scope=global is Scopevia''s shared catalog (tenant_id null, seed/migration-only in this phase); scope=tenant is a contractor''s own custom material. See docs/42-material-catalog-by-zip.md.';

create index material_catalog_items_tenant_idx on public.material_catalog_items (tenant_id) where tenant_id is not null;
create index material_catalog_items_category_idx on public.material_catalog_items (category) where archived_at is null and is_active;

create trigger trg_material_catalog_items_set_updated_at
  before update on public.material_catalog_items
  for each row execute function public.set_updated_at();

-- material_zip_prices: a price for a material_catalog_item, optionally
-- scoped to a specific ZIP/state and/or a specific tenant (a tenant-owned
-- price override). zip_code null = a ZIP-agnostic "default" price for
-- that material (the last fallback level — see
-- search_material_catalog() in 20260708120200_material_catalog_functions.sql).
create table public.material_zip_prices (
  id uuid primary key default gen_random_uuid(),
  material_catalog_item_id uuid not null references public.material_catalog_items (id),
  -- null = a global/default price usable by any tenant; non-null = a
  -- tenant-owned price override, only usable by that tenant (enforced by
  -- the trigger below, which also enforces the material/price tenant
  -- must match when the material itself is tenant-scoped).
  tenant_id uuid references public.tenants (id),
  zip_code text check (zip_code is null or zip_code ~ '^\d{5}$'),
  state_code text check (state_code is null or state_code ~ '^[A-Z]{2}$'),
  city text,
  unit_price_cents bigint not null check (unit_price_cents >= 0 and unit_price_cents <= 100000000),
  currency_code text not null default 'USD' check (currency_code = 'USD'),
  price_source text not null check (price_source in ('manual_seed', 'manual_admin', 'tenant_custom', 'csv_import', 'future_external')),
  supplier_name text,
  effective_date date not null default current_date,
  expires_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, tenant_id),
  constraint material_zip_prices_expires_after_effective_check check (expires_at is null or expires_at >= effective_date)
);

comment on table public.material_zip_prices is
  'A price for a material_catalog_item, optionally scoped to a ZIP/state and/or a specific tenant. zip_code null = a ZIP-agnostic default price (the final fallback level). See docs/42-material-catalog-by-zip.md, "ZIP pricing fallback".';

create index material_zip_prices_material_idx on public.material_zip_prices (material_catalog_item_id) where archived_at is null;
create index material_zip_prices_zip_idx on public.material_zip_prices (zip_code) where archived_at is null and zip_code is not null;
create index material_zip_prices_state_idx on public.material_zip_prices (state_code) where archived_at is null and state_code is not null;
create index material_zip_prices_tenant_idx on public.material_zip_prices (tenant_id) where tenant_id is not null;

create trigger trg_material_zip_prices_set_updated_at
  before update on public.material_zip_prices
  for each row execute function public.set_updated_at();

-- Enforces the one integrity rule a composite FK cannot express here (the
-- parent's tenant_id can legitimately be null for a global material): a
-- price for a TENANT-scoped material must belong to that exact tenant —
-- never a different tenant, and never a "global" (null-tenant) price. A
-- price for a GLOBAL material has no such restriction (null = a shared
-- default; any real tenant id = that tenant's own override — never a
-- cross-tenant concern since a tenant can only ever set its own override).
create or replace function public.prevent_cross_tenant_material_price()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_material public.material_catalog_items;
begin
  select * into v_material from public.material_catalog_items where id = new.material_catalog_item_id;
  if not found then
    raise exception 'Material catalog item not found' using errcode = 'P0002';
  end if;

  if v_material.scope = 'tenant' and new.tenant_id is distinct from v_material.tenant_id then
    raise exception 'A price for a tenant-scoped material must belong to the same tenant' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger trg_material_zip_prices_prevent_cross_tenant
  before insert or update on public.material_zip_prices
  for each row execute function public.prevent_cross_tenant_material_price();
