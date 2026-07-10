-- Phase 2C: two more proposal_labor_items pricing methods -- 'area' and
-- 'linear' -- generated exclusively from a measurement (see
-- add_proposal_labor_item_from_measurement() below). Same discipline as
-- the hourly/fixed split added in 20260707160000_labor_fixed_pricing.sql:
-- new columns are nullable, a composite CHECK enforces each
-- pricing_method has exactly its own fields populated and no others,
-- every existing 'hourly'/'fixed' row is completely unaffected.
--
-- Deliberately a SEPARATE function (add_proposal_labor_item_from_measurement)
-- rather than growing add_proposal_labor_item()'s already-large signature
-- further -- 'area'/'linear' labor is always tied to a measurement (per
-- the Measurements step's "Generate labor from measurement" flow, never
-- a bare manual entry), so it doesn't belong in the generic
-- hourly/fixed entry point. The existing add_proposal_labor_item()/
-- update_proposal_labor_item() are untouched by this migration --
-- zero regression risk to hourly/fixed labor.

alter table public.proposal_labor_items
  add column measured_area numeric(14,4) check (measured_area is null or measured_area > 0),
  add column measured_linear_length numeric(12,4) check (measured_linear_length is null or measured_linear_length > 0),
  add column labor_rate_per_area_cents bigint check (labor_rate_per_area_cents is null or (labor_rate_per_area_cents >= 0 and labor_rate_per_area_cents <= 100000000)),
  add column labor_rate_per_linear_cents bigint check (labor_rate_per_linear_cents is null or (labor_rate_per_linear_cents >= 0 and labor_rate_per_linear_cents <= 100000000)),
  add column proposal_measurement_id uuid;

alter table public.proposal_labor_items
  add constraint proposal_labor_items_measurement_fk
  foreign key (proposal_measurement_id, tenant_id) references public.proposal_measurements (id, tenant_id);

-- Drop and recreate the pricing_method check + fields check to add the
-- two new branches, matching the existing hourly/fixed branches exactly
-- in style.
alter table public.proposal_labor_items drop constraint proposal_labor_items_pricing_method_check;
alter table public.proposal_labor_items add constraint proposal_labor_items_pricing_method_check
  check (pricing_method in ('hourly', 'fixed', 'area', 'linear'));

alter table public.proposal_labor_items drop constraint proposal_labor_items_pricing_fields_check;
alter table public.proposal_labor_items add constraint proposal_labor_items_pricing_fields_check
  check (
    (pricing_method = 'hourly'
      and worker_count is not null and estimated_days is not null
      and hours_per_day is not null and hourly_rate_cents is not null
      and fixed_total_cents is null and measured_area is null and measured_linear_length is null
      and labor_rate_per_area_cents is null and labor_rate_per_linear_cents is null)
    or
    (pricing_method = 'fixed'
      and fixed_total_cents is not null
      and worker_count is null and estimated_days is null
      and hours_per_day is null and hourly_rate_cents is null
      and measured_area is null and measured_linear_length is null
      and labor_rate_per_area_cents is null and labor_rate_per_linear_cents is null)
    or
    (pricing_method = 'area'
      and measured_area is not null and labor_rate_per_area_cents is not null
      and worker_count is null and estimated_days is null and hours_per_day is null and hourly_rate_cents is null
      and fixed_total_cents is null and measured_linear_length is null and labor_rate_per_linear_cents is null)
    or
    (pricing_method = 'linear'
      and measured_linear_length is not null and labor_rate_per_linear_cents is not null
      and worker_count is null and estimated_days is null and hours_per_day is null and hourly_rate_cents is null
      and fixed_total_cents is null and measured_area is null and labor_rate_per_area_cents is null)
  );

comment on column public.proposal_labor_items.measured_area is
  'A snapshot of the generating measurement''s area at the moment this labor item was created -- like proposal_line_items'' price snapshot, a later edit to the measurement never retroactively changes this labor item''s total.';
comment on column public.proposal_labor_items.proposal_measurement_id is
  'Provenance only (which measurement generated this labor item) -- total_cents is computed from measured_area/measured_linear_length above at generation time, never re-read from the measurement afterward.';

