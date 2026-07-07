-- Phase 2A: Proposal-centric pivot — section/labor/line-item CRUD.
--
-- Permission split (docs/27 of the brief, "Decide expresamente si Sales
-- puede modificar precios"): editing scope sections (non-monetary) requires
-- `proposals.update`; editing labor or line items (monetary) requires the
-- stricter `proposals.manage_pricing`, NOT granted to Sales by default — see
-- the seed migration and docs/adr/0030-labor-calculation-model.md.
--
-- Every function here re-validates version_status = 'draft' with a friendly
-- error BEFORE relying on the trg_*_prevent_locked_mutation triggers, which
-- exist purely as a second barrier (defense in depth), not the primary UX.

create or replace function public.add_proposal_section(
  p_proposal_version_id uuid,
  p_title text,
  p_description text default '',
  p_section_type text default 'custom',
  p_sort_order int default 0
)
returns public.proposal_sections
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_version public.proposal_versions;
  v_proposal public.proposals;
  v_section public.proposal_sections;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_version from public.proposal_versions where id = p_proposal_version_id;
  if not found then
    raise exception 'Proposal version not found' using errcode = 'P0002';
  end if;

  select * into v_proposal from public.proposals where id = v_version.proposal_id;

  if not public.user_has_permission(v_version.tenant_id, 'proposals.update') then
    raise exception 'Missing permission: proposals.update' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'Section title is required' using errcode = '22023';
  end if;

  insert into public.proposal_sections (tenant_id, proposal_version_id, title, description, section_type, sort_order)
  values (v_version.tenant_id, p_proposal_version_id, btrim(p_title), coalesce(p_description, ''), p_section_type, p_sort_order)
  returning * into v_section;

  perform public.log_audit_event(v_version.tenant_id, v_user_id, 'proposal.section_created', 'proposal_section', v_section.id,
    jsonb_build_object('proposal_version_id', p_proposal_version_id));

  return v_section;
end;
$$;

create or replace function public.update_proposal_section(
  p_section_id uuid,
  p_title text,
  p_description text,
  p_section_type text
)
returns public.proposal_sections
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.proposal_sections;
  v_version public.proposal_versions;
  v_result public.proposal_sections;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.proposal_sections where id = p_section_id;
  if not found then
    raise exception 'Section not found' using errcode = 'P0002';
  end if;

  select * into v_version from public.proposal_versions where id = v_row.proposal_version_id;

  if not public.user_has_permission(v_row.tenant_id, 'proposals.update') then
    raise exception 'Missing permission: proposals.update' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'Section title is required' using errcode = '22023';
  end if;

  update public.proposal_sections
     set title = btrim(p_title), description = coalesce(p_description, ''), section_type = coalesce(p_section_type, section_type)
   where id = p_section_id
   returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'proposal.section_updated', 'proposal_section', p_section_id, '{}'::jsonb);

  return v_result;
end;
$$;

create or replace function public.reorder_proposal_sections(p_proposal_version_id uuid, p_section_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_version public.proposal_versions;
  v_id uuid;
  v_position int := 0;
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

  foreach v_id in array p_section_ids loop
    update public.proposal_sections
       set sort_order = v_position
     where id = v_id and proposal_version_id = p_proposal_version_id;
    v_position := v_position + 1;
  end loop;
end;
$$;

create or replace function public.archive_proposal_section(p_section_id uuid)
returns public.proposal_sections
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.proposal_sections;
  v_version public.proposal_versions;
  v_result public.proposal_sections;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.proposal_sections where id = p_section_id;
  if not found then
    raise exception 'Section not found' using errcode = 'P0002';
  end if;

  select * into v_version from public.proposal_versions where id = v_row.proposal_version_id;

  if not public.user_has_permission(v_row.tenant_id, 'proposals.update') then
    raise exception 'Missing permission: proposals.update' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  update public.proposal_sections set archived_at = now() where id = p_section_id returning * into v_result;

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'proposal.section_archived', 'proposal_section', p_section_id, '{}'::jsonb);

  return v_result;
end;
$$;

-- =============================================================================
-- Labor items
-- =============================================================================

