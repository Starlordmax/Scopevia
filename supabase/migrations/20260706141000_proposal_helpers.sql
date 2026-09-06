-- Phase 2A: Proposal-centric pivot — internal helper functions.
-- None of these are granted to `authenticated` directly (revoked from
-- public/authenticated at the end) — they are called only from the
-- lifecycle functions in later migrations, same discipline as
-- log_crm_activity()/is_active_member_of_tenant().

-- Idempotent get-or-create for a tenant's proposal settings row. Safe under
-- concurrent first-access via ON CONFLICT DO NOTHING + re-select, rather
-- than a check-then-insert race.
create or replace function public.ensure_tenant_proposal_settings(p_tenant_id uuid)
returns public.tenant_proposal_settings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_settings public.tenant_proposal_settings;
begin
  insert into public.tenant_proposal_settings (tenant_id)
  values (p_tenant_id)
  on conflict (tenant_id) do nothing;

  select * into v_settings from public.tenant_proposal_settings where tenant_id = p_tenant_id;
  return v_settings;
end;
$$;

comment on function public.ensure_tenant_proposal_settings(uuid) is
  'Get-or-create a tenant''s proposal settings row with defaults. Called internally by every proposal-creation path and by the Settings page load — never fails on "already exists."';

-- Concurrency-safe sequence allocation: locks the tenant's settings row
-- (naturally a single row per tenant — no separate sequence table needed),
-- reads next_proposal_number, increments it, and returns the allocated
-- value in one transaction. Two concurrent callers serialize on the row
-- lock; neither can read a stale value.
create or replace function public.allocate_next_proposal_number(p_tenant_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_number int;
begin
  perform public.ensure_tenant_proposal_settings(p_tenant_id);

  select next_proposal_number into v_number
    from public.tenant_proposal_settings
   where tenant_id = p_tenant_id
     for update;

  update public.tenant_proposal_settings
     set next_proposal_number = next_proposal_number + 1
   where tenant_id = p_tenant_id;

  return v_number;
end;
$$;

comment on function public.allocate_next_proposal_number(uuid) is
  'Atomically allocates and advances the next proposal_number for a tenant under FOR UPDATE. Two concurrent proposal creations always get different numbers — see tests/rls/phase2a-proposals.test.ts, "concurrent creation produces different numbers."';

-- Deterministic total recalculation — see docs/32-proposal-calculation-engine.md
-- for the full order of operations and rounding rules. Never trusts any
-- total from the client; always re-derives from the current labor/line-item
-- rows. calculation_version is a literal (bumped only if the formula itself
-- changes in a future phase) so historical/locked versions can be
-- distinguished from ones computed under a newer formula.
create or replace function public.recalculate_proposal_version(p_proposal_version_id uuid)
returns public.proposal_versions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version public.proposal_versions;
  v_labor_total bigint;
  v_line_items_subtotal bigint;
  v_line_items_taxable_subtotal bigint;
  v_subtotal bigint;
  v_discount bigint;
  v_taxable_subtotal bigint;
  v_tax bigint;
  v_total bigint;
begin
  select * into v_version from public.proposal_versions where id = p_proposal_version_id for update;
  if not found then
    raise exception 'Proposal version not found' using errcode = 'P0002';
  end if;

  if v_version.version_status <> 'draft' then
    raise exception 'Cannot recalculate a version that is not in draft' using errcode = '55000';
  end if;

  select coalesce(sum(total_cents), 0) into v_labor_total
    from public.proposal_labor_items
   where proposal_version_id = p_proposal_version_id and archived_at is null;

  select coalesce(sum(line_total_cents), 0),
         coalesce(sum(line_total_cents) filter (where taxable), 0)
    into v_line_items_subtotal, v_line_items_taxable_subtotal
    from public.proposal_line_items
   where proposal_version_id = p_proposal_version_id and archived_at is null;

  -- Documented decision (docs/adr/0031-tax-and-discount-model.md): labor IS
  -- taxable by default in Phase 2A. A per-tenant "labor is non-taxable"
  -- toggle is deferred — this is a real jurisdiction-dependent business rule
  -- that deserves an explicit future decision, not a guess baked in twice.
  v_subtotal := v_labor_total + v_line_items_subtotal;

  v_discount := case v_version.discount_type
    when 'fixed' then v_version.discount_value
    when 'percentage' then floor(v_subtotal * v_version.discount_value / 10000.0)
    else 0
  end;
  if v_discount > v_subtotal then
    v_discount := v_subtotal; -- discount can never exceed the subtotal
  end if;

  -- The discount is prorated between taxable and non-taxable amounts in
  -- proportion to their share of the subtotal (documented decision — see
  -- docs/32-proposal-calculation-engine.md, "Discount proration").
  v_taxable_subtotal := v_labor_total + v_line_items_taxable_subtotal;
  if v_subtotal > 0 then
    v_taxable_subtotal := v_taxable_subtotal - floor(v_discount * v_taxable_subtotal::numeric / v_subtotal);
  end if;
  if v_taxable_subtotal < 0 then
    v_taxable_subtotal := 0;
  end if;

  v_tax := floor(v_taxable_subtotal * v_version.tax_rate_bps / 10000.0);

  v_total := v_subtotal - v_discount + v_tax;
  if v_total < 0 then
    v_total := 0; -- defense in depth; the discount cap above already prevents this
  end if;

  update public.proposal_versions
     set labor_total_cents = v_labor_total,
         line_items_subtotal_cents = v_line_items_subtotal,
         subtotal_cents = v_subtotal,
         discount_cents = v_discount,
         taxable_subtotal_cents = v_taxable_subtotal,
         tax_cents = v_tax,
         total_cents = v_total,
         calculation_version = 1
   where id = p_proposal_version_id
   returning * into v_version;

  return v_version;
end;
$$;

comment on function public.recalculate_proposal_version(uuid) is
  'The single source of truth for a proposal_version''s totals. Called internally after every labor/line-item mutation. Never callable with client-supplied totals — see docs/32-proposal-calculation-engine.md.';

revoke execute on function public.ensure_tenant_proposal_settings(uuid) from public, authenticated;
revoke execute on function public.allocate_next_proposal_number(uuid) from public, authenticated;
revoke execute on function public.recalculate_proposal_version(uuid) from public, authenticated;
