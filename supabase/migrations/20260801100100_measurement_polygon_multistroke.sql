-- Freehand/brush drawing — multi-stroke fix. Root cause of the reported
-- bug ("the drawing feels like one continuous line"): the previous
-- save_measurement_polygon_shape() accepted a single FLAT point array
-- (`p_points`), already merged client-side across every stroke the user
-- drew. For an OPEN (linear) path, this silently summed a phantom edge
-- connecting the LAST point of one stroke to the FIRST point of the
-- next — the gap where the user actually lifted the pen/finger — into
-- linear_length, exactly the "auto-connects strokes" bug reported. The
-- same flattening also drove the live SVG rendering (a single
-- <polyline>/<polygon> over every point), which is why it visually
-- looked like one continuous trace even before this function was ever
-- called.
--
-- Fix: this function now accepts `p_strokes` — a JSONB ARRAY OF POINT
-- ARRAYS (one array per stroke), not a flat point list. Geometry is
-- computed accordingly:
--   - CLOSED (area): strokes are joined end-to-end IN DRAWN ORDER into
--     one outline (the documented, deliberately simple "close shape"
--     strategy — no automatic path-matching/reordering; see
--     docs/74-custom-service-name-and-multistroke-drawing.md), then the
--     exact same shoelace-area / wraparound-perimeter formula as before
--     runs over that flattened outline. Numerically identical to the
--     previous behavior for a single-stroke closed shape.
--   - OPEN (linear): each stroke's own consecutive-edge length is
--     summed INDEPENDENTLY (never a phantom edge across the gap between
--     strokes), then those per-stroke sums are added together. This is
--     the actual bug fix — a fencing run traced in two lifted strokes
--     now correctly totals "stroke 1's length + stroke 2's length," not
--     "+ a fake teleport segment across the gap."
--
-- Same parameter COUNT and TYPE as the function it replaces (13 params,
-- `p_points jsonb` renamed to `p_strokes jsonb` at the same position) —
-- per this project's own hard-learned lesson
-- (20260730100300_fix_client_functions_duplicate_overload.sql), a
-- signature with the same number/types of arguments is a true CREATE OR
-- REPLACE, not a new overload — but this migration drops the old
-- signature first anyway, purely as zero-cost insurance against that
-- exact failure mode, and re-grants explicitly.

drop function if exists public.save_measurement_polygon_shape(uuid, uuid, text, text, text, jsonb, boolean, numeric, text, jsonb, int, text, int);