create or replace function public.add_proposal_labor_item(
  p_proposal_version_id uuid,
  p_label text,
  p_worker_count int,
  p_estimated_days numeric,
  p_hours_per_day numeric,
  p_hourly_rate_cents bigint,
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
  v_item public.proposal_labor_items;
  v_total_hours numeric(12,2);
  v_total_cents bigint;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_version from public.proposal_versions where id = p_proposal_version_id;
  if not found then
    raise exception 'Proposal version not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_version.tenant_id, 'proposals.manage_pricing') then
    raise exception 'Missing permission: proposals.manage_pricing' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  if p_label is null or btrim(p_label) = '' then
    raise exception 'Label is required' using errcode = '22023';
  end if;
  if p_worker_count is null or p_worker_count <= 0 or p_worker_count > 500 then
    raise exception 'Worker count must be greater than zero' using errcode = '22023';
  end if;
  if p_estimated_days is null or p_estimated_days <= 0 or p_estimated_days > 3650 or p_estimated_days = 'NaN'::numeric then
    raise exception 'Estimated days must be greater than zero' using errcode = '22023';
  end if;
  if p_hours_per_day is null or p_hours_per_day <= 0 or p_hours_per_day > 24 or p_hours_per_day = 'NaN'::numeric then
    raise exception 'Hours per day must be greater than zero' using errcode = '22023';
  end if;
  if p_hourly_rate_cents is null or p_hourly_rate_cents < 0 then
    raise exception 'Hourly rate cannot be negative' using errcode = '22023';
  end if;

  v_total_hours := round(p_worker_count * p_estimated_days * p_hours_per_day, 2);
  v_total_cents := round(v_total_hours * p_hourly_rate_cents);

  insert into public.proposal_labor_items (
    tenant_id, proposal_version_id, label, worker_count, estimated_days, hours_per_day,
    hourly_rate_cents, total_hours, total_cents, sort_order
  )
  values (
    v_version.tenant_id, p_proposal_version_id, btrim(p_label), p_worker_count, p_estimated_days, p_hours_per_day,
    p_hourly_rate_cents, v_total_hours, v_total_cents, p_sort_order
  )
  returning * into v_item;

  perform public.recalculate_proposal_version(p_proposal_version_id);

  perform public.log_audit_event(v_version.tenant_id, v_user_id, 'proposal.labor_created', 'proposal_labor_item', v_item.id,
    jsonb_build_object('proposal_version_id', p_proposal_version_id, 'total_cents', v_total_cents));

  return v_item;
end;
$$;

comment on function public.add_proposal_labor_item(uuid, text, int, numeric, numeric, bigint, int) is
  'total_hours = worker_count * estimated_days * hours_per_day; total_cents = round(total_hours * hourly_rate_cents). Always computed server-side — see docs/32-proposal-calculation-engine.md.';

create or replace function public.update_proposal_labor_item(
  p_labor_item_id uuid,
  p_label text,
  p_worker_count int,
  p_estimated_days numeric,
  p_hours_per_day numeric,
  p_hourly_rate_cents bigint
)
returns public.proposal_labor_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.proposal_labor_items;
  v_version public.proposal_versions;
  v_result public.proposal_labor_items;
  v_total_hours numeric(12,2);
  v_total_cents bigint;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.proposal_labor_items where id = p_labor_item_id;
  if not found then
    raise exception 'Labor item not found' using errcode = 'P0002';
  end if;

  select * into v_version from public.proposal_versions where id = v_row.proposal_version_id;

  if not public.user_has_permission(v_row.tenant_id, 'proposals.manage_pricing') then
    raise exception 'Missing permission: proposals.manage_pricing' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  if p_label is null or btrim(p_label) = '' then
    raise exception 'Label is required' using errcode = '22023';
  end if;
  if p_worker_count is null or p_worker_count <= 0 or p_worker_count > 500 then
    raise exception 'Worker count must be greater than zero' using errcode = '22023';
  end if;
  if p_estimated_days is null or p_estimated_days <= 0 or p_estimated_days > 3650 then
    raise exception 'Estimated days must be greater than zero' using errcode = '22023';
  end if;
  if p_hours_per_day is null or p_hours_per_day <= 0 or p_hours_per_day > 24 then
    raise exception 'Hours per day must be greater than zero' using errcode = '22023';
  end if;
  if p_hourly_rate_cents is null or p_hourly_rate_cents < 0 then
    raise exception 'Hourly rate cannot be negative' using errcode = '22023';
  end if;

  v_total_hours := round(p_worker_count * p_estimated_days * p_hours_per_day, 2);
  v_total_cents := round(v_total_hours * p_hourly_rate_cents);

  update public.proposal_labor_items
     set label = btrim(p_label), worker_count = p_worker_count, estimated_days = p_estimated_days,
         hours_per_day = p_hours_per_day, hourly_rate_cents = p_hourly_rate_cents,
         total_hours = v_total_hours, total_cents = v_total_cents
   where id = p_labor_item_id
   returning * into v_result;

  perform public.recalculate_proposal_version(v_row.proposal_version_id);

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'proposal.labor_updated', 'proposal_labor_item', p_labor_item_id,
    jsonb_build_object('total_cents', v_total_cents));

  return v_result;
