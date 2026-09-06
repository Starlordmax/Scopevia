-- Phase 2B: Material catalog & ZIP pricing — functions.
--
-- Same discipline as 20260706141200_proposal_functions_sections_items.sql:
-- every mutation is a SECURITY DEFINER function that re-checks auth,
-- permission, and (where relevant) draft-only status before writing;
-- triggers are defense in depth, not the primary enforcement.
--
-- find_material_zip_price() implements the 3-tier fallback from
-- docs/42-material-catalog-by-zip.md, "ZIP pricing fallback": exact ZIP
-- match -> same state (inferred from any other price row that happens to
-- share the target ZIP -- there is no canonical ZIP->state table in this
-- phase, a documented limitation) -> ZIP/state-agnostic default. It NEVER
-- invents a price: if nothing matches at any tier it returns null, and
-- callers must surface "No price available for this ZIP" rather than
-- guessing.

create or replace function public.find_material_zip_price(
  p_material_catalog_item_id uuid,
  p_tenant_id uuid,
  p_zip_code text
)
returns public.material_zip_prices
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with inferred_state as (
    select p2.state_code
    from public.material_zip_prices p2
    where p_zip_code is not null
      and p2.zip_code = p_zip_code
      and p2.state_code is not null
      and p2.archived_at is null
    limit 1
  ),
  candidates as (
    select mzp.*,
      case
        when p_zip_code is not null and mzp.zip_code = p_zip_code then 1
        when mzp.state_code is not null and mzp.state_code = (select state_code from inferred_state) then 2
        when mzp.zip_code is null and mzp.state_code is null then 3
        else null
      end as tier
    from public.material_zip_prices mzp
    where mzp.material_catalog_item_id = p_material_catalog_item_id
      and mzp.archived_at is null
      and mzp.effective_date <= current_date
      and (mzp.expires_at is null or mzp.expires_at >= current_date)
      and (mzp.tenant_id is null or mzp.tenant_id = p_tenant_id)
  )
  select id, material_catalog_item_id, tenant_id, zip_code, state_code, city, unit_price_cents,
         currency_code, price_source, supplier_name, effective_date, expires_at, created_at, updated_at, archived_at
  from candidates
  where tier is not null
  order by tier asc, (tenant_id is not null) desc, effective_date desc
  limit 1;
$$;

comment on function public.find_material_zip_price(uuid, uuid, text) is
  'Best price for a material at a ZIP, tenant-aware. Tier 1: exact ZIP match. Tier 2: same state (state inferred from any OTHER price row sharing the exact target ZIP -- no canonical ZIP->state table in this phase). Tier 3: ZIP/state-agnostic default. A tenant-owned override always wins over a global row at the same tier. Returns null (never a guessed price) if nothing matches any tier.';

-- =============================================================================
-- Catalog search (read path — a function, not a raw client query, so the
-- ZIP-price fallback logic runs server-side and stays in one place)
-- =============================================================================

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
    and (p_search_text is null or btrim(p_search_text) = '' or mci.name ilike '%' || btrim(p_search_text) || '%')
  order by mci.name asc;
end;
$$;

comment on function public.search_material_catalog(uuid, text, text, text, text) is
  'Browse/search the material catalog (global + own tenant), with the best available price at p_zip_code (or null if none -- see find_material_zip_price()). Never re-run without a ZIP just to "guess" a price.';

-- =============================================================================
-- Tenant material CRUD — always scope=tenant. The global catalog has no
-- exposed create/update function in this phase; it is seed/migration-only
-- (see 20260708120500_seed_material_catalog_demo_data.sql).
-- =============================================================================

create or replace function public.create_tenant_material(
  p_tenant_id uuid,
  p_name text,
  p_category text,
  p_default_unit text,
  p_description text default '',
  p_service_type text default null,
  p_brand text default null,
  p_sku text default null,
  p_supplier_name text default null
)
returns public.material_catalog_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_item public.material_catalog_items;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.user_has_permission(p_tenant_id, 'materials.create') then
    raise exception 'Missing permission: materials.create' using errcode = '42501';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Name is required' using errcode = '22023';
  end if;

  insert into public.material_catalog_items (
    scope, tenant_id, name, description, category, service_type, default_unit, brand, sku, supplier_name
  )
  values (
    'tenant', p_tenant_id, btrim(p_name), coalesce(p_description, ''), p_category, p_service_type, p_default_unit, p_brand, p_sku, p_supplier_name
  )
  returning * into v_item;

  perform public.log_audit_event(p_tenant_id, v_user_id, 'material.created', 'material_catalog_item', v_item.id,
    jsonb_build_object('name', v_item.name));

  return v_item;
end;
$$;

