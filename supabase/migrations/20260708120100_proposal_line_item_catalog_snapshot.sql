-- Phase 2B: proposal_line_items gains an optional snapshot of the catalog
-- material/price it came from. The snapshot fields already on this table
-- (description, unit, unit_price_cents, quantity, line_total_cents,
-- taxable) are what the calculation engine and every display always
-- read — a later change to the catalog or its prices NEVER retroactively
-- changes an existing proposal. The columns added here are purely
-- provenance/audit metadata: which catalog item and which price row (if
-- any) this line item was created from, and what ZIP/supplier/effective
-- date were in effect at that moment. See
-- docs/42-material-catalog-by-zip.md, "Proposal item snapshot".

alter table public.proposal_line_items
  add column material_catalog_item_id uuid references public.material_catalog_items (id),
  add column material_zip_price_id uuid references public.material_zip_prices (id),
  add column source_type text not null default 'custom' check (source_type in ('catalog', 'custom')),
  add column source_zip_code text check (source_zip_code is null or source_zip_code ~ '^\d{5}$'),
  add column source_supplier_name text,
  add column source_price_effective_date date;

alter table public.proposal_line_items
  add constraint proposal_line_items_source_check check (
    (source_type = 'custom' and material_catalog_item_id is null and material_zip_price_id is null)
    or (source_type = 'catalog' and material_catalog_item_id is not null)
  );

comment on column public.proposal_line_items.source_type is
  'custom: the contractor typed this line in manually. catalog: added from the material catalog — material_catalog_item_id/material_zip_price_id/source_* columns record what was picked and at what price, purely for provenance. The authoritative values actually used everywhere are the snapshot columns that already existed (description/unit/unit_price_cents/quantity/line_total_cents/taxable) — a later catalog/price change never changes this row.';

-- Enforces "no proposal_line_item de Tenant A referenciando material/price
-- de Tenant B": the plain FKs above only guarantee the referenced rows
-- exist, not that they belong to an accessible tenant — a composite FK
-- can't express this cleanly since a referenced material/price may
-- legitimately be scope=global (tenant_id null). Same approach as
-- prevent_cross_tenant_material_price() in 20260708120000_material_catalog.sql.
create or replace function public.prevent_cross_tenant_material_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_material public.material_catalog_items;
  v_price public.material_zip_prices;
begin
  if new.material_catalog_item_id is not null then
    select * into v_material from public.material_catalog_items where id = new.material_catalog_item_id;
    if not found then
      raise exception 'Material catalog item not found' using errcode = 'P0002';
    end if;
    if v_material.scope = 'tenant' and v_material.tenant_id is distinct from new.tenant_id then
      raise exception 'Cannot reference another tenant''s custom material' using errcode = '23514';
    end if;
  end if;

  if new.material_zip_price_id is not null then
    select * into v_price from public.material_zip_prices where id = new.material_zip_price_id;
    if not found then
      raise exception 'Material price not found' using errcode = 'P0002';
    end if;
    if v_price.tenant_id is not null and v_price.tenant_id is distinct from new.tenant_id then
      raise exception 'Cannot reference another tenant''s material price' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_proposal_line_items_prevent_cross_tenant_material
  before insert or update on public.proposal_line_items
  for each row execute function public.prevent_cross_tenant_material_reference();

-- proposal_versions gains an optional ZIP used for catalog pricing.
-- Changing it only affects materials added AFTER the change — every
-- already-added line item keeps its own snapshot regardless (see above).
alter table public.proposal_versions
  add column pricing_zip_code text check (pricing_zip_code is null or pricing_zip_code ~ '^\d{5}$'),
  add column pricing_state_code text check (pricing_state_code is null or pricing_state_code ~ '^[A-Z]{2}$'),
  add column pricing_city text;

comment on column public.proposal_versions.pricing_zip_code is
  'The ZIP code used to look up catalog material prices in the Materials & Costs step. Optional. Changing it only affects materials added after the change -- proposal_line_items.source_zip_code preserves what was actually used for each existing item.';