end;
$$;

create or replace function public.archive_proposal_labor_item(p_labor_item_id uuid)
returns public.proposal_labor_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.proposal_labor_items;
  v_version public.proposal_versions;
  v_result public.proposal_labor_items;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.proposal_labor_items where id = p_labor_item_id;
  if not found then
    raise exception 'Labor item not found' using errcode = 'P0002';
  end if;

  select * into v_version from public.proposal_versions where id = v_row.proposal_version_id;

  if not public.user_has_permission(v_row.tenant_id, 'proposals.manage_pricing') then
    raise exception 'Missing permission: proposals.manage_pricing' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  update public.proposal_labor_items set archived_at = now() where id = p_labor_item_id returning * into v_result;

  perform public.recalculate_proposal_version(v_row.proposal_version_id);

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'proposal.labor_archived', 'proposal_labor_item', p_labor_item_id, '{}'::jsonb);

  return v_result;
end;
$$;

-- =============================================================================
-- Line items
-- =============================================================================

create or replace function public.add_proposal_line_item(
  p_proposal_version_id uuid,
  p_category text,
  p_description text,
  p_quantity numeric,
  p_unit text,
  p_unit_price_cents bigint,
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
  v_item public.proposal_line_items;
  v_line_total bigint;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_version from public.proposal_versions where id = p_proposal_version_id;
  if not found then
    raise exception 'Proposal version not found' using errcode = 'P0002';
  end if;

  if not public.user_has_permission(v_version.tenant_id, 'proposals.manage_pricing') then
    raise exception 'Missing permission: proposals.manage_pricing' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  if p_description is null or btrim(p_description) = '' then
    raise exception 'Description is required' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000 then
    raise exception 'Quantity must be greater than zero' using errcode = '22023';
  end if;
  if p_unit_price_cents is null or p_unit_price_cents < 0 then
    raise exception 'Unit price cannot be negative' using errcode = '22023';
  end if;
  if p_section_id is not null and not exists (
    select 1 from public.proposal_sections where id = p_section_id and proposal_version_id = p_proposal_version_id
  ) then
    raise exception 'Section does not belong to this proposal version' using errcode = '22023';
  end if;

  v_line_total := round(p_quantity * p_unit_price_cents);

  insert into public.proposal_line_items (
    tenant_id, proposal_version_id, section_id, category, description, quantity, unit,
    unit_price_cents, line_total_cents, taxable, sort_order
  )
  values (
    v_version.tenant_id, p_proposal_version_id, p_section_id, p_category, btrim(p_description), p_quantity, p_unit,
    p_unit_price_cents, v_line_total, p_taxable, p_sort_order
  )
  returning * into v_item;

  perform public.recalculate_proposal_version(p_proposal_version_id);

  perform public.log_audit_event(v_version.tenant_id, v_user_id, 'proposal.line_item_created', 'proposal_line_item', v_item.id,
    jsonb_build_object('proposal_version_id', p_proposal_version_id, 'line_total_cents', v_line_total));

  return v_item;
end;
$$;

comment on function public.add_proposal_line_item(uuid, text, text, numeric, text, bigint, boolean, uuid, int) is
  'line_total_cents = round(quantity * unit_price_cents). Always computed server-side, never accepted from the client.';

create or replace function public.update_proposal_line_item(
  p_line_item_id uuid,
  p_category text,
  p_description text,
  p_quantity numeric,
  p_unit text,
  p_unit_price_cents bigint,
  p_taxable boolean
)
returns public.proposal_line_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.proposal_line_items;
  v_version public.proposal_versions;
  v_result public.proposal_line_items;
  v_line_total bigint;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.proposal_line_items where id = p_line_item_id;
  if not found then
    raise exception 'Line item not found' using errcode = 'P0002';
  end if;

  select * into v_version from public.proposal_versions where id = v_row.proposal_version_id;

  if not public.user_has_permission(v_row.tenant_id, 'proposals.manage_pricing') then
    raise exception 'Missing permission: proposals.manage_pricing' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  if p_description is null or btrim(p_description) = '' then
    raise exception 'Description is required' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000 then
    raise exception 'Quantity must be greater than zero' using errcode = '22023';
  end if;
  if p_unit_price_cents is null or p_unit_price_cents < 0 then
    raise exception 'Unit price cannot be negative' using errcode = '22023';
  end if;

  v_line_total := round(p_quantity * p_unit_price_cents);

  update public.proposal_line_items
     set category = p_category, description = btrim(p_description), quantity = p_quantity, unit = p_unit,
         unit_price_cents = p_unit_price_cents, line_total_cents = v_line_total, taxable = p_taxable
   where id = p_line_item_id
   returning * into v_result;

  perform public.recalculate_proposal_version(v_row.proposal_version_id);

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'proposal.line_item_updated', 'proposal_line_item', p_line_item_id,
    jsonb_build_object('line_total_cents', v_line_total));

  return v_result;
