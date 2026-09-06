-- Phase 2A: Proposal-centric pivot — proposal_versions.
--
-- Every commercial field (scope intro, terms, pricing) lives on the version,
-- not the proposal, so a locked version is a true immutable snapshot. Only
-- one `draft` version may exist per proposal at a time (partial unique
-- index) — see docs/adr/0028-proposal-versioning.md. `locked` versions are
-- enforced immutable by every section/labor/line-item/media mutation
-- function checking version_status = 'draft' before writing (defense in
-- depth on top of no direct UPDATE grant to authenticated).
--
-- Money: cents (bigint), always recalculated server-side by
-- recalculate_proposal_version() — never trusted from the client. See
-- docs/32-proposal-calculation-engine.md.

create table public.proposal_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  proposal_id uuid not null,
  version_number int not null check (version_number > 0),
  version_status text not null default 'draft' check (version_status in ('draft', 'locked', 'superseded')),
  summary text,
  scope_intro text,
  estimated_start_date date,
  estimated_duration_days int check (estimated_duration_days is null or estimated_duration_days > 0),
  default_hours_per_day numeric(5,2) check (default_hours_per_day is null or default_hours_per_day > 0),
  terms text not null default '',
  exclusions text not null default '',
  notes_for_client text not null default '',
  discount_type text not null default 'none' check (discount_type in ('none', 'fixed', 'percentage')),
  -- Cents when discount_type='fixed', basis points when 'percentage', 0 when 'none'.
  discount_value bigint not null default 0,
  tax_rate_bps int not null default 0 check (tax_rate_bps between 0 and 10000),
  -- Derived/cached totals — written exclusively by recalculate_proposal_version().
  labor_total_cents bigint not null default 0,
  line_items_subtotal_cents bigint not null default 0,
  subtotal_cents bigint not null default 0,
  discount_cents bigint not null default 0,
  taxable_subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  calculation_version int not null default 1,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  unique (id, tenant_id),
  unique (proposal_id, version_number),
  foreign key (proposal_id, tenant_id) references public.proposals (id, tenant_id),
  constraint proposal_versions_discount_value_check check (
    (discount_type = 'none' and discount_value = 0)
    or (discount_type = 'fixed' and discount_value >= 0)
    or (discount_type = 'percentage' and discount_value between 0 and 10000)
  )
);

comment on table public.proposal_versions is
  'The versioned, snapshot-able commercial content of a proposal. Only one version_status=draft row per proposal_id (partial unique index below). locked_at is set when a version is locked (Phase 2A exposes this only via admin/test functions, not real send — see docs/31-proposal-state-machines.md).';

create unique index proposal_versions_one_draft_per_proposal
  on public.proposal_versions (proposal_id)
  where version_status = 'draft';

create index proposal_versions_proposal_id_idx on public.proposal_versions (proposal_id);

create trigger trg_proposal_versions_set_updated_at
  before update on public.proposal_versions
  for each row execute function public.set_updated_at();

-- Now that proposal_versions exists, close the circular reference from
-- proposals.current_version_id.
alter table public.proposals
  add constraint proposals_current_version_id_fkey
  foreign key (current_version_id, tenant_id) references public.proposal_versions (id, tenant_id);

-- Immutability backstop: even though every mutation function checks
-- version_status = 'draft' before writing, a trigger is the same "second
-- barrier" discipline used for estimate_versions in the original design
-- (docs/05) and for crm_activities append-only enforcement — a locked
-- version's own commercial fields can never be UPDATEd by anyone, including
-- service_role, except the one sanctioned transition (draft -> locked, or
-- locked -> superseded) performed by the lifecycle functions themselves.
create or replace function public.prevent_locked_proposal_version_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.version_status = 'locked' then
    -- Allow only version_status itself to change (locked -> superseded),
    -- and allow updated_at/current housekeeping columns; reject any change
    -- to commercial content.
    if new.version_status not in ('locked', 'superseded') then
      raise exception 'Cannot modify a locked proposal version''s status to %', new.version_status using errcode = '55000';
    end if;
    if new.summary is distinct from old.summary
      or new.scope_intro is distinct from old.scope_intro
      or new.estimated_start_date is distinct from old.estimated_start_date
      or new.estimated_duration_days is distinct from old.estimated_duration_days
      or new.default_hours_per_day is distinct from old.default_hours_per_day
      or new.terms is distinct from old.terms
      or new.exclusions is distinct from old.exclusions
      or new.notes_for_client is distinct from old.notes_for_client
      or new.discount_type is distinct from old.discount_type
      or new.discount_value is distinct from old.discount_value
      or new.tax_rate_bps is distinct from old.tax_rate_bps
      or new.labor_total_cents is distinct from old.labor_total_cents
      or new.line_items_subtotal_cents is distinct from old.line_items_subtotal_cents
      or new.subtotal_cents is distinct from old.subtotal_cents
      or new.discount_cents is distinct from old.discount_cents
      or new.taxable_subtotal_cents is distinct from old.taxable_subtotal_cents
      or new.tax_cents is distinct from old.tax_cents
      or new.total_cents is distinct from old.total_cents
    then
      raise exception 'A locked proposal version is immutable' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_proposal_versions_prevent_locked_mutation
  before update on public.proposal_versions
  for each row execute function public.prevent_locked_proposal_version_mutation();

-- Generic child-table guard: any row referencing a locked proposal_version
-- via a `proposal_version_id` column cannot be inserted, updated, or
-- deleted. Applied as a trigger on proposal_sections, proposal_labor_items,
-- proposal_line_items, and proposal_media in their own migration files —
-- defense in depth on top of every CRUD function's own draft-only check.
create or replace function public.prevent_locked_version_child_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_version_id uuid;
  v_status text;
begin
  if tg_op = 'DELETE' then
    v_version_id := old.proposal_version_id;
  else
    v_version_id := new.proposal_version_id;
  end if;

  select version_status into v_status from public.proposal_versions where id = v_version_id;
  if v_status = 'locked' then
    raise exception 'Cannot modify children of a locked proposal version' using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
