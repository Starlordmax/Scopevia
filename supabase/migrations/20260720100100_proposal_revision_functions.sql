-- Phase 3B.1: Proposal Revision / New Version Flow — create_proposal_revision().
--
-- The contractor-facing counterpart to Phase 3B's accept/decline: once a
-- client has responded, the current proposal_version is locked (immutable —
-- see 20260706140300_proposal_versions.sql) and the response itself is
-- permanently tied to that exact version_id (proposal_client_responses,
-- unique(proposal_version_id) — Phase 3B). Nothing about that changes here.
-- What this function adds is the ONLY way forward from a declined (or,
-- with UI confirmation, accepted) proposal: a brand-new draft version,
-- seeded from the locked one's content, that the contractor can freely
-- edit — while the locked version and its response stay exactly as they
-- were, forever.
--
-- Deliberately its own function rather than reusing/extending
-- create_new_proposal_version() (20260706141100_proposal_functions_core.sql,
-- Phase 2A's dormant "architecture prep for sending," never exposed in any
-- UI): that function's copy logic predates Phase 2B's material-catalog
-- snapshot columns and Phase 2C's entire measurements schema, and would
-- silently drop or corrupt that data (e.g. defaulting every copied labor
-- item to pricing_method='hourly' regardless of its real method) if reused
-- unmodified. It is left untouched here — still unused by any caller, so
-- changing its behavior carries real regression risk for no benefit — and
-- create_proposal_revision() below has its own complete, current copy
-- logic instead. See docs/58-proposal-revision-flow.md.
create or replace function public.create_proposal_revision(p_proposal_id uuid)
returns public.proposal_versions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_proposal public.proposals;
  v_old_version public.proposal_versions;
  v_new_version public.proposal_versions;
  v_next_number int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_proposal from public.proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_proposal.tenant_id, 'proposals.create_revision') then
    raise exception 'Missing permission: proposals.create_revision' using errcode = '42501';
  end if;

  if v_proposal.archived_at is not null then
    raise exception 'Cannot create a revision of an archived proposal' using errcode = '55000';
  end if;

  -- A revision only ever starts from a proposal the client has actually
  -- responded to. This also naturally prevents creating a second revision
  -- before the first one's new version is itself responded to (or reverted)
  -- — the instant a revision is created, proposals.status moves to 'draft',
  -- which fails this same check.
  if v_proposal.status not in ('accepted', 'declined') then
    raise exception 'A revision can only be created from an accepted or declined proposal' using errcode = '55000';
  end if;

  select * into v_old_version from public.proposal_versions where id = v_proposal.current_version_id for update;
  -- Defensive: status in ('accepted','declined') is only ever reached via
  -- submit_proposal_client_response(), which always locks this exact
  -- version first — this should be unreachable in practice.
  if not found or v_old_version.version_status <> 'locked' then
    raise exception 'The current version must be locked (already responded to) before a revision can be created' using errcode = '55000';
  end if;

  v_next_number := v_old_version.version_number + 1;

  insert into public.proposal_versions (
    tenant_id, proposal_id, version_number, version_status, summary, scope_intro,
    estimated_start_date, estimated_duration_days, default_hours_per_day, terms, exclusions,
    notes_for_client, discount_type, discount_value, tax_rate_bps,
    pricing_zip_code, pricing_state_code, pricing_city, created_by
  )
  values (
    v_old_version.tenant_id, p_proposal_id, v_next_number, 'draft', v_old_version.summary, v_old_version.scope_intro,
    v_old_version.estimated_start_date, v_old_version.estimated_duration_days, v_old_version.default_hours_per_day,
    v_old_version.terms, v_old_version.exclusions, v_old_version.notes_for_client, v_old_version.discount_type,
    v_old_version.discount_value, v_old_version.tax_rate_bps,
    v_old_version.pricing_zip_code, v_old_version.pricing_state_code, v_old_version.pricing_city, v_user_id
  )
  returning * into v_new_version;

  -- =============================================================================
  -- Copy content, in dependency order. Every child table gets a fresh id —
  -- temp mapping tables (dropped automatically at transaction end) let
  -- later copies remap the foreign keys that point at rows copied earlier
  -- (section_id, measurement_group_id, proposal_measurement_id,
  -- proposal_line_item_id) without ever reusing an old id. Everything not
  -- copied (proposal_client_responses, proposal_view_events, portal
  -- sessions/OTPs/links, audit_logs, crm_activities) is deliberately left
  -- attached to the OLD version only — see docs/58.
  -- =============================================================================

  create temporary table tmp_revision_section_map (old_id uuid primary key, new_id uuid not null) on commit drop;
  insert into tmp_revision_section_map (old_id, new_id)
  select id, gen_random_uuid() from public.proposal_sections
   where proposal_version_id = v_old_version.id and archived_at is null;

  insert into public.proposal_sections (id, tenant_id, proposal_version_id, title, description, section_type, sort_order)
  select m.new_id, s.tenant_id, v_new_version.id, s.title, s.description, s.section_type, s.sort_order
    from public.proposal_sections s
    join tmp_revision_section_map m on m.old_id = s.id;

  create temporary table tmp_revision_measurement_group_map (old_id uuid primary key, new_id uuid not null) on commit drop;
  insert into tmp_revision_measurement_group_map (old_id, new_id)
  select id, gen_random_uuid() from public.proposal_measurement_groups
   where proposal_version_id = v_old_version.id and archived_at is null;

  insert into public.proposal_measurement_groups (id, tenant_id, proposal_version_id, name, service_type, unit_system, created_by)
  select m.new_id, g.tenant_id, v_new_version.id, g.name, g.service_type, g.unit_system, g.created_by
    from public.proposal_measurement_groups g
    join tmp_revision_measurement_group_map m on m.old_id = g.id;

  create temporary table tmp_revision_measurement_map (old_id uuid primary key, new_id uuid not null) on commit drop;
  insert into tmp_revision_measurement_map (old_id, new_id)
  select id, gen_random_uuid() from public.proposal_measurements
   where proposal_version_id = v_old_version.id and archived_at is null;

  insert into public.proposal_measurements (
    id, tenant_id, proposal_version_id, measurement_group_id, name, measurement_type, shape_type,
    length, width, height, area, perimeter, volume, linear_length, unit, waste_bps, notes, sort_order
  )
  select
    mm.new_id, meas.tenant_id, v_new_version.id, gm.new_id, meas.name, meas.measurement_type, meas.shape_type,
    meas.length, meas.width, meas.height, meas.area, meas.perimeter, meas.volume, meas.linear_length,
    meas.unit, meas.waste_bps, meas.notes, meas.sort_order
    from public.proposal_measurements meas
    join tmp_revision_measurement_map mm on mm.old_id = meas.id
    join tmp_revision_measurement_group_map gm on gm.old_id = meas.measurement_group_id;

  create temporary table tmp_revision_line_item_map (old_id uuid primary key, new_id uuid not null) on commit drop;
  insert into tmp_revision_line_item_map (old_id, new_id)
  select id, gen_random_uuid() from public.proposal_line_items
   where proposal_version_id = v_old_version.id and archived_at is null;

  insert into public.proposal_line_items (
    id, tenant_id, proposal_version_id, section_id, category, description, quantity, unit, unit_price_cents,
    line_total_cents, taxable, sort_order, material_catalog_item_id, material_zip_price_id, source_type,
    source_zip_code, source_supplier_name, source_price_effective_date
  )
  select
    lim.new_id, li.tenant_id, v_new_version.id, sm.new_id, li.category, li.description, li.quantity, li.unit,
    li.unit_price_cents, li.line_total_cents, li.taxable, li.sort_order, li.material_catalog_item_id,
    li.material_zip_price_id, li.source_type, li.source_zip_code, li.source_supplier_name, li.source_price_effective_date
    from public.proposal_line_items li
    join tmp_revision_line_item_map lim on lim.old_id = li.id
    left join tmp_revision_section_map sm on sm.old_id = li.section_id
   where li.proposal_version_id = v_old_version.id and li.archived_at is null;

  insert into public.proposal_labor_items (
    tenant_id, proposal_version_id, label, worker_count, estimated_days, hours_per_day, hourly_rate_cents,
    total_hours, total_cents, sort_order, pricing_method, fixed_total_cents,
    measured_area, measured_linear_length, labor_rate_per_area_cents, labor_rate_per_linear_cents,
    proposal_measurement_id
  )
  select
    lab.tenant_id, v_new_version.id, lab.label, lab.worker_count, lab.estimated_days, lab.hours_per_day, lab.hourly_rate_cents,
    lab.total_hours, lab.total_cents, lab.sort_order, lab.pricing_method, lab.fixed_total_cents,
    lab.measured_area, lab.measured_linear_length, lab.labor_rate_per_area_cents, lab.labor_rate_per_linear_cents,
    measm.new_id
    from public.proposal_labor_items lab
    left join tmp_revision_measurement_map measm on measm.old_id = lab.proposal_measurement_id
   where lab.proposal_version_id = v_old_version.id and lab.archived_at is null;

  insert into public.proposal_measurement_shapes (tenant_id, proposal_version_id, proposal_measurement_id, shape_data, scale_reference_length, scale_unit)
  select sh.tenant_id, v_new_version.id, mm.new_id, sh.shape_data, sh.scale_reference_length, sh.scale_unit
    from public.proposal_measurement_shapes sh
    join tmp_revision_measurement_map mm on mm.old_id = sh.proposal_measurement_id
   where sh.proposal_version_id = v_old_version.id;

  insert into public.proposal_measurement_materials (
    tenant_id, proposal_version_id, proposal_measurement_id, material_catalog_item_id, material_zip_price_id,
    proposal_line_item_id, measurement_value_field, coverage_rate, coverage_unit, coats, waste_bps,
    calculated_quantity, unit, unit_price_cents_snapshot, total_cents_snapshot
  )
  select
    mmat.tenant_id, v_new_version.id, mm.new_id, mmat.material_catalog_item_id, mmat.material_zip_price_id,
    lim.new_id, mmat.measurement_value_field, mmat.coverage_rate, mmat.coverage_unit, mmat.coats, mmat.waste_bps,
    mmat.calculated_quantity, mmat.unit, mmat.unit_price_cents_snapshot, mmat.total_cents_snapshot
    from public.proposal_measurement_materials mmat
    join tmp_revision_measurement_map mm on mm.old_id = mmat.proposal_measurement_id
    left join tmp_revision_line_item_map lim on lim.old_id = mmat.proposal_line_item_id
   where mmat.proposal_version_id = v_old_version.id;

  insert into public.proposal_media (tenant_id, proposal_version_id, media_asset_id, portfolio_project_id, usage_type, caption, sort_order)
  select tenant_id, v_new_version.id, media_asset_id, portfolio_project_id, usage_type, caption, sort_order
    from public.proposal_media
   where proposal_version_id = v_old_version.id and archived_at is null;

  -- The old version is now historical, not just "locked awaiting a
  -- decision" — see 20260720100000_proposal_revision_schema.sql for why
  -- both immutability triggers now treat 'superseded' identically to
  -- 'locked'. Its response (if any) stays exactly where it is —
  -- proposal_client_responses.proposal_version_id still points at
  -- v_old_version.id, untouched.
  update public.proposal_versions set version_status = 'superseded' where id = v_old_version.id;

  -- Deliberately plain 'draft', not a new status literal — see
  -- docs/58-proposal-revision-flow.md, "Why draft and not a new status."
  -- The UI is responsible for showing "Revision in progress" copy whenever
  -- version_number > 1, rather than the database inventing a status the
  -- rest of the app (mark_proposal_ready, portal link creation, etc.) would
  -- otherwise need to learn about too.
  update public.proposals set current_version_id = v_new_version.id, status = 'draft' where id = p_proposal_id;

  perform public.recalculate_proposal_version(v_new_version.id);

  perform public.log_audit_event(v_proposal.tenant_id, v_user_id, 'proposal.revision_created', 'proposal', p_proposal_id,
    jsonb_build_object('old_version_id', v_old_version.id, 'new_version_id', v_new_version.id));
  perform public.log_crm_activity(v_proposal.tenant_id, v_proposal.client_id, v_proposal.opportunity_id, null,
    'proposal_revision_created', v_user_id,
    jsonb_build_object('old_version_id', v_old_version.id, 'new_version_id', v_new_version.id, 'title', v_proposal.title));

  select * into v_new_version from public.proposal_versions where id = v_new_version.id;
  return v_new_version;
end;
$$;

comment on function public.create_proposal_revision(uuid) is
  'The only way to edit a proposal after the client has responded: copies the locked current version''s scope/labor/materials/measurements/photos/terms into a brand-new draft version, marks the old version superseded (immutable, response stays attached to it), and returns proposals.status to draft. Requires proposals.create_revision and a current version in status accepted/declined with a locked proposal_version. See docs/58-proposal-revision-flow.md.';

revoke execute on function public.create_proposal_revision(uuid) from public;
grant execute on function public.create_proposal_revision(uuid) to authenticated;