create or replace function public.update_tenant_material(
  p_material_id uuid,
  p_name text,
  p_category text,
  p_default_unit text,
  p_description text,
  p_service_type text,
  p_brand text,
  p_sku text,
  p_supplier_name text
)
returns public.material_catalog_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.material_catalog_items;
  v_result public.material_catalog_items;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.material_catalog_items where id = p_material_id;
  if not found then
    raise exception 'Material not found' using errcode = 'P0002';
  end if;

  if v_row.scope <> 'tenant' then
    raise exception 'The global catalog cannot be edited in this phase' using errcode = '42501';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'materials.update') then
    raise exception 'Missing permission: materials.update' using errcode = '42501';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Name is required' using errcode = '22023';
  end if;

  update public.material_catalog_items
     set name = btrim(p_name), category = p_category, default_unit = p_default_unit,
         description = coalesce(p_description, ''), service_type = p_service_type,
         brand = p_brand, sku = p_sku, supplier_name = p_supplier_name
   where id = p_material_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'material.updated', 'material_catalog_item', p_material_id, '{}'::jsonb);

  return v_result;
end;
$$;

create or replace function public.archive_tenant_material(p_material_id uuid)
returns public.material_catalog_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.material_catalog_items;
  v_result public.material_catalog_items;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.material_catalog_items where id = p_material_id;
  if not found then
    raise exception 'Material not found' using errcode = 'P0002';
  end if;

  if v_row.scope <> 'tenant' then
    raise exception 'The global catalog cannot be archived in this phase' using errcode = '42501';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'materials.archive') then
    raise exception 'Missing permission: materials.archive' using errcode = '42501';
  end if;

  update public.material_catalog_items set is_active = false, archived_at = now() where id = p_material_id returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'material.archived', 'material_catalog_item', p_material_id, '{}'::jsonb);

  return v_result;
end;
$$;

-- =============================================================================
-- Tenant price override CRUD — a tenant may set its own price (for a
-- global material or its own tenant material) at a ZIP/state/default
-- level. price_source is always 'tenant_custom' through this path.
-- =============================================================================

create or replace function public.create_tenant_material_price(
  p_tenant_id uuid,
  p_material_catalog_item_id uuid,
  p_unit_price_cents bigint,
  p_zip_code text default null,
  p_state_code text default null,
  p_city text default null,
  p_supplier_name text default null,
  p_effective_date date default current_date,
  p_expires_at date default null
)
returns public.material_zip_prices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_material public.material_catalog_items;
  v_price public.material_zip_prices;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.user_has_permission(p_tenant_id, 'material_prices.create') then
    raise exception 'Missing permission: material_prices.create' using errcode = '42501';
  end if;

  select * into v_material from public.material_catalog_items
   where id = p_material_catalog_item_id
     and (scope = 'global' or (scope = 'tenant' and tenant_id = p_tenant_id));
  if not found then
    raise exception 'Material not found' using errcode = 'P0002';
  end if;

  if p_unit_price_cents is null or p_unit_price_cents < 0 or p_unit_price_cents > 100000000 then
    raise exception 'Unit price must be between 0 and 100000000 cents' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at < p_effective_date then
    raise exception 'Expiration date cannot be before the effective date' using errcode = '22023';
  end if;

  insert into public.material_zip_prices (
    material_catalog_item_id, tenant_id, zip_code, state_code, city, unit_price_cents,
    price_source, supplier_name, effective_date, expires_at
  )
  values (
    p_material_catalog_item_id, p_tenant_id, p_zip_code, p_state_code, p_city, p_unit_price_cents,
    'tenant_custom', p_supplier_name, coalesce(p_effective_date, current_date), p_expires_at
  )
  returning * into v_price;

  perform public.log_audit_event(p_tenant_id, v_user_id, 'material_price.created', 'material_zip_price', v_price.id,
    jsonb_build_object('material_catalog_item_id', p_material_catalog_item_id, 'unit_price_cents', p_unit_price_cents));

  return v_price;
end;
$$;

create or replace function public.update_tenant_material_price(
  p_price_id uuid,
  p_unit_price_cents bigint,
  p_zip_code text,
  p_state_code text,
  p_city text,
  p_supplier_name text,
  p_effective_date date,
  p_expires_at date
)
returns public.material_zip_prices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.material_zip_prices;
  v_result public.material_zip_prices;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.material_zip_prices where id = p_price_id;
  if not found then
    raise exception 'Price not found' using errcode = 'P0002';
  end if;

  if v_row.tenant_id is null then
    raise exception 'A global price cannot be edited in this phase' using errcode = '42501';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'material_prices.update') then
    raise exception 'Missing permission: material_prices.update' using errcode = '42501';
  end if;

  if p_unit_price_cents is null or p_unit_price_cents < 0 or p_unit_price_cents > 100000000 then
    raise exception 'Unit price must be between 0 and 100000000 cents' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at < p_effective_date then
    raise exception 'Expiration date cannot be before the effective date' using errcode = '22023';
  end if;

  update public.material_zip_prices
     set unit_price_cents = p_unit_price_cents, zip_code = p_zip_code, state_code = p_state_code,
         city = p_city, supplier_name = p_supplier_name,
         effective_date = coalesce(p_effective_date, effective_date), expires_at = p_expires_at
   where id = p_price_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'material_price.updated', 'material_zip_price', p_price_id, '{}'::jsonb);

  return v_result;