end;
$$;

create or replace function public.archive_proposal_line_item(p_line_item_id uuid)
returns public.proposal_line_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.proposal_line_items;
  v_version public.proposal_versions;
  v_result public.proposal_line_items;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.proposal_line_items where id = p_line_item_id;
  if not found then
    raise exception 'Line item not found' using errcode = 'P0002';
  end if;

  select * into v_version from public.proposal_versions where id = v_row.proposal_version_id;

  if not public.user_has_permission(v_row.tenant_id, 'proposals.manage_pricing') then
    raise exception 'Missing permission: proposals.manage_pricing' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  update public.proposal_line_items set archived_at = now() where id = p_line_item_id returning * into v_result;

  perform public.recalculate_proposal_version(v_row.proposal_version_id);

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'proposal.line_item_archived', 'proposal_line_item', p_line_item_id, '{}'::jsonb);

  return v_result;
end;
$$;

-- =============================================================================
-- update_proposal_pricing — terms/exclusions/discount/tax live on the
-- version itself, not a child row, so they get their own small setter
-- rather than overloading update_proposal_version() with every field.
-- =============================================================================

create or replace function public.update_proposal_pricing(
  p_proposal_version_id uuid,
  p_terms text,
  p_exclusions text,
  p_notes_for_client text,
  p_discount_type text,
  p_discount_value bigint,
  p_tax_rate_bps int
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

  if not public.user_has_permission(v_version.tenant_id, 'proposals.manage_pricing') then
    raise exception 'Missing permission: proposals.manage_pricing' using errcode = '42501';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot edit a proposal version that is not in draft' using errcode = '55000';
  end if;

  if p_discount_type not in ('none', 'fixed', 'percentage') then
    raise exception 'Invalid discount type' using errcode = '22023';
  end if;
  if p_discount_type = 'percentage' and (p_discount_value < 0 or p_discount_value > 10000) then
    raise exception 'Percentage discount must be between 0 and 10000 basis points' using errcode = '22023';
  end if;
  if p_discount_type = 'fixed' and p_discount_value < 0 then
    raise exception 'Fixed discount cannot be negative' using errcode = '22023';
  end if;
  if p_tax_rate_bps is null or p_tax_rate_bps < 0 or p_tax_rate_bps > 10000 then
    raise exception 'Tax rate must be between 0 and 10000 basis points' using errcode = '22023';
  end if;

  update public.proposal_versions
     set terms = coalesce(p_terms, ''), exclusions = coalesce(p_exclusions, ''),
         notes_for_client = coalesce(p_notes_for_client, ''),
         discount_type = p_discount_type,
         discount_value = case when p_discount_type = 'none' then 0 else p_discount_value end,
         tax_rate_bps = p_tax_rate_bps
   where id = p_proposal_version_id
   returning * into v_result;

  perform public.recalculate_proposal_version(p_proposal_version_id);

  perform public.log_audit_event(v_version.tenant_id, v_user_id, 'proposal.updated', 'proposal_version', p_proposal_version_id, '{}'::jsonb);

  select * into v_result from public.proposal_versions where id = p_proposal_version_id;
  return v_result;
end;
$$;

create or replace function public.update_proposal_scope(
  p_proposal_version_id uuid,
  p_summary text,
  p_scope_intro text,
  p_estimated_start_date date,
  p_estimated_duration_days int
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

  if p_estimated_duration_days is not null and p_estimated_duration_days <= 0 then
    raise exception 'Estimated duration must be greater than zero' using errcode = '22023';
  end if;

  update public.proposal_versions
     set summary = p_summary, scope_intro = p_scope_intro,
         estimated_start_date = p_estimated_start_date, estimated_duration_days = p_estimated_duration_days
   where id = p_proposal_version_id
   returning * into v_result;

  perform public.log_audit_event(v_version.tenant_id, v_user_id, 'proposal.updated', 'proposal_version', p_proposal_version_id, '{}'::jsonb);

  return v_result;
end;
$$;

-- =============================================================================
-- Grants
-- =============================================================================

revoke execute on function public.add_proposal_section(uuid, text, text, text, int) from public;
grant execute on function public.add_proposal_section(uuid, text, text, text, int) to authenticated;
revoke execute on function public.update_proposal_section(uuid, text, text, text) from public;
grant execute on function public.update_proposal_section(uuid, text, text, text) to authenticated;
revoke execute on function public.reorder_proposal_sections(uuid, uuid[]) from public;
grant execute on function public.reorder_proposal_sections(uuid, uuid[]) to authenticated;
revoke execute on function public.archive_proposal_section(uuid) from public;
grant execute on function public.archive_proposal_section(uuid) to authenticated;

revoke execute on function public.add_proposal_labor_item(uuid, text, int, numeric, numeric, bigint, int) from public;
grant execute on function public.add_proposal_labor_item(uuid, text, int, numeric, numeric, bigint, int) to authenticated;
revoke execute on function public.update_proposal_labor_item(uuid, text, int, numeric, numeric, bigint) from public;
grant execute on function public.update_proposal_labor_item(uuid, text, int, numeric, numeric, bigint) to authenticated;
revoke execute on function public.archive_proposal_labor_item(uuid) from public;
grant execute on function public.archive_proposal_labor_item(uuid) to authenticated;

revoke execute on function public.add_proposal_line_item(uuid, text, text, numeric, text, bigint, boolean, uuid, int) from public;
grant execute on function public.add_proposal_line_item(uuid, text, text, numeric, text, bigint, boolean, uuid, int) to authenticated;
revoke execute on function public.update_proposal_line_item(uuid, text, text, numeric, text, bigint, boolean) from public;
grant execute on function public.update_proposal_line_item(uuid, text, text, numeric, text, bigint, boolean) to authenticated;
revoke execute on function public.archive_proposal_line_item(uuid) from public;
grant execute on function public.archive_proposal_line_item(uuid) to authenticated;

revoke execute on function public.update_proposal_pricing(uuid, text, text, text, text, bigint, int) from public;
grant execute on function public.update_proposal_pricing(uuid, text, text, text, text, bigint, int) to authenticated;
revoke execute on function public.update_proposal_scope(uuid, text, text, date, int) from public;
grant execute on function public.update_proposal_scope(uuid, text, text, date, int) to authenticated;
