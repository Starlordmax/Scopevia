-- Phase 2A: Proposal-centric pivot — portfolio (reusable gallery of previous
-- work). Never published externally in Phase 2A; location_label is a free
-- text field the contractor fills with a general area, never validated
-- against a real address — see docs/34-proposal-builder-ux.md.

create table public.portfolio_projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  title text not null check (btrim(title) <> ''),
  service_type text not null check (service_type in (
    'interior_painting', 'exterior_painting', 'bathroom_remodeling',
    'general_remodeling', 'flooring', 'custom'
  )),
  description text not null default '',
  location_label text not null default '',
  completed_at date,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references auth.users (id),
  unique (id, tenant_id)
);

comment on table public.portfolio_projects is
  'A reusable "previous work" showcase item, independent of the CRM projects table. Mutated exclusively via create_portfolio_project()/update_portfolio_project()/archive_portfolio_project()/restore_portfolio_project(). Archiving must not break any proposal_media row that already references it — see docs/25 (Proposal Media) rules.';

create index portfolio_projects_tenant_idx on public.portfolio_projects (tenant_id, service_type) where archived_at is null;

create trigger trg_portfolio_projects_set_updated_at
  before update on public.portfolio_projects
  for each row execute function public.set_updated_at();

-- =============================================================================

create table public.portfolio_project_media (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  portfolio_project_id uuid not null,
  media_asset_id uuid not null,
  caption text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (id, tenant_id),
  unique (portfolio_project_id, media_asset_id),
  foreign key (portfolio_project_id, tenant_id) references public.portfolio_projects (id, tenant_id),
  foreign key (media_asset_id, tenant_id) references public.media_assets (id, tenant_id)
);

comment on table public.portfolio_project_media is
  'Join between a portfolio_project and its media_assets. A given media_asset appears at most once per portfolio_project (unique pair).';

create index portfolio_project_media_project_idx on public.portfolio_project_media (portfolio_project_id, sort_order);
