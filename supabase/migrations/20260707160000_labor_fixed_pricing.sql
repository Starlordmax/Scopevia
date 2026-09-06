-- Adds a second labor pricing mode: a contractor can now price labor
-- either as an hourly calculation (unchanged) or as a single fixed price
-- (new). See docs/39-fixed-labor-pricing.md.
--
-- The four hourly-only columns (worker_count, estimated_days,
-- hours_per_day, hourly_rate_cents) lose their NOT NULL constraint so a
-- 'fixed' row can leave them null -- their existing per-column CHECK
-- constraints (e.g. "worker_count > 0") already pass on NULL under
-- standard SQL three-valued logic, so nothing else about them needs to
-- change. A composite CHECK below enforces that every row still has
-- exactly the fields its own pricing_method requires.
--
-- Every existing row is implicitly 'hourly' (the new column's DEFAULT),
-- so no existing proposal is affected and no data is rewritten.

alter table public.proposal_labor_items
  alter column worker_count drop not null,
  alter column estimated_days drop not null,
  alter column hours_per_day drop not null,
  alter column hourly_rate_cents drop not null;

alter table public.proposal_labor_items
  add column pricing_method text not null default 'hourly',
  add column fixed_total_cents bigint;

alter table public.proposal_labor_items
  add constraint proposal_labor_items_pricing_method_check
  check (pricing_method in ('hourly', 'fixed'));

alter table public.proposal_labor_items
  add constraint proposal_labor_items_fixed_total_cents_check
  check (fixed_total_cents is null or (fixed_total_cents >= 0 and fixed_total_cents <= 100000000000));

-- Exactly the fields the brief specifies per mode: hourly requires all
-- four hourly fields (never a null in the middle of a real calculation);
-- fixed requires fixed_total_cents and leaves the hourly fields null (not
-- merely "ignored" -- a stray hourly value on a fixed row would be
-- misleading data to carry around).
alter table public.proposal_labor_items
  add constraint proposal_labor_items_pricing_fields_check
  check (
    (pricing_method = 'hourly'
      and worker_count is not null and estimated_days is not null
      and hours_per_day is not null and hourly_rate_cents is not null
      and fixed_total_cents is null)
    or
    (pricing_method = 'fixed'
      and fixed_total_cents is not null
      and worker_count is null and estimated_days is null
      and hours_per_day is null and hourly_rate_cents is null)
  );

comment on column public.proposal_labor_items.pricing_method is
  'hourly: total_cents computed from worker_count*estimated_days*hours_per_day*hourly_rate_cents. fixed: total_cents = fixed_total_cents verbatim, total_hours = 0 (not tracked). Never client-trusted -- see add/update_proposal_labor_item().';
comment on column public.proposal_labor_items.fixed_total_cents is
  'Only set when pricing_method = fixed. Server-validated (>=0, capped) but not server-computed -- this is the one labor value a contractor enters directly rather than derives from a rate.';

-- =============================================================================
-- add_proposal_labor_item / update_proposal_labor_item — extended for both
-- pricing modes. Appending p_pricing_method/p_fixed_total_cents changes
-- the parameter TYPE LIST, which Postgres treats as a distinct overload
-- rather than a replacement of the existing function -- CREATE OR REPLACE
-- would silently leave the old 6/7-parameter version callable alongside
-- the new one, exactly the ambiguous-overload condition that caused the
-- update_proposal_scope "schema cache" bug (see
-- docs/37-proposal-scope-rpc-fix.md). The old signatures are dropped
-- explicitly first.
-- =============================================================================

drop function if exists public.add_proposal_labor_item(uuid, text, int, numeric, numeric, bigint, int);
drop function if exists public.update_proposal_labor_item(uuid, text, int, numeric, numeric, bigint);

create function public.add_proposal_labor_item(
  p_proposal_version_id uuid,
  p_label text,
  p_worker_count int,
  p_estimated_days numeric,
  p_hours_per_day numeric,
  p_hourly_rate_cents bigint,
  p_sort_order int default 0,
  p_pricing_method text default 'hourly',
  p_fixed_total_cents bigint default null
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

  if p_pricing_method is null or p_pricing_method not in ('hourly', 'fixed') then
    raise exception 'Invalid pricing method' using errcode = '22023';
  end if;

  if p_pricing_method = 'fixed' then
    if p_fixed_total_cents is null or p_fixed_total_cents < 0 or p_fixed_total_cents > 100000000000 then
      raise exception 'Fixed labor price must be zero or greater' using errcode = '22023';
    end if;

    v_total_hours := 0;
    v_total_cents := p_fixed_total_cents;

    insert into public.proposal_labor_items (
      tenant_id, proposal_version_id, label, pricing_method, fixed_total_cents,
      worker_count, estimated_days, hours_per_day, hourly_rate_cents,
      total_hours, total_cents, sort_order
    )
    values (
      v_version.tenant_id, p_proposal_version_id, btrim(p_label), 'fixed', p_fixed_total_cents,
      null, null, null, null,
      v_total_hours, v_total_cents, p_sort_order
    )
    returning * into v_item;
  else
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
      tenant_id, proposal_version_id, label, pricing_method, fixed_total_cents,
      worker_count, estimated_days, hours_per_day, hourly_rate_cents,
      total_hours, total_cents, sort_order
    )
    values (
      v_version.tenant_id, p_proposal_version_id, btrim(p_label), 'hourly', null,
      p_worker_count, p_estimated_days, p_hours_per_day, p_hourly_rate_cents,
      v_total_hours, v_total_cents, p_sort_order
    )
    returning * into v_item;
  end if;

  perform public.recalculate_proposal_version(p_proposal_version_id);

  perform public.log_audit_event(v_version.tenant_id, v_user_id, 'proposal.labor_created', 'proposal_labor_item', v_item.id,
    jsonb_build_object('proposal_version_id', p_proposal_version_id, 'pricing_method', p_pricing_method, 'total_cents', v_total_cents));

  return v_item;
end;
$$;

comment on function public.add_proposal_labor_item(uuid, text, int, numeric, numeric, bigint, int, text, bigint) is
  'hourly: total_hours = worker_count * estimated_days * hours_per_day; total_cents = round(total_hours * hourly_rate_cents). fixed: total_cents = fixed_total_cents, total_hours = 0. Always computed/validated server-side — see docs/32-proposal-calculation-engine.md and docs/39-fixed-labor-pricing.md.';

create function public.update_proposal_labor_item(
  p_labor_item_id uuid,
  p_label text,
  p_worker_count int,
  p_estimated_days numeric,
  p_hours_per_day numeric,
  p_hourly_rate_cents bigint,
  p_pricing_method text default 'hourly',
  p_fixed_total_cents bigint default null
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

  if p_pricing_method is null or p_pricing_method not in ('hourly', 'fixed') then
    raise exception 'Invalid pricing method' using errcode = '22023';
  end if;

  if p_pricing_method = 'fixed' then
    if p_fixed_total_cents is null or p_fixed_total_cents < 0 or p_fixed_total_cents > 100000000000 then
      raise exception 'Fixed labor price must be zero or greater' using errcode = '22023';
    end if;

    v_total_hours := 0;
    v_total_cents := p_fixed_total_cents;

    update public.proposal_labor_items
       set label = btrim(p_label), pricing_method = 'fixed', fixed_total_cents = p_fixed_total_cents,
           worker_count = null, estimated_days = null, hours_per_day = null, hourly_rate_cents = null,
           total_hours = v_total_hours, total_cents = v_total_cents
     where id = p_labor_item_id
     returning * into v_result;
  else
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
       set label = btrim(p_label), pricing_method = 'hourly', fixed_total_cents = null,
           worker_count = p_worker_count, estimated_days = p_estimated_days,
           hours_per_day = p_hours_per_day, hourly_rate_cents = p_hourly_rate_cents,
           total_hours = v_total_hours, total_cents = v_total_cents
     where id = p_labor_item_id
     returning * into v_result;
  end if;

  perform public.recalculate_proposal_version(v_row.proposal_version_id);

  perform public.log_audit_event(v_row.tenant_id, v_user_id, 'proposal.labor_updated', 'proposal_labor_item', p_labor_item_id,
    jsonb_build_object('pricing_method', p_pricing_method, 'total_cents', v_total_cents));

  return v_result;
end;
$$;

comment on function public.update_proposal_labor_item(uuid, text, int, numeric, numeric, bigint, text, bigint) is
  'Same computation rules as add_proposal_labor_item(); switching pricing_method on an existing item clears the fields belonging to the other mode rather than leaving stale values behind.';

revoke execute on function public.add_proposal_labor_item(uuid, text, int, numeric, numeric, bigint, int, text, bigint) from public;
grant execute on function public.add_proposal_labor_item(uuid, text, int, numeric, numeric, bigint, int, text, bigint) to authenticated;
revoke execute on function public.update_proposal_labor_item(uuid, text, int, numeric, numeric, bigint, text, bigint) from public;
grant execute on function public.update_proposal_labor_item(uuid, text, int, numeric, numeric, bigint, text, bigint) to authenticated;
