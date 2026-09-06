-- Phase 2C: Measurements / Takeoff builder — functions.
--
-- Permission split: creating/editing a measurement itself is gated by
-- the new measurements.view/create/update/archive permissions (NOT
-- proposals.update) -- Field Worker can create measurements per the
-- brief's matrix despite never holding proposals.update at all.
-- Generating a material or labor item FROM a measurement is gated by
-- measurements.generate_materials, which only Owner/Admin/Estimator
-- hold in the seed matrix (Sales/Field Worker lack
-- proposals.manage_pricing, and the brief conditions generate-from-
-- measurement on holding pricing permission) -- see
-- docs/48-measurement-rls-verification.md.
--
-- All dimensions are rounded to 2 decimal places server-side (numeric,
-- never float) -- see docs/46-measurement-calculation-engine.md for the
-- full rounding table.

-- =============================================================================
-- Measurement groups
-- =============================================================================

create or replace function public.create_measurement_group(
  p_proposal_version_id uuid,
  p_name text,
  p_unit_system text default 'imperial',
  p_service_type text default null
)
returns public.proposal_measurement_groups
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_version public.proposal_versions;
  v_group public.proposal_measurement_groups;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_version from public.proposal_versions where id = p_proposal_version_id;
  if not found then
    raise exception 'Proposal version not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_version.tenant_id, 'measurements.create') then
    raise exception 'Missing permission: measurements.create' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Name is required' using errcode = '22023';
  end if;
  if p_unit_system not in ('imperial', 'metric') then
    raise exception 'Invalid unit system' using errcode = '22023';
  end if;

  insert into public.proposal_measurement_groups (tenant_id, proposal_version_id, name, service_type, unit_system, created_by)
  values (v_version.tenant_id, p_proposal_version_id, btrim(p_name), p_service_type, p_unit_system, v_user_id)
  returning * into v_group;

  perform public.log_audit_event(v_version.tenant_id, v_user_id, 'proposal.measurement_group_created', 'proposal_measurement_group', v_group.id,
    jsonb_build_object('proposal_version_id', p_proposal_version_id, 'name', v_group.name));

  return v_group;
end;
$$;

-- =============================================================================
-- Manual measurements — rectangle/area/linear. shape_type='sketch_*' is
-- NOT accepted here; see save_measurement_shape() below for drawn shapes.
-- =============================================================================

create or replace function public.add_measurement(
  p_proposal_version_id uuid,
  p_measurement_group_id uuid,
  p_name text,
  p_measurement_type text,
  p_shape_type text,
  p_unit text,
  p_length numeric default null,
  p_width numeric default null,
  p_height numeric default null,
  p_area numeric default null,
  p_linear_length numeric default null,
  p_waste_bps int default 0,
  p_notes text default null,
  p_sort_order int default 0
)
returns public.proposal_measurements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_version public.proposal_versions;
  v_area numeric(14,4);
  v_perimeter numeric(14,4);
  v_linear numeric(12,4);
  v_measurement public.proposal_measurements;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_version from public.proposal_versions where id = p_proposal_version_id;
  if not found then
    raise exception 'Proposal version not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_version.tenant_id, 'measurements.create') then
    raise exception 'Missing permission: measurements.create' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  if not exists (
    select 1 from public.proposal_measurement_groups
     where id = p_measurement_group_id and proposal_version_id = p_proposal_version_id
  ) then
    raise exception 'Measurement group does not belong to this proposal version' using errcode = '22023';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Name is required' using errcode = '22023';
  end if;
  if p_unit not in ('ft', 'm') then
    raise exception 'Invalid unit' using errcode = '22023';
  end if;
  if p_waste_bps is null or p_waste_bps < 0 or p_waste_bps > 10000 then
    raise exception 'Waste percentage must be between 0%% and 100%%' using errcode = '22023';
  end if;

  if p_shape_type = 'manual_rectangle' then
    if p_length is null or p_length <= 0 or p_width is null or p_width <= 0 then
      raise exception 'Length and width must be greater than zero' using errcode = '22023';
    end if;
    v_perimeter := round(2 * (p_length + p_width), 2);
    if p_measurement_type = 'wall_area' then
      -- wall_area = perimeter x height (docs/46, "Room wall area") --
      -- length/width describe the room's floor footprint, used only to
      -- derive the perimeter; the stored `area` is the WALL area.
      if p_height is null or p_height <= 0 then
        raise exception 'Height is required to calculate wall area' using errcode = '22023';
      end if;
      v_area := round(v_perimeter * p_height, 2);
    else
      v_area := round(p_length * p_width, 2);
    end if;
    v_linear := null;
  elsif p_shape_type = 'manual_area' then
    if p_area is null or p_area <= 0 then
      raise exception 'Area must be greater than zero' using errcode = '22023';
    end if;
    v_area := round(p_area, 2);
    v_perimeter := null;
    v_linear := null;
  elsif p_shape_type = 'manual_linear' then
    if p_linear_length is null or p_linear_length <= 0 then
      raise exception 'Linear length must be greater than zero' using errcode = '22023';
    end if;
    v_linear := round(p_linear_length, 2);
    v_area := null;
    v_perimeter := null;
  else
    raise exception 'Unsupported shape type for manual entry -- use save_measurement_shape() for drawn shapes' using errcode = '22023';
  end if;

  insert into public.proposal_measurements (
    tenant_id, proposal_version_id, measurement_group_id, name, measurement_type, shape_type,
    length, width, height, area, perimeter, linear_length, unit, waste_bps, notes, sort_order
  )
  values (
    v_version.tenant_id, p_proposal_version_id, p_measurement_group_id, btrim(p_name), p_measurement_type, p_shape_type,
    p_length, p_width, p_height, v_area, v_perimeter, v_linear, p_unit, p_waste_bps, p_notes, p_sort_order
  )
  returning * into v_measurement;

  perform public.log_audit_event(v_version.tenant_id, v_user_id, 'proposal.measurement_created', 'proposal_measurement', v_measurement.id,
    jsonb_build_object('proposal_version_id', p_proposal_version_id, 'measurement_type', p_measurement_type, 'shape_type', p_shape_type));

  return v_measurement;
