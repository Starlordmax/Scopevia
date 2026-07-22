-- Phase 2D.1: server-side pagination for search_material_catalog().
-- Root cause of the reported "30,000px+ scroll on mobile" bug: this
-- function returned up to 200 rows in one shot with zero pagination
-- controls, and the Materials & Costs step rendered every single one as
-- a full card (name/description/unit/supplier/price + an entire
-- add-to-proposal mini-form with quantity/section/price-override
-- fields) with no windowing at all. At the current demo-data scale
-- (~26 seeded items) that's already enough to produce a very long
-- scroll on a 390px-wide viewport; at real-world catalog scale it would
-- only get worse. See docs/51-material-catalog-pagination.md.
--
-- This must DROP + CREATE (not "create or replace") because the
-- function's OUTPUT columns are changing (a new `total_count` column
-- is added) -- Postgres does not allow "create or replace function" to
-- change a set-returning function's return-table shape.
drop function if exists public.search_material_catalog(uuid, text, text, text, text);

create or replace function public.search_material_catalog(
  p_tenant_id uuid,
  p_zip_code text default null,
  p_search_text text default null,
  p_category text default null,
  p_service_type text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  scope text,
  tenant_id uuid,
  name text,
  description text,
  category text,
  service_type text,
  default_unit text,
  brand text,
  sku text,
  supplier_name text,
  price_id uuid,
  unit_price_cents bigint,
  price_zip_code text,
  price_state_code text,
  price_supplier_name text,
  price_effective_date date,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_zip_code text := nullif(btrim(coalesce(p_zip_code, '')), '');
  v_search_text text := nullif(btrim(coalesce(p_search_text, '')), '');
  v_category text := nullif(btrim(coalesce(p_category, '')), '');
  v_service_type text := nullif(btrim(coalesce(p_service_type, '')), '');
  -- Defensive server-side clamping, same discipline as lib/search.ts's
  -- clampPageSize() on the client side -- a caller passing p_limit=0,
  -- a negative number, or an absurdly large one (accidental or not)
  -- never reaches the query below unclamped.
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.user_has_permission(p_tenant_id, 'materials.view') then
    raise exception 'Missing permission: materials.view' using errcode = '42501';
  end if;

  return query
  select
    mci.id, mci.scope, mci.tenant_id, mci.name, mci.description, mci.category, mci.service_type,
    mci.default_unit, mci.brand, mci.sku, mci.supplier_name,
    price.id, price.unit_price_cents, price.zip_code, price.state_code, price.supplier_name, price.effective_date,
    -- count(*) over() runs over every row matching the WHERE clause
    -- BEFORE the outer limit/offset is applied (window functions
    -- evaluate ahead of the final LIMIT/OFFSET step in Postgres's query
    -- pipeline), so this is the true total match count, not just
    -- "however many rows this page happens to return" -- computed in
    -- the same single query, no second COUNT(*) round-trip needed.
    count(*) over() as total_count
  from public.material_catalog_items mci
  left join lateral public.find_material_zip_price(mci.id, p_tenant_id, v_zip_code) as price on true
  where mci.archived_at is null
    and mci.is_active
    and (mci.scope = 'global' or (mci.scope = 'tenant' and mci.tenant_id = p_tenant_id))
    and (v_category is null or mci.category = v_category)
    and (v_service_type is null or mci.service_type = v_service_type)
    and (
      v_search_text is null
      or mci.name ilike '%' || v_search_text || '%'
      or mci.description ilike '%' || v_search_text || '%'
      or mci.brand ilike '%' || v_search_text || '%'
      or mci.supplier_name ilike '%' || v_search_text || '%'
    )
  order by mci.name asc
  limit v_limit offset v_offset;
end;
$$;

comment on function public.search_material_catalog(uuid, text, text, text, text, int, int) is
  'Browse/search the material catalog (global + own tenant), with the best available price at p_zip_code (or null if none -- see find_material_zip_price()). Text search matches name/description/brand/supplier_name, case-insensitive, partial match. An empty string for any optional filter is treated identically to null. Paginated: p_limit (default 20, clamped 1-100) / p_offset (default 0, clamped >=0); every returned row also carries total_count, the true total match count across the whole result set (via count(*) over()), so the caller can compute "has more" without a second query. Never re-run without a ZIP just to "guess" a price.';

revoke execute on function public.search_material_catalog(uuid, text, text, text, text, int, int) from public;
grant execute on function public.search_material_catalog(uuid, text, text, text, text, int, int) to authenticated;

-- Indexes to support the two filters that weren't already covered:
-- category and tenant_id already have partial indexes from Phase 2B
-- (20260708120000); service_type had none, and free-text ILIKE search
-- (name/description/brand/supplier_name) had no index acceleration at
-- all. Matches the established pg_trgm convention already used for
-- clients.display_name / opportunities.title / projects.name (Phase 1,
-- 20260702130100/200/300) -- one primary trigram-indexed text column
-- per table, not every searchable field, to keep write overhead
-- proportionate; description/brand/supplier_name search remain
-- sequential-scan fallbacks, acceptable at this catalog's realistic
-- scale and documented as a known limitation.
create index material_catalog_items_service_type_idx on public.material_catalog_items (service_type) where archived_at is null and is_active;
create index material_catalog_items_name_trgm_idx on public.material_catalog_items using gin (name extensions.gin_trgm_ops);
