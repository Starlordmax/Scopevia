-- Phase 2A: Proposal-centric pivot — proposal_labor_items (the labor
-- calculator). total_hours/total_cents are written exclusively by
-- add_proposal_labor_item()/update_proposal_labor_item() in PL/pgSQL —
-- never accepted from the client — see docs/32-proposal-calculation-engine.md.
--
-- total_hours = worker_count * estimated_days * hours_per_day
-- total_cents = round(total_hours * hourly_rate_cents)

create table public.proposal_labor_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  proposal_version_id uuid not null,
  label text not null check (btrim(label) <> ''),
  worker_count int not null check (worker_count > 0 and worker_count <= 500),
  estimated_days numeric(7,2) not null check (estimated_days > 0 and estimated_days <= 3650),
  hours_per_day numeric(5,2) not null check (hours_per_day > 0 and hours_per_day <= 24),
  hourly_rate_cents bigint not null check (hourly_rate_cents >= 0 and hourly_rate_cents <= 100000000),
  total_hours numeric(12,2) not null default 0 check (total_hours >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, tenant_id),
  foreign key (proposal_version_id, tenant_id) references public.proposal_versions (id, tenant_id)
);

comment on table public.proposal_labor_items is
  'One labor line (e.g. "Lead painter", "Remodeling crew") within a proposal_version. total_hours/total_cents are always server-computed by add_proposal_labor_item()/update_proposal_labor_item() — bounds above (worker_count<=500, days<=3650, hours_per_day<=24, rate<=$1,000,000/hr) exist purely to reject NaN/Infinity/absurd-input attempts, not as realistic business limits.';

create index proposal_labor_items_version_idx on public.proposal_labor_items (proposal_version_id, sort_order) where archived_at is null;

create trigger trg_proposal_labor_items_set_updated_at
  before update on public.proposal_labor_items
  for each row execute function public.set_updated_at();

create trigger trg_proposal_labor_items_prevent_locked_mutation
  before insert or update or delete on public.proposal_labor_items
  for each row execute function public.prevent_locked_version_child_mutation();
