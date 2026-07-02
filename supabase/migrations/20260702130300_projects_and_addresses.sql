-- Phase 1: CRM & Projects — projects & project_addresses
--
-- State list is a deliberate simplification (see docs/adr/0012-project-state-machine-for-phase-1.md):
-- draft, inspection_pending, inspection_completed, ready_for_estimate, cancelled, archived.
-- `active`/`on_hold`/`completed` from the original prompt sketch are deferred — without
-- Estimates or execution tracking, a project cannot meaningfully be "in progress" or
-- "completed" yet; introducing those states now would represent capability that
-- doesn't exist, per the prompt's own guidance to simplify when ambiguous.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  client_id uuid not null,
  opportunity_id uuid,
  primary_contact_id uuid,
  name text not null check (btrim(name) <> ''),
  service_type text,
  description text,
  status text not null default 'draft' check (
    status in ('draft', 'inspection_pending', 'inspection_completed', 'ready_for_estimate', 'cancelled', 'archived')
  ),
  pre_archive_status text check (
    pre_archive_status in ('draft', 'inspection_pending', 'inspection_completed', 'ready_for_estimate', 'cancelled')
  ),
  assigned_to uuid,
  inspection_scheduled_at timestamptz,
  tentative_start_date date,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references auth.users (id),
  unique (id, tenant_id),
  foreign key (client_id, tenant_id) references public.clients (id, tenant_id),
  foreign key (opportunity_id, tenant_id) references public.opportunities (id, tenant_id),
  foreign key (primary_contact_id, tenant_id) references public.client_contacts (id, tenant_id),
  foreign key (assigned_to, tenant_id) references public.tenant_memberships (id, tenant_id),
  constraint projects_inspection_date_required check (status <> 'inspection_pending' or inspection_scheduled_at is not null)
);

comment on table public.projects is
  'The work a contractor may eventually build an estimate for. Mutated exclusively via create_project()/update_project()/change_project_status()/archive_project()/restore_project(), or created atomically from an opportunity via convert_opportunity_to_project(). A project is never automatically marked as anything beyond draft on creation — see docs/20-phase-1-crm-and-projects.md.';

-- At most one project per opportunity — this is the declarative backbone of
-- convert_opportunity_to_project()'s idempotency: a second conversion attempt
-- hits this constraint and the function returns the existing project instead
-- of erroring or creating a duplicate. See 20260702130800_crm_functions_projects.sql.
create unique index projects_opportunity_id_key on public.projects (opportunity_id) where opportunity_id is not null;

create index projects_tenant_status_idx on public.projects (tenant_id, status) where archived_at is null;
create index projects_client_id_idx on public.projects (client_id);
create index projects_assigned_to_idx on public.projects (assigned_to) where assigned_to is not null;
create index projects_name_trgm_idx on public.projects using gin (name extensions.gin_trgm_ops);

create trigger trg_projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- =============================================================================

create table public.project_addresses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  project_id uuid not null,
  address_line_1 text not null check (btrim(address_line_1) <> ''),
  address_line_2 text,
  city text not null check (btrim(city) <> ''),
  state text not null check (char_length(btrim(state)) between 2 and 40),
  postal_code text not null check (postal_code ~ '^[A-Za-z0-9 -]{3,12}$'),
  country_code text not null default 'US' check (char_length(country_code) = 2),
  -- Never populated by guesswork: null unless a genuinely trustworthy source
  -- (a future geocoding integration) provides them. No mock/estimated coordinates.
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  access_instructions text,
  is_primary boolean not null default false,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references auth.users (id),
  unique (id, tenant_id),
  foreign key (project_id, tenant_id) references public.projects (id, tenant_id)
);

comment on table public.project_addresses is
  'A physical work site for a project, which may differ from the client''s own address. Mutated exclusively via create_project_address()/update_project_address()/set_primary_project_address()/archive_project_address()/restore_project_address(). No geocoding/maps in Phase 1 — latitude/longitude stay null.';

create unique index project_addresses_one_primary_per_project
  on public.project_addresses (project_id)
  where is_primary = true and archived_at is null;

create index project_addresses_project_id_idx on public.project_addresses (project_id) where archived_at is null;
create index project_addresses_city_idx on public.project_addresses (tenant_id, lower(city));
create index project_addresses_postal_code_idx on public.project_addresses (tenant_id, postal_code);

create trigger trg_project_addresses_set_updated_at
  before update on public.project_addresses
  for each row execute function public.set_updated_at();
