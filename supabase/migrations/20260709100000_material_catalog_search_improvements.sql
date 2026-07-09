-- Phase 2B.1: broaden search_material_catalog()'s text match beyond just
-- `name` -- a user searching "exterior" for "Weather-resistant exterior
-- acrylic paint" (a description, not the name "Exterior Paint" itself)
-- previously got zero results. ILIKE is already case-insensitive; this
-- migration only widens which columns are matched, and adds a bounded
-- LIMIT so an unfiltered browse (no search text, no category) can never
-- return an unbounded result set as the catalog grows with tenant-added
-- materials.
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
  left join lateral public.find_material_zip_price(mci.id, p_tenant_id, p_zip_code) as price on true
  where mci.archived_at is null
    and mci.is_active
    and (mci.scope = 'global' or (mci.scope = 'tenant' and mci.tenant_id = p_tenant_id))
    and (p_category is null or mci.category = p_category)
    and (p_service_type is null or mci.service_type = p_service_type)
    and (
      p_search_text is null or btrim(p_search_text) = ''
      or mci.name ilike '%' || btrim(p_search_text) || '%'
      or mci.description ilike '%' || btrim(p_search_text) || '%'
      or mci.brand ilike '%' || btrim(p_search_text) || '%'
      or mci.supplier_name ilike '%' || btrim(p_search_text) || '%'
    )
  order by mci.name asc
  limit 200;
end;
$$;

comment on function public.search_material_catalog(uuid, text, text, text, text) is
  'Browse/search the material catalog (global + own tenant), with the best available price at p_zip_code (or null if none -- see find_material_zip_price()). Text search matches name/description/brand/supplier_name, case-insensitive, partial match. Never re-run without a ZIP just to "guess" a price. Bounded to 200 rows.';
