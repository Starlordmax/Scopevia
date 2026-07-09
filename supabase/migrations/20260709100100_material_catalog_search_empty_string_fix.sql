-- Phase 2B.1 fix: search_material_catalog() only treated a NULL
-- p_category/p_search_text/p_zip_code/p_service_type as "no filter" --
-- an empty string ('', the literal value the UI's "All categories"
-- <option value=""> and a cleared search box submit) still reached
-- `mci.category = p_category`, which is never true for an empty string,
-- silently returning zero rows instead of "no filter applied."
--
-- The Next.js call site (src/lib/proposals/materials.ts) already
-- normalizes '' to null before calling this function, but relying only
-- on the caller to normalize is fragile -- any other/future caller (a
-- different action, a test, a direct RPC call) would hit the same bug.
-- This migration makes the function itself the single source of truth:
-- every optional filter is normalized with nullif(btrim(...), '') at the
-- top of the function body, so '' and null are always equivalent
-- regardless of who's calling.
create or replace function public.search_material_catalog(
  p_tenant_id uuid,
  p_zip_code text default null,
  p_search_text text default null,
  p_category text default null,
  p_service_type text default null
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
  price_effective_date date
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
    price.id, price.unit_price_cents, price.zip_code, price.state_code, price.supplier_name, price.effective_date
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
  limit 200;
end;
$$;

comment on function public.search_material_catalog(uuid, text, text, text, text) is
  'Browse/search the material catalog (global + own tenant), with the best available price at p_zip_code (or null if none -- see find_material_zip_price()). Text search matches name/description/brand/supplier_name, case-insensitive, partial match. An empty string for any optional filter is treated identically to null -- normalized internally, not just by the caller. Never re-run without a ZIP just to "guess" a price. Bounded to 200 rows.';
