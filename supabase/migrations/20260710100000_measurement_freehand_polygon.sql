-- Phase 2C.1: Freehand / brush drawing for the Measurements step's Draw
-- layout tab, alongside (not replacing) the existing rectangle mode.
-- See docs/47-drawing-sketch-mode.md, "Freehand mode".
--
-- No table migration needed: `sketch_polygon` was already reserved as a
-- shape_type enum value in 20260709140000_measurements_schema.sql
-- (Phase 2C), proposal_measurements.length/width are already nullable
-- (a polygon has no natural single length/width pair), and
-- proposal_measurement_shapes.shape_data is already flexible JSONB with
-- no rectangle-specific shape. Freehand is represented internally as a
-- polygon (`sketch_polygon`) -- a simplified/decimated point list, not a
-- literal pixel-for-pixel trace; see the client-side simplification in
-- draw-layout-canvas.tsx.
--
-- Same "client converts raw drawn dimensions to real units using the
-- scale, server computes the derived value" discipline as the existing
-- save_measurement_shape() (rectangle): the client sends REAL-WORLD
-- (already scaled from pixels) points, and this function independently
-- computes area/perimeter/linear_length server-side via the shoelace
-- formula and edge-length summation -- it never trusts a
-- client-computed area or perimeter number.

create or replace function public.save_measurement_polygon_shape(
  p_proposal_version_id uuid,
  p_measurement_group_id uuid,
  p_name text,
  p_measurement_type text,
  p_unit text,
  p_points jsonb,
  p_closed boolean,
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
  v_linear numeric(12,4);
  v_measurement public.proposal_measurements;
  v_point_count int;
  v_cross_sum numeric := 0;
  v_perim_sum numeric := 0;
  v_i int;
  v_j int;
  v_x1 numeric;
  v_y1 numeric;
  v_x2 numeric;
  v_y2 numeric;
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
  if p_scale_reference_length is null or p_scale_reference_length <= 0 then
    raise exception 'A real-world reference length is required to scale the drawing' using errcode = '22023';
  end if;
  if p_waste_bps is null or p_waste_bps < 0 or p_waste_bps > 10000 then
    raise exception 'Waste percentage must be between 0%% and 100%%' using errcode = '22023';
  end if;

  if jsonb_typeof(p_points) <> 'array' then
    raise exception 'Points must be an array' using errcode = '22023';
  end if;
  v_point_count := jsonb_array_length(p_points);
  -- Bounded generously above (real drawings simplify to well under this --
  -- see the client-side Douglas-Peucker pass in draw-layout-canvas.tsx)
  -- purely as a defensive cap, not a realistic limitation.
  if v_point_count > 500 then
    raise exception 'Too many points in the drawn shape' using errcode = '22023';
  end if;
  if p_closed and v_point_count < 3 then
    raise exception 'A closed shape needs at least 3 points' using errcode = '22023';
  end if;
  if not p_closed and v_point_count < 2 then
    raise exception 'A linear path needs at least 2 points' using errcode = '22023';
  end if;

  -- Shoelace formula for area, plain edge-length summation for
  -- perimeter/linear length. A closed shape wraps its last edge back to
  -- point 0 (both area and perimeter include that closing edge); an open
  -- path sums only the n-1 consecutive segments and has no area.
  for v_i in 0 .. v_point_count - 1 loop
    v_x1 := (p_points -> v_i ->> 'x')::numeric;
    v_y1 := (p_points -> v_i ->> 'y')::numeric;
    if v_x1 is null or v_y1 is null then
      raise exception 'Invalid point in drawn shape' using errcode = '22023';
    end if;

    v_j := v_i + 1;
    if v_j = v_point_count then
      if not p_closed then
        exit; -- open path: no wrap-around edge
      end if;
      v_j := 0;
    end if;

    v_x2 := (p_points -> v_j ->> 'x')::numeric;
    v_y2 := (p_points -> v_j ->> 'y')::numeric;

    v_cross_sum := v_cross_sum + (v_x1 * v_y2 - v_x2 * v_y1);
    v_perim_sum := v_perim_sum + sqrt(power(v_x2 - v_x1, 2) + power(v_y2 - v_y1, 2));
  end loop;

  if p_closed then
    v_area := round(abs(v_cross_sum) / 2, 2);
    v_perimeter := round(v_perim_sum, 2);
    v_linear := null;
    if v_area <= 0 then
      raise exception 'The drawn shape has no area -- points may be collinear or too close together' using errcode = '22023';
    end if;
  else
    v_area := null;
    v_perimeter := null;
    v_linear := round(v_perim_sum, 2);
    if v_linear <= 0 then
      raise exception 'The drawn path has no length -- points may be too close together' using errcode = '22023';
    end if;
  end if;

  insert into public.proposal_measurements (
    tenant_id, proposal_version_id, measurement_group_id, name, measurement_type, shape_type,
    length, width, area, perimeter, linear_length, unit, waste_bps, notes, sort_order
  )
  values (
    v_version.tenant_id, p_proposal_version_id, p_measurement_group_id, btrim(p_name), p_measurement_type, 'sketch_polygon',
    null, null, v_area, v_perimeter, v_linear, p_unit, p_waste_bps, p_notes, p_sort_order
  )
  returning * into v_measurement;

  insert into public.proposal_measurement_shapes (
    tenant_id, proposal_version_id, proposal_measurement_id, shape_data, scale_reference_length, scale_unit
  )
  values (
    v_version.tenant_id, p_proposal_version_id, v_measurement.id, p_shape_data, p_scale_reference_length, p_scale_unit
  );

  perform public.log_audit_event(v_version.tenant_id, v_user_id, 'proposal.measurement_created', 'proposal_measurement', v_measurement.id,
    jsonb_build_object('proposal_version_id', p_proposal_version_id, 'shape_type', 'sketch_polygon', 'closed', p_closed));

  return v_measurement;
end;
$$;

comment on function public.save_measurement_polygon_shape(uuid, uuid, text, text, text, jsonb, boolean, numeric, text, jsonb, int, text, int) is
  'Freehand/brush drawing, stored as a polygon (closed -> area via the shoelace formula + full perimeter) or an open path (linear_length only, no area). Points must already be in real-world units (the client scales pixels using the reference length) -- this function never trusts a client-computed area/perimeter/length, only the raw point coordinates. See docs/46-measurement-calculation-engine.md, "Freehand polygon geometry".';

revoke execute on function public.save_measurement_polygon_shape(uuid, uuid, text, text, text, jsonb, boolean, numeric, text, jsonb, int, text, int) from public;
grant execute on function public.save_measurement_polygon_shape(uuid, uuid, text, text, text, jsonb, boolean, numeric, text, jsonb, int, text, int) to authenticated;
