-- Phase 1: CRM & Projects — opportunities
--
-- State list is a deliberate, documented simplification of the pre-implementation
-- design in docs/08-state-machines.md (which included `estimating`, `proposal_sent`,
-- `negotiating` — states that depend on the Estimates/Proposals modules, which do not
-- exist yet). See docs/adr/0011-opportunity-state-machine-for-phase-1.md.
--
-- States: new, contacted, qualified, inspection_scheduled, ready_for_estimate,
-- won, lost, archived. Transitions are enforced exclusively by
-- change_opportunity_status() (see 20260702130700_crm_functions_opportunities.sql) —
-- there is no direct UPDATE grant on `status`.

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  client_id uuid not null,
  title text not null check (btrim(title) <> ''),
  status text not null default 'new' check (
    status in ('new', 'contacted', 'qualified', 'inspection_scheduled', 'ready_for_estimate', 'won', 'lost', 'archived')
  ),
  -- Populated only when status transitions to 'archived', so restore_opportunity()
  -- knows whether to return the opportunity to 'won' or 'lost'. archived is only
  -- reachable from those two states — see the transition table in
  -- docs/22-phase-1-state-machines.md.
  pre_archive_status text check (pre_archive_status in ('won', 'lost')),
  source text,
  estimated_value_cents bigint check (estimated_value_cents is null or estimated_value_cents >= 0),
  probability int check (probability is null or probability between 0 and 100),
  expected_close_date date,
  inspection_scheduled_at timestamptz,
  -- Required once status = 'lost' (enforced here AND in change_opportunity_status()
  -- as defense in depth). Deliberately NOT cleared when leaving 'lost' — kept as
  -- historical record of why a previously-dead lead was revived. See ADR 0011.
  lost_reason text,
  assigned_to uuid,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references auth.users (id),
  unique (id, tenant_id),
  foreign key (client_id, tenant_id) references public.clients (id, tenant_id),
  foreign key (assigned_to, tenant_id) references public.tenant_memberships (id, tenant_id),
  constraint opportunities_lost_reason_required check (status <> 'lost' or lost_reason is not null),
  constraint opportunities_inspection_date_required check (status <> 'inspection_scheduled' or inspection_scheduled_at is not null)
);

comment on table public.opportunities is
  'A potential sale. Mutated exclusively via create_opportunity()/update_opportunity()/change_opportunity_status()/archive_opportunity()/restore_opportunity()/convert_opportunity_to_project(). `assigned_to` references tenant_memberships (not auth.users) so the composite FK guarantees same-tenant assignment declaratively; a suspended/removed assignee is NOT automatically unassigned (see docs/20-phase-1-crm-and-projects.md, "Assignees") — the UI shows their membership status instead.';

create index opportunities_tenant_status_idx on public.opportunities (tenant_id, status) where archived_at is null;
create index opportunities_client_id_idx on public.opportunities (client_id);
create index opportunities_assigned_to_idx on public.opportunities (assigned_to) where assigned_to is not null;
create index opportunities_title_trgm_idx on public.opportunities using gin (title extensions.gin_trgm_ops);

create trigger trg_opportunities_set_updated_at
  before update on public.opportunities
  for each row execute function public.set_updated_at();