end;
$$;

comment on function public.add_measurement(uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric, int, text, int) is
  'area/perimeter/linear_length are always server-computed, never accepted from the client. wall_area uses perimeter x height; floor/ceiling use length x width. See docs/46-measurement-calculation-engine.md.';

create or replace function public.update_measurement(
  p_measurement_id uuid,
  p_name text,
  p_measurement_type text,
  p_length numeric default null,
  p_width numeric default null,
  p_height numeric default null,
  p_area numeric default null,
  p_linear_length numeric default null,
  p_waste_bps int default 0,
  p_notes text default null
)
returns public.proposal_measurements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.proposal_measurements;
  v_version public.proposal_versions;
  v_area numeric(14,4);
  v_perimeter numeric(14,4);
  v_linear numeric(12,4);
  v_result public.proposal_measurements;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.proposal_measurements where id = p_measurement_id;
  if not found then
    raise exception 'Measurement not found' using errcode = 'P0002';
  end if;

  select * into v_version from public.proposal_versions where id = v_row.proposal_version_id;

  if not public.user_has_permission(v_row.tenant_id, 'measurements.update') then
    raise exception 'Missing permission: measurements.update' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Name is required' using errcode = '22023';
  end if;
  if p_waste_bps is null or p_waste_bps < 0 or p_waste_bps > 10000 then
    raise exception 'Waste percentage must be between 0%% and 100%%' using errcode = '22023';
  end if;

  if v_row.shape_type = 'manual_rectangle' then
    if p_length is null or p_length <= 0 or p_width is null or p_width <= 0 then
      raise exception 'Length and width must be greater than zero' using errcode = '22023';
    end if;
    v_perimeter := round(2 * (p_length + p_width), 2);
    if p_measurement_type = 'wall_area' then
      if p_height is null or p_height <= 0 then
        raise exception 'Height is required to calculate wall area' using errcode = '22023';
      end if;
      v_area := round(v_perimeter * p_height, 2);
    else
      v_area := round(p_length * p_width, 2);
    end if;
    v_linear := null;
  elsif v_row.shape_type = 'manual_area' then
    if p_area is null or p_area <= 0 then
      raise exception 'Area must be greater than zero' using errcode = '22023';
    end if;
    v_area := round(p_area, 2);
    v_perimeter := null;
    v_linear := null;
  elsif v_row.shape_type = 'manual_linear' then
    if p_linear_length is null or p_linear_length <= 0 then
      raise exception 'Linear length must be greater than zero' using errcode = '22023';
    end if;
    v_linear := round(p_linear_length, 2);
    v_area := null;
    v_perimeter := null;
  else
    raise exception 'This measurement was drawn -- edit it from the Draw layout tab' using errcode = '22023';
  end if;

  update public.proposal_measurements
     set name = btrim(p_name), measurement_type = p_measurement_type,
         length = p_length, width = p_width, height = p_height,
         area = v_area, perimeter = v_perimeter, linear_length = v_linear,
         waste_bps = p_waste_bps, notes = p_notes
   where id = p_measurement_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'proposal.measurement_updated', 'proposal_measurement', p_measurement_id, '{}'::jsonb);

  return v_result;