-- =============================================================================
-- add_proposal_labor_item_from_measurement — 'area'/'linear' labor,
-- generated from one of a measurement's own computed fields. Gated by
-- measurements.generate_materials (not proposals.manage_pricing
-- directly) -- see the permission comment inside the function body --
-- and the same draft-only gate as every other labor mutation.
-- =============================================================================
create or replace function public.add_proposal_labor_item_from_measurement(
  p_proposal_version_id uuid,
  p_proposal_measurement_id uuid,
  p_label text,
  p_pricing_method text,
  p_rate_cents bigint,
  p_sort_order int default 0
)
returns public.proposal_labor_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_version public.proposal_versions;
  v_measurement public.proposal_measurements;
  v_item public.proposal_labor_items;
  v_total_cents bigint;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_version from public.proposal_versions where id = p_proposal_version_id;
  if not found then
    raise exception 'Proposal version not found' using errcode = 'P0002';
  end if;

  -- measurements.generate_materials, not proposals.manage_pricing directly:
  -- Sales/Field Worker never hold it in the seed matrix (both lack
  -- proposals.manage_pricing, and the brief conditions "generate
  -- materials/labor" on holding pricing permission), so this one check
  -- achieves the same effect as double-gating without needing to also
  -- inline a proposals.manage_pricing check here. See
  -- docs/48-measurement-rls-verification.md.
  if not public.user_has_permission(v_version.tenant_id, 'measurements.generate_materials') then
    raise exception 'Missing permission: measurements.generate_materials' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  if p_label is null or btrim(p_label) = '' then
    raise exception 'Label is required' using errcode = '22023';
  end if;

  if p_pricing_method not in ('area', 'linear') then
    raise exception 'Invalid pricing method' using errcode = '22023';
  end if;

  if p_rate_cents is null or p_rate_cents < 0 or p_rate_cents > 100000000 then
    raise exception 'Labor rate must be zero or greater' using errcode = '22023';
  end if;

  select * into v_measurement
    from public.proposal_measurements
   where id = p_proposal_measurement_id and proposal_version_id = p_proposal_version_id;
  if not found then
    raise exception 'Measurement not found on this proposal' using errcode = 'P0002';
  end if;

  if p_pricing_method = 'area' then
    if v_measurement.area is null then
      raise exception 'This measurement has no area to price labor by' using errcode = '22023';
    end if;
    v_total_cents := round(v_measurement.area * p_rate_cents);

    insert into public.proposal_labor_items (
      tenant_id, proposal_version_id, label, pricing_method,
      measured_area, labor_rate_per_area_cents, proposal_measurement_id,
      total_hours, total_cents, sort_order
    )
    values (
      v_version.tenant_id, p_proposal_version_id, btrim(p_label), 'area',
      v_measurement.area, p_rate_cents, p_proposal_measurement_id,
      0, v_total_cents, p_sort_order
    )
    returning * into v_item;
  else
    if coalesce(v_measurement.linear_length, v_measurement.perimeter) is null then
      raise exception 'This measurement has no linear length or perimeter to price labor by' using errcode = '22023';
    end if;
    v_total_cents := round(coalesce(v_measurement.linear_length, v_measurement.perimeter) * p_rate_cents);

    insert into public.proposal_labor_items (
      tenant_id, proposal_version_id, label, pricing_method,
      measured_linear_length, labor_rate_per_linear_cents, proposal_measurement_id,
      total_hours, total_cents, sort_order
    )
    values (
      v_version.tenant_id, p_proposal_version_id, btrim(p_label), 'linear',
      coalesce(v_measurement.linear_length, v_measurement.perimeter), p_rate_cents, p_proposal_measurement_id,
      0, v_total_cents, p_sort_order
    )
    returning * into v_item;
  end if;

  perform public.recalculate_proposal_version(p_proposal_version_id);

  perform public.log_audit_event(v_version.tenant_id, v_user_id, 'proposal.labor_created_from_measurement', 'proposal_labor_item', v_item.id,
    jsonb_build_object('proposal_version_id', p_proposal_version_id, 'proposal_measurement_id', p_proposal_measurement_id, 'pricing_method', p_pricing_method, 'total_cents', v_total_cents));

  return v_item;
end;
$$;

comment on function public.add_proposal_labor_item_from_measurement(uuid, uuid, text, text, bigint, int) is
  'area: total_cents = round(measurement.area * rate_cents). linear: total_cents = round(coalesce(measurement.linear_length, measurement.perimeter) * rate_cents). Both snapshot the measurement''s value at creation time -- see docs/46-measurement-calculation-engine.md.';

revoke execute on function public.add_proposal_labor_item_from_measurement(uuid, uuid, text, text, bigint, int) from public;
grant execute on function public.add_proposal_labor_item_from_measurement(uuid, uuid, text, text, bigint, int) to authenticated;
