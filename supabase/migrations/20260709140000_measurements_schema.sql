-- Phase 2C: Measurements / Takeoff builder — schema.
-- See docs/45-measurements-takeoff-builder.md and
-- docs/46-measurement-calculation-engine.md.
--
-- proposal_version_id is denormalized onto every table here (not just
-- reachable via a join to the parent) to match this codebase's
-- established pattern (proposal_line_items, proposal_media, etc.) and
-- so the existing generic prevent_locked_version_child_mutation()
-- trigger (which reads NEW/OLD.proposal_version_id directly) can be
-- reused unchanged on all four new tables.

-- =============================================================================
-- proposal_measurement_groups — a named grouping of measurements (e.g.
-- "Bathroom"). unit_system is picked once per group; imperial (ft) is
-- the default because the initial market is US contractors.
-- =============================================================================
create table public.proposal_measurement_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  proposal_version_id uuid not null,
  name text not null check (btrim(name) <> ''),
  service_type text check (service_type is null or service_type in (
    'interior_painting', 'exterior_painting', 'bathroom_remodeling',
    'general_remodeling', 'flooring', 'custom'
  )),
  unit_system text not null default 'imperial' check (unit_system in ('imperial', 'metric')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, tenant_id),
  foreign key (proposal_version_id, tenant_id) references public.proposal_versions (id, tenant_id)
);

comment on table public.proposal_measurement_groups is
  'A named grouping of measurements within one proposal version (e.g. "Bathroom"). unit_system picked once per group -- ft (imperial) or m (metric), never mixed within a group without explicit conversion. See docs/45-measurements-takeoff-builder.md.';

create index proposal_measurement_groups_version_idx on public.proposal_measurement_groups (proposal_version_id) where archived_at is null;

create trigger trg_proposal_measurement_groups_set_updated_at
  before update on public.proposal_measurement_groups
  for each row execute function public.set_updated_at();

create trigger trg_proposal_measurement_groups_prevent_locked_mutation
  before insert or update or delete on public.proposal_measurement_groups
  for each row execute function public.prevent_locked_version_child_mutation();

-- =============================================================================
-- proposal_measurements — one measured value (a floor, a wall, a run of
-- trim). Each row is single-purpose: measurement_type decides which of
-- area/perimeter/linear_length is the meaningful output, computed
-- server-side by add_measurement()/save_measurement_shape() -- see
-- docs/46-measurement-calculation-engine.md for the exact formulas.
-- `unit` is the BASE linear unit (ft or m) for this row; area is
-- implicitly sq_ft/sq_m and linear values are implicitly ft/m -- no
-- separate unit column per field, to avoid a combinatorial unit-enum
-- explosion for one row.
-- =============================================================================
create table public.proposal_measurements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  proposal_version_id uuid not null,
  measurement_group_id uuid not null,
  name text not null check (btrim(name) <> ''),
  measurement_type text not null check (measurement_type in (
    'floor_area', 'wall_area', 'ceiling_area', 'room', 'surface', 'linear', 'custom'
  )),
  shape_type text not null check (shape_type in (
    'manual_rectangle', 'manual_area', 'manual_linear', 'sketch_rectangle', 'sketch_polygon', 'custom'
  )),
  length numeric(12,4) check (length is null or length > 0),
  width numeric(12,4) check (width is null or width > 0),
  height numeric(12,4) check (height is null or height > 0),
  area numeric(14,4) check (area is null or area > 0),
  perimeter numeric(14,4) check (perimeter is null or perimeter > 0),
  -- Reserved for a future phase (e.g. cubic yards of concrete/fill) --
  -- no formula in this phase computes it; always null for now.
  volume numeric(14,4) check (volume is null or volume > 0),
  linear_length numeric(12,4) check (linear_length is null or linear_length > 0),
  unit text not null check (unit in ('ft', 'm')),
  waste_bps int not null default 0 check (waste_bps >= 0 and waste_bps <= 10000),
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, tenant_id),
  foreign key (proposal_version_id, tenant_id) references public.proposal_versions (id, tenant_id),
  foreign key (measurement_group_id, tenant_id) references public.proposal_measurement_groups (id, tenant_id),
  -- A saved measurement must actually measure something -- reject an
  -- all-null row (e.g. a sketch not yet calibrated should not be saved
  -- as a real measurement until it has at least one computed value).
  constraint proposal_measurements_has_value_check check (
    area is not null or perimeter is not null or linear_length is not null
  )
);

comment on table public.proposal_measurements is
  'One measured value (a floor, a wall, a linear run of trim). area/perimeter/linear_length are always server-computed by add_measurement()/save_measurement_shape() -- never accepted from the client as final values. See docs/46-measurement-calculation-engine.md for formulas and rounding.';

create index proposal_measurements_version_idx on public.proposal_measurements (proposal_version_id, sort_order) where archived_at is null;
create index proposal_measurements_group_idx on public.proposal_measurements (measurement_group_id) where archived_at is null;

create trigger trg_proposal_measurements_set_updated_at
  before update on public.proposal_measurements
  for each row execute function public.set_updated_at();

create trigger trg_proposal_measurements_prevent_locked_mutation
  before insert or update or delete on public.proposal_measurements
  for each row execute function public.prevent_locked_version_child_mutation();