end;
$$;

create or replace function public.archive_tenant_material_price(p_price_id uuid)
returns public.material_zip_prices
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.material_zip_prices;
  v_result public.material_zip_prices;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.material_zip_prices where id = p_price_id;
  if not found then
    raise exception 'Price not found' using errcode = 'P0002';
  end if;

  if v_row.tenant_id is null then
    raise exception 'A global price cannot be archived in this phase' using errcode = '42501';
  end if;

  if not public.user_has_permission(v_row.tenant_id, 'material_prices.archive') then
    raise exception 'Missing permission: material_prices.archive' using errcode = '42501';
  end if;

  update public.material_zip_prices set archived_at = now() where id = p_price_id returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'material_price.archived', 'material_zip_price', p_price_id, '{}'::jsonb);

  return v_result;
end;
$$;

-- =============================================================================
-- Proposal ZIP + add-from-catalog — the actual snapshot write path.
-- =============================================================================

create or replace function public.update_proposal_pricing_zip(
  p_proposal_version_id uuid,
  p_zip_code text,
  p_state_code text default null,
  p_city text default null
)
returns public.proposal_versions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_version public.proposal_versions;
  v_result public.proposal_versions;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_version from public.proposal_versions where id = p_proposal_version_id;
  if not found then
    raise exception 'Proposal version not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_version.tenant_id, 'proposals.update') then
    raise exception 'Missing permission: proposals.update' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  if p_zip_code is not null and p_zip_code !~ '^\d{5}$' then
    raise exception 'ZIP code must be 5 digits' using errcode = '22023';
  end if;

  -- Deliberately touches ONLY this version's pricing_zip_code/state/city.
  -- Every already-added proposal_line_items row keeps its own
  -- source_zip_code/unit_price_cents snapshot untouched -- changing the
  -- version's ZIP only affects materials added AFTER this call. See
  -- docs/42-material-catalog-by-zip.md, "Changing the ZIP".
  update public.proposal_versions
     set pricing_zip_code = p_zip_code, pricing_state_code = p_state_code, pricing_city = p_city
   where id = p_proposal_version_id
   returning * into v_result;

  perform public.log_audit_event(v_version.tenant_id, v_user_id, 'proposal.pricing_zip_updated', 'proposal_version', p_proposal_version_id,
    jsonb_build_object('zip_code', p_zip_code));

  return v_result;
end;
$$;