create or replace function public.save_measurement_polygon_shape(
  p_proposal_version_id uuid,
  p_measurement_group_id uuid,
  p_name text,
  p_measurement_type text,
  p_unit text,
  p_strokes jsonb,
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
  v_stroke_count int;
  v_stroke jsonb;
  v_stroke_len int;
  v_total_points int := 0;
  v_xs numeric[] := '{}';
  v_ys numeric[] := '{}';
  v_open_linear_sum numeric := 0;
  v_prev_x numeric;
  v_prev_y numeric;
  v_point_count int;
  v_cross_sum numeric := 0;
  v_perim_sum numeric := 0;
  v_i int;
  v_j int;
  v_s int;
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
    raise exception 'Measurement name is required' using errcode = '22023';
  end if;
  if p_unit not in ('ft', 'm') or p_scale_unit not in ('ft', 'm') then
    raise exception 'Invalid unit' using errcode = '22023';
  end if;
  if p_scale_reference_length is null or p_scale_reference_length <= 0 then
    raise exception 'Enter a reference length greater than 0' using errcode = '22023';
  end if;
  if p_waste_bps is null or p_waste_bps < 0 or p_waste_bps > 10000 then
    raise exception 'Waste percentage must be between 0%% and 100%%' using errcode = '22023';
  end if;

  if jsonb_typeof(p_strokes) <> 'array' or jsonb_array_length(p_strokes) = 0 then
    raise exception 'Draw the area before saving' using errcode = '22023';
  end if;
  v_stroke_count := jsonb_array_length(p_strokes);

  -- Single pass: validate structure, flatten every stroke's points (in
  -- drawn order) into v_xs/v_ys for the CLOSED case, and independently
  -- accumulate each stroke's own consecutive-edge length into
  -- v_open_linear_sum for the OPEN case — see migration header.
  for v_s in 0 .. v_stroke_count - 1 loop
    v_stroke := p_strokes -> v_s;
    if jsonb_typeof(v_stroke) <> 'array' then
      raise exception 'Invalid drawing data' using errcode = '22023';
    end if;
    v_stroke_len := jsonb_array_length(v_stroke);
    v_total_points := v_total_points + v_stroke_len;
    v_prev_x := null;
    v_prev_y := null;
    for v_i in 0 .. v_stroke_len - 1 loop
      v_x1 := (v_stroke -> v_i ->> 'x')::numeric;
      v_y1 := (v_stroke -> v_i ->> 'y')::numeric;
      if v_x1 is null or v_y1 is null then
        raise exception 'Invalid point in drawn shape' using errcode = '22023';
      end if;
      v_xs := array_append(v_xs, v_x1);
      v_ys := array_append(v_ys, v_y1);
      if v_prev_x is not null then
        v_open_linear_sum := v_open_linear_sum + sqrt(power(v_x1 - v_prev_x, 2) + power(v_y1 - v_prev_y, 2));
      end if;
      v_prev_x := v_x1;
      v_prev_y := v_y1;
    end loop;
  end loop;

  -- Bounded generously above (real drawings simplify to well under this
  -- via client-side Douglas-Peucker) purely as a defensive cap.
  if v_total_points > 500 then
    raise exception 'Too many points in the drawn shape' using errcode = '22023';
  end if;
  if p_closed and v_total_points < 3 then
    raise exception 'Close the shape before saving an area measurement' using errcode = '22023';
  end if;
  if not p_closed and v_total_points < 2 then
    raise exception 'Draw the area before saving' using errcode = '22023';
  end if;

  if p_closed then
    -- Shoelace formula for area, edge-length summation (including the
    -- closing edge back to point 0) for perimeter, over every stroke's
    -- points flattened end-to-end in drawn order. See docs/46,
    -- "Freehand polygon geometry."
    v_point_count := array_length(v_xs, 1);
    for v_i in 1 .. v_point_count loop
      v_x1 := v_xs[v_i];
      v_y1 := v_ys[v_i];
      v_j := v_i + 1;
      if v_j > v_point_count then
        v_j := 1;
      end if;
      v_x2 := v_xs[v_j];
      v_y2 := v_ys[v_j];
      v_cross_sum := v_cross_sum + (v_x1 * v_y2 - v_x2 * v_y1);
      v_perim_sum := v_perim_sum + sqrt(power(v_x2 - v_x1, 2) + power(v_y2 - v_y1, 2));
    end loop;

    v_area := round(abs(v_cross_sum) / 2, 2);
    v_perimeter := round(v_perim_sum, 2);
    v_linear := null;
    if v_area <= 0 then
      raise exception 'Close the shape before saving an area measurement' using errcode = '22023';
    end if;
  else
    v_area := null;
    v_perimeter := null;
    v_linear := round(v_open_linear_sum, 2);
    if v_linear <= 0 then
      raise exception 'Draw the area before saving' using errcode = '22023';
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
    jsonb_build_object('proposal_version_id', p_proposal_version_id, 'shape_type', 'sketch_polygon', 'closed', p_closed, 'stroke_count', v_stroke_count));

  return v_measurement;
end;
$$;

comment on function public.save_measurement_polygon_shape(uuid, uuid, text, text, text, jsonb, boolean, numeric, text, jsonb, int, text, int) is
  'Freehand/brush drawing, one or more independent strokes (p_strokes: array of point arrays). CLOSED -> strokes joined end-to-end in drawn order into one outline, shoelace area + full perimeter. OPEN -> each stroke''s own edge length summed independently, never a phantom edge across the gap between strokes. Points must already be in real-world units -- this function never trusts a client-computed area/perimeter/length. See docs/46-measurement-calculation-engine.md and docs/74-custom-service-name-and-multistroke-drawing.md.';

revoke execute on function public.save_measurement_polygon_shape(uuid, uuid, text, text, text, jsonb, boolean, numeric, text, jsonb, int, text, int) from public;
grant execute on function public.save_measurement_polygon_shape(uuid, uuid, text, text, text, jsonb, boolean, numeric, text, jsonb, int, text, int) to authenticated;
