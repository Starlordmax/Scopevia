-- Phase 2A: Proposal-centric pivot — proposals (the container; see
-- 20260706140300_proposal_versions.sql for the versioned commercial content).
--
-- `current_version_id` has no inline FK here because proposal_versions
-- references proposals — the composite FK is added by an ALTER TABLE at the
-- end of 20260706140300 once proposal_versions exists (standard pattern for
-- a circular reference).
--
-- service_type is shared with portfolio_projects (see
-- 20260706140800_portfolio.sql) — kept as a plain CHECK list rather than a
-- lookup table, matching the brief's "no full per-industry catalog yet."

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  proposal_number int not null check (proposal_number > 0),
  client_id uuid not null,
  client_contact_id uuid,
  opportunity_id uuid,
  title text not null check (btrim(title) <> ''),
  service_type text not null check (service_type in (
    'interior_painting', 'exterior_painting', 'bathroom_remodeling',
    'general_remodeling', 'flooring', 'custom'
  )),
  status text not null default 'draft' check (status in (
    'draft', 'ready', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'superseded', 'archived'
  )),
  -- No inline FK yet — see migration header.
  current_version_id uuid,
  source text not null check (source in ('from_opportunity', 'direct')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references auth.users (id),
  -- Populated only when archived, mirroring opportunities/projects (ADR 0010)
  -- — restore_proposal() uses it to know whether to return to draft or ready.
  pre_archive_status text check (pre_archive_status in ('draft', 'ready')),
  unique (id, tenant_id),
  unique (tenant_id, proposal_number),
  foreign key (client_id, tenant_id) references public.clients (id, tenant_id),
  foreign key (client_contact_id, tenant_id) references public.client_contacts (id, tenant_id),
  foreign key (opportunity_id, tenant_id) references public.opportunities (id, tenant_id)
);

comment on table public.proposals is
  'The proposal container — commercial content lives in proposal_versions. Mutated exclusively via create_proposal_direct()/create_proposal_from_opportunity()/mark_proposal_ready()/return_proposal_to_draft()/archive_proposal()/restore_proposal(). status is NEVER settable to sent/viewed/accepted/declined/expired/superseded by any Phase 2A function — those are reserved for the phase that implements sending/acceptance.';

create index proposals_tenant_status_idx on public.proposals (tenant_id, status) where archived_at is null;
create index proposals_client_id_idx on public.proposals (client_id);
create index proposals_updated_at_idx on public.proposals (tenant_id, updated_at desc);

-- At most one non-archived proposal per opportunity in Phase 2A (see
-- docs/adr/0028-proposal-versioning.md and section 21 of the brief — revisions
-- are proposal_versions, not new proposals rows). A new proposal for the same
-- opportunity can only be created after the existing one is archived.
create unique index proposals_one_active_per_opportunity
  on public.proposals (opportunity_id)
  where opportunity_id is not null and archived_at is null;

create trigger trg_proposals_set_updated_at
  before update on public.proposals
  for each row execute function public.set_updated_at();