create or replace function public.add_proposal_line_item_from_catalog(
  p_proposal_version_id uuid,
  p_material_catalog_item_id uuid,
  p_quantity numeric,
  p_zip_code text default null,
  p_unit_price_cents_override bigint default null,
  p_taxable boolean default true,
  p_section_id uuid default null,
  p_sort_order int default 0
)
returns public.proposal_line_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_version public.proposal_versions;
  v_material public.material_catalog_items;
  v_price public.material_zip_prices;
  v_zip text;
  v_unit_price_cents bigint;
  v_line_total bigint;
  v_item public.proposal_line_items;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_version from public.proposal_versions where id = p_proposal_version_id;
  if not found then
    raise exception 'Proposal version not found' using errcode = 'P0002';
  end if;

  -- Adding an item AT its catalog price is not itself a pricing decision
  -- (proposals.update, which Sales already has) -- OVERRIDING that price
  -- with a manual value is, and requires proposals.manage_pricing, which
  -- Sales deliberately lacks (see 20260706141600_seed_proposal_permissions.sql).
  if not public.user_has_permission(v_version.tenant_id, 'proposals.update') then
    raise exception 'Missing permission: proposals.update' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  select * into v_material from public.material_catalog_items
   where id = p_material_catalog_item_id
     and (scope = 'global' or (scope = 'tenant' and tenant_id = v_version.tenant_id));
  if not found then
    raise exception 'Material catalog item not found' using errcode = 'P0002';
  end if;
  if v_material.archived_at is not null or not v_material.is_active then
    raise exception 'This material is no longer available' using errcode = '22023';
  end if;

  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000 then
    raise exception 'Quantity must be greater than zero' using errcode = '22023';
  end if;
  if p_section_id is not null and not exists (
    select 1 from public.proposal_sections where id = p_section_id and proposal_version_id = p_proposal_version_id
  ) then
    raise exception 'Section does not belong to this proposal version' using errcode = '22023';
  end if;

  v_zip := coalesce(p_zip_code, v_version.pricing_zip_code);
  v_price := public.find_material_zip_price(p_material_catalog_item_id, v_version.tenant_id, v_zip);

  if p_unit_price_cents_override is not null then
    if not public.user_has_permission(v_version.tenant_id, 'proposals.manage_pricing') then
      raise exception 'Missing permission: proposals.manage_pricing' using errcode = '42501';
    end if;
    if p_unit_price_cents_override < 0 then
      raise exception 'Unit price cannot be negative' using errcode = '22023';
    end if;
    v_unit_price_cents := p_unit_price_cents_override;
  else
    if v_price is null then
      raise exception 'No price available for this ZIP' using errcode = '22023';
    end if;
    v_unit_price_cents := v_price.unit_price_cents;
  end if;

  v_line_total := round(p_quantity * v_unit_price_cents);

  -- The snapshot: description/unit/unit_price_cents/quantity/line_total_cents
  -- are copied here and NEVER re-read from material_catalog_items /
  -- material_zip_prices again -- a later catalog or price change cannot
  -- retroactively change this row. source_* columns are provenance only.
  insert into public.proposal_line_items (
    tenant_id, proposal_version_id, section_id, category, description, quantity, unit,
    unit_price_cents, line_total_cents, taxable, sort_order,
    material_catalog_item_id, material_zip_price_id, source_type, source_zip_code,
    source_supplier_name, source_price_effective_date
  )
  values (
    v_version.tenant_id, p_proposal_version_id, p_section_id, 'material', v_material.name, p_quantity, v_material.default_unit,
    v_unit_price_cents, v_line_total, p_taxable, p_sort_order,
    v_material.id, v_price.id, 'catalog', v_zip,
    coalesce(v_price.supplier_name, v_material.supplier_name),
    v_price.effective_date
  )
  returning * into v_item;

  perform public.recalculate_proposal_version(p_proposal_version_id);

  perform public.log_audit_event(v_version.tenant_id, v_user_id, 'proposal.line_item_created_from_catalog', 'proposal_line_item', v_item.id,
    jsonb_build_object('proposal_version_id', p_proposal_version_id, 'material_catalog_item_id', p_material_catalog_item_id, 'line_total_cents', v_line_total));

  return v_item;
end;
$$;

comment on function public.add_proposal_line_item_from_catalog(uuid, uuid, numeric, text, bigint, boolean, uuid, int) is
  'Adds a proposal_line_items row snapshotting the catalog material''s name/unit and the resolved ZIP price (or an explicit manual override, gated by proposals.manage_pricing). Never re-reads the catalog/price after insert -- see docs/42-material-catalog-by-zip.md, "Proposal item snapshot".';

-- =============================================================================
-- Grants
-- =============================================================================

revoke execute on function public.find_material_zip_price(uuid, uuid, text) from public;
grant execute on function public.find_material_zip_price(uuid, uuid, text) to authenticated;

revoke execute on function public.search_material_catalog(uuid, text, text, text, text) from public;
grant execute on function public.search_material_catalog(uuid, text, text, text, text) to authenticated;

revoke execute on function public.create_tenant_material(uuid, text, text, text, text, text, text, text, text) from public;
grant execute on function public.create_tenant_material(uuid, text, text, text, text, text, text, text, text) to authenticated;
revoke execute on function public.update_tenant_material(uuid, text, text, text, text, text, text, text, text) from public;
grant execute on function public.update_tenant_material(uuid, text, text, text, text, text, text, text, text) to authenticated;
revoke execute on function public.archive_tenant_material(uuid) from public;
grant execute on function public.archive_tenant_material(uuid) to authenticated;

revoke execute on function public.create_tenant_material_price(uuid, uuid, bigint, text, text, text, text, date, date) from public;
grant execute on function public.create_tenant_material_price(uuid, uuid, bigint, text, text, text, text, date, date) to authenticated;
revoke execute on function public.update_tenant_material_price(uuid, bigint, text, text, text, text, date, date) from public;
grant execute on function public.update_tenant_material_price(uuid, bigint, text, text, text, text, date, date) to authenticated;
revoke execute on function public.archive_tenant_material_price(uuid) from public;
grant execute on function public.archive_tenant_material_price(uuid) to authenticated;

revoke execute on function public.update_proposal_pricing_zip(uuid, text, text, text) from public;
grant execute on function public.update_proposal_pricing_zip(uuid, text, text, text) to authenticated;
revoke execute on function public.add_proposal_line_item_from_catalog(uuid, uuid, numeric, text, bigint, boolean, uuid, int) from public;
grant execute on function public.add_proposal_line_item_from_catalog(uuid, uuid, numeric, text, bigint, boolean, uuid, int) to authenticated;