end;
$$;

create or replace function public.archive_measurement(p_measurement_id uuid)
returns public.proposal_measurements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.proposal_measurements;
  v_version public.proposal_versions;
  v_result public.proposal_measurements;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.proposal_measurements where id = p_measurement_id;
  if not found then
    raise exception 'Measurement not found' using errcode = 'P0002';
  end if;

  select * into v_version from public.proposal_versions where id = v_row.proposal_version_id;

  if not public.user_has_permission(v_row.tenant_id, 'measurements.archive') then
    raise exception 'Missing permission: measurements.archive' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  -- Archiving a measurement is bookkeeping only -- any material/labor
  -- already generated from it stays exactly as-is (their own snapshot
  -- columns, not this row, drive their totals), so no recalculation is
  -- needed here.
  update public.proposal_measurements set archived_at = now() where id = p_measurement_id returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'proposal.measurement_archived', 'proposal_measurement', p_measurement_id, '{}'::jsonb);

  return v_result;
end;
$$;

-- =============================================================================
-- Sketch mode — save a drawn (rectangle-only, see docs/47) shape and its
-- calibrated real-world measurement together. The client computes
-- length/width from the drawn pixel rectangle and the user-entered
-- reference length (ordinary arithmetic, no different from typing them
-- directly) -- but exactly like everywhere else in this codebase, the
-- server is what actually computes and persists area/perimeter, never
-- trusting a client-supplied area.
-- =============================================================================

create or replace function public.save_measurement_shape(
  p_proposal_version_id uuid,
  p_measurement_group_id uuid,
  p_name text,
  p_measurement_type text,
  p_unit text,
  p_length numeric,
  p_width numeric,
  p_scale_reference_length numeric,
  p_scale_unit text,
  p_shape_data jsonb,
  p_waste_bps int default 0,
  p_notes text default null,
  p_sort_order int default 0
)
returns public.proposal_measurements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_version public.proposal_versions;
  v_area numeric(14,4);
  v_perimeter numeric(14,4);
  v_measurement public.proposal_measurements;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_version from public.proposal_versions where id = p_proposal_version_id;
  if not found then
    raise exception 'Proposal version not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_version.tenant_id, 'measurements.create') then
    raise exception 'Missing permission: measurements.create' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  if not exists (
    select 1 from public.proposal_measurement_groups
     where id = p_measurement_group_id and proposal_version_id = p_proposal_version_id
  ) then
    raise exception 'Measurement group does not belong to this proposal version' using errcode = '22023';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Name is required' using errcode = '22023';
  end if;
  if p_unit not in ('ft', 'm') or p_scale_unit not in ('ft', 'm') then
    raise exception 'Invalid unit' using errcode = '22023';
  end if;
  if p_length is null or p_length <= 0 or p_width is null or p_width <= 0 then
    raise exception 'The drawn rectangle must have a positive width and height' using errcode = '22023';
  end if;
  if p_scale_reference_length is null or p_scale_reference_length <= 0 then
    raise exception 'A real-world reference length is required to scale the drawing' using errcode = '22023';
  end if;
  if p_waste_bps is null or p_waste_bps < 0 or p_waste_bps > 10000 then
    raise exception 'Waste percentage must be between 0%% and 100%%' using errcode = '22023';
  end if;

  v_area := round(p_length * p_width, 2);
  v_perimeter := round(2 * (p_length + p_width), 2);

  insert into public.proposal_measurements (
    tenant_id, proposal_version_id, measurement_group_id, name, measurement_type, shape_type,
    length, width, area, perimeter, unit, waste_bps, notes, sort_order
  )
  values (
    v_version.tenant_id, p_proposal_version_id, p_measurement_group_id, btrim(p_name), p_measurement_type, 'sketch_rectangle',
    p_length, p_width, v_area, v_perimeter, p_unit, p_waste_bps, p_notes, p_sort_order
  )
  returning * into v_measurement;

  insert into public.proposal_measurement_shapes (
    tenant_id, proposal_version_id, proposal_measurement_id, shape_data, scale_reference_length, scale_unit
  )
  values (
    v_version.tenant_id, p_proposal_version_id, v_measurement.id, p_shape_data, p_scale_reference_length, p_scale_unit
  );

  perform public.log_audit_event(v_version.tenant_id, v_user_id, 'proposal.measurement_created', 'proposal_measurement', v_measurement.id,
    jsonb_build_object('proposal_version_id', p_proposal_version_id, 'shape_type', 'sketch_rectangle'));

  return v_measurement;