-- =============================================================================
-- proposal_measurement_shapes — the drawn geometry for a sketch-mode
-- measurement. Rectangle-only in this phase (see
-- docs/47-drawing-sketch-mode.md for the polygon limitation). shape_data
-- is JSONB (points + viewport + shape type) -- geometry, not a
-- business relation, and explicitly NOT an image: bounded to a small
-- size to guarantee nobody stores a base64 image blob here.
-- =============================================================================
create table public.proposal_measurement_shapes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  proposal_version_id uuid not null,
  proposal_measurement_id uuid not null,
  shape_data jsonb not null check (octet_length(shape_data::text) <= 20000),
  scale_reference_length numeric(12,4) check (scale_reference_length is null or scale_reference_length > 0),
  scale_unit text check (scale_unit is null or scale_unit in ('ft', 'm')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  unique (proposal_measurement_id),
  foreign key (proposal_version_id, tenant_id) references public.proposal_versions (id, tenant_id),
  foreign key (proposal_measurement_id, tenant_id) references public.proposal_measurements (id, tenant_id)
);

comment on table public.proposal_measurement_shapes is
  'The drawn rectangle for a sketch-mode measurement -- shape_data is small JSONB geometry (points, viewport, scale), never an image. At most one shape per measurement (unique proposal_measurement_id). See docs/47-drawing-sketch-mode.md.';

create trigger trg_proposal_measurement_shapes_set_updated_at
  before update on public.proposal_measurement_shapes
  for each row execute function public.set_updated_at();

create trigger trg_proposal_measurement_shapes_prevent_locked_mutation
  before insert or update or delete on public.proposal_measurement_shapes
  for each row execute function public.prevent_locked_version_child_mutation();

-- =============================================================================
-- proposal_measurement_materials — records that a catalog material was
-- generated FROM a measurement: which measurement, which field of it
-- (area/perimeter/linear_length), what coverage/waste/coats were used,
-- and the resulting proposal_line_items row. Mirrors proposal_line_items'
-- own snapshot columns -- unit_price_cents_snapshot/total_cents_snapshot
-- are copied at generation time and never re-read from the catalog
-- afterward, exactly like a normal catalog-sourced line item.
-- =============================================================================
create table public.proposal_measurement_materials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  proposal_version_id uuid not null,
  proposal_measurement_id uuid not null,
  material_catalog_item_id uuid not null references public.material_catalog_items (id),
  material_zip_price_id uuid references public.material_zip_prices (id),
  proposal_line_item_id uuid,
  measurement_value_field text not null check (measurement_value_field in ('area', 'perimeter', 'linear_length')),
  coverage_rate numeric(12,4) not null check (coverage_rate > 0),
  coverage_unit text,
  coats int not null default 1 check (coats > 0 and coats <= 20),
  waste_bps int not null default 0 check (waste_bps >= 0 and waste_bps <= 10000),
  calculated_quantity numeric(12,4) not null check (calculated_quantity > 0),
  unit text not null,
  unit_price_cents_snapshot bigint not null check (unit_price_cents_snapshot >= 0),
  total_cents_snapshot bigint not null check (total_cents_snapshot >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (proposal_version_id, tenant_id) references public.proposal_versions (id, tenant_id),
  foreign key (proposal_measurement_id, tenant_id) references public.proposal_measurements (id, tenant_id),
  foreign key (proposal_line_item_id, tenant_id) references public.proposal_line_items (id, tenant_id)
);

comment on table public.proposal_measurement_materials is
  'Provenance: which measurement generated which catalog material at what quantity/price. unit_price_cents_snapshot/total_cents_snapshot are copied at generation time and never re-read afterward -- the linked proposal_line_items row is what actually drives calculation/display, exactly like any other catalog-sourced line item. See docs/46-measurement-calculation-engine.md.';

create index proposal_measurement_materials_measurement_idx on public.proposal_measurement_materials (proposal_measurement_id);
create index proposal_measurement_materials_version_idx on public.proposal_measurement_materials (proposal_version_id);

create trigger trg_proposal_measurement_materials_set_updated_at
  before update on public.proposal_measurement_materials
  for each row execute function public.set_updated_at();

create trigger trg_proposal_measurement_materials_prevent_locked_mutation
  before insert or update or delete on public.proposal_measurement_materials
  for each row execute function public.prevent_locked_version_child_mutation();

-- =============================================================================
-- Cross-tenant integrity for the global/tenant catalog duality --
-- same pattern as prevent_cross_tenant_material_reference() on
-- proposal_line_items (20260708120100), since material_catalog_items/
-- material_zip_prices can legitimately have tenant_id = null (global).
-- =============================================================================
create or replace function public.prevent_cross_tenant_measurement_material()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_material public.material_catalog_items;
  v_price public.material_zip_prices;
begin
  select * into v_material from public.material_catalog_items where id = new.material_catalog_item_id;
  if not found then
    raise exception 'Material catalog item not found' using errcode = 'P0002';
  end if;
  if v_material.scope = 'tenant' and v_material.tenant_id is distinct from new.tenant_id then
    raise exception 'Cannot reference another tenant''s custom material' using errcode = '23514';
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

create trigger trg_proposal_measurement_materials_prevent_cross_tenant
  before insert or update on public.proposal_measurement_materials
  for each row execute function public.prevent_cross_tenant_measurement_material();