end;
$$;

comment on function public.save_measurement_shape(uuid, uuid, text, text, text, numeric, numeric, numeric, text, jsonb, int, text, int) is
  'Saves a drawn rectangle: the client scales pixel dimensions to real-world length/width using the user-entered reference length, but area/perimeter are always recomputed server-side from length/width, exactly like a manual rectangle. See docs/47-drawing-sketch-mode.md.';

-- =============================================================================
-- Generate a catalog material from a measurement — mirrors
-- add_proposal_line_item_from_catalog()'s material lookup/price
-- resolution exactly, plus records the measurement provenance.
-- =============================================================================

create or replace function public.generate_material_from_measurement(
  p_proposal_version_id uuid,
  p_proposal_measurement_id uuid,
  p_material_catalog_item_id uuid,
  p_measurement_value_field text,
  p_coverage_rate numeric,
  p_coverage_unit text default null,
  p_coats int default 1,
  p_waste_bps int default 0,
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
  v_measurement public.proposal_measurements;
  v_material public.material_catalog_items;
  v_price public.material_zip_prices;
  v_zip text;
  v_measurement_value numeric;
  v_unit_price_cents bigint;
  v_raw_quantity numeric;
  v_calculated_quantity numeric(12,4);
  v_line_total bigint;
  v_line_item public.proposal_line_items;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_version from public.proposal_versions where id = p_proposal_version_id;
  if not found then
    raise exception 'Proposal version not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_version.tenant_id, 'measurements.generate_materials') then
    raise exception 'Missing permission: measurements.generate_materials' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  select * into v_measurement
    from public.proposal_measurements
   where id = p_proposal_measurement_id and proposal_version_id = p_proposal_version_id;
  if not found then
    raise exception 'Measurement not found on this proposal' using errcode = 'P0002';
  end if;

  if p_measurement_value_field not in ('area', 'perimeter', 'linear_length') then
    raise exception 'Invalid measurement field' using errcode = '22023';
  end if;

  v_measurement_value := case p_measurement_value_field
    when 'area' then v_measurement.area
    when 'perimeter' then v_measurement.perimeter
    when 'linear_length' then v_measurement.linear_length
  end;
  if v_measurement_value is null then
    raise exception 'This measurement has no value for the selected field' using errcode = '22023';
  end if;

  if p_coverage_rate is null or p_coverage_rate <= 0 then
    raise exception 'Coverage rate must be greater than zero' using errcode = '22023';
  end if;
  if p_coats is null or p_coats <= 0 or p_coats > 20 then
    raise exception 'Coats must be between 1 and 20' using errcode = '22023';
  end if;
  if p_waste_bps is null or p_waste_bps < 0 or p_waste_bps > 10000 then
    raise exception 'Waste percentage must be between 0%% and 100%%' using errcode = '22023';
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
      raise exception 'No catalog price is available for this material in the selected ZIP code. Add a custom cost instead.' using errcode = '22023';
    end if;
    v_unit_price_cents := v_price.unit_price_cents;
  end if;

  -- quantity_with_waste = base_quantity x (1 + waste_bps/10000); coats
  -- multiplies the base quantity (e.g. 2 coats of paint); coverage_rate
  -- is "how much the measured value one unit of material covers" (e.g.
  -- 350 sq ft per gallon, or 1 sq ft of tile per 1 sq ft of floor).
  -- Whole-unit materials (you can't buy 0.4 gallons) round up; continuous
  -- materials (sq ft/linear ft of tile, flooring) round to 2 decimals.
  -- See docs/46-measurement-calculation-engine.md, "Rounding."
  v_raw_quantity := v_measurement_value * p_coats * (1 + p_waste_bps / 10000.0) / p_coverage_rate;
  if v_material.default_unit in ('gallon', 'each', 'day', 'hour') then
    v_calculated_quantity := ceil(v_raw_quantity);
  else
    v_calculated_quantity := round(v_raw_quantity, 2);
  end if;

  if v_calculated_quantity <= 0 then
    raise exception 'Calculated quantity must be greater than zero' using errcode = '22023';
  end if;

  v_line_total := round(v_calculated_quantity * v_unit_price_cents);

  insert into public.proposal_line_items (
    tenant_id, proposal_version_id, section_id, category, description, quantity, unit,
    unit_price_cents, line_total_cents, taxable, sort_order,
    material_catalog_item_id, material_zip_price_id, source_type, source_zip_code,
    source_supplier_name, source_price_effective_date
  )
  values (
    v_version.tenant_id, p_proposal_version_id, p_section_id, 'material', v_material.name, v_calculated_quantity, v_material.default_unit,
    v_unit_price_cents, v_line_total, p_taxable, p_sort_order,
    v_material.id, v_price.id, 'catalog', v_zip,
    coalesce(v_price.supplier_name, v_material.supplier_name),
    v_price.effective_date
  )
  returning * into v_line_item;

  insert into public.proposal_measurement_materials (
    tenant_id, proposal_version_id, proposal_measurement_id, material_catalog_item_id, material_zip_price_id,
    proposal_line_item_id, measurement_value_field, coverage_rate, coverage_unit, coats, waste_bps,
    calculated_quantity, unit, unit_price_cents_snapshot, total_cents_snapshot
  )
  values (
    v_version.tenant_id, p_proposal_version_id, p_proposal_measurement_id, v_material.id, v_price.id,
    v_line_item.id, p_measurement_value_field, p_coverage_rate, p_coverage_unit, p_coats, p_waste_bps,
    v_calculated_quantity, v_material.default_unit, v_unit_price_cents, v_line_total
  );

  perform public.recalculate_proposal_version(p_proposal_version_id);

  perform public.log_audit_event(v_version.tenant_id, v_user_id, 'proposal.material_generated_from_measurement', 'proposal_line_item', v_line_item.id,
    jsonb_build_object('proposal_measurement_id', p_proposal_measurement_id, 'calculated_quantity', v_calculated_quantity, 'line_total_cents', v_line_total));

  return v_line_item;
end;
$$;

comment on function public.generate_material_from_measurement(uuid, uuid, uuid, text, numeric, text, int, int, text, bigint, boolean, uuid, int) is
  'quantity = measured_value * coats * (1 + waste_bps/10000) / coverage_rate, rounded up for discrete units (gallon/each/day/hour) or to 2 decimals for continuous units. Never invents a price -- see find_material_zip_price(). Snapshots price/quantity into proposal_line_items exactly like add_proposal_line_item_from_catalog(). See docs/46-measurement-calculation-engine.md.';

-- =============================================================================
-- Grants
-- =============================================================================

revoke execute on function public.create_measurement_group(uuid, text, text, text) from public;
grant execute on function public.create_measurement_group(uuid, text, text, text) to authenticated;

revoke execute on function public.add_measurement(uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric, int, text, int) from public;
grant execute on function public.add_measurement(uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric, int, text, int) to authenticated;

revoke execute on function public.update_measurement(uuid, text, text, numeric, numeric, numeric, numeric, numeric, int, text) from public;
grant execute on function public.update_measurement(uuid, text, text, numeric, numeric, numeric, numeric, numeric, int, text) to authenticated;

revoke execute on function public.archive_measurement(uuid) from public;
grant execute on function public.archive_measurement(uuid) to authenticated;

revoke execute on function public.save_measurement_shape(uuid, uuid, text, text, text, numeric, numeric, numeric, text, jsonb, int, text, int) from public;
grant execute on function public.save_measurement_shape(uuid, uuid, text, text, text, numeric, numeric, numeric, text, jsonb, int, text, int) to authenticated;

revoke execute on function public.generate_material_from_measurement(uuid, uuid, uuid, text, numeric, text, int, int, text, bigint, boolean, uuid, int) from public;
grant execute on function public.generate_material_from_measurement(uuid, uuid, uuid, text, numeric, text, int, int, text, bigint, boolean, uuid, int) to authenticated;
