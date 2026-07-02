-- Phase 1: CRM & Projects — clients & client_contacts
--
-- Design decisions (see docs/20-phase-1-crm-and-projects.md and
-- docs/adr/0007-cross-tenant-integrity-via-composite-foreign-keys.md):
--
-- * No `status` column on clients. The commercial lifecycle (prospect →
--   qualified → won/lost) is modeled entirely by `opportunities.status` —
--   adding a redundant client-level status would create two sources of
--   truth for "is this a live prospect." A client is simply active
--   (archived_at is null) or archived (archived_at is not null).
-- * No `billing_address` jsonb blob (the original pre-implementation design
--   sketch in docs/05-data-model.md had one). JSONB is not used as a
--   substitute for a real relation here — a client's billing address, if it
--   ever needs to be more than a couple of text fields, gets its own
--   properly-columned table in a later phase. Phase 1 doesn't need it at
--   all (only `project_addresses` — a physical work site — is in scope).
-- * Cross-tenant integrity via composite UNIQUE + composite FK (declarative,
--   enforced by Postgres itself — not a trigger, not RLS alone). See the ADR
--   for the full rationale.

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  client_type text not null check (client_type in ('individual', 'business')),
  display_name text not null check (btrim(display_name) <> ''),
  legal_name text,
  first_name text,
  last_name text,
  email text,
  phone text,
  secondary_phone text,
  website text,
  tax_exempt boolean not null default false,
  preferred_contact_method text check (preferred_contact_method in ('email', 'phone', 'text')),
  source text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references auth.users (id),
  unique (id, tenant_id)
);

comment on table public.clients is
  'A contractor''s customer (person or business) — not to be confused with `tenants` (the contractor itself). Mutated exclusively via create_client()/update_client()/archive_client()/restore_client() — see 20260702130600_crm_functions_clients_contacts.sql. No status column: the commercial lifecycle lives in opportunities.status.';

create index clients_tenant_id_active_idx on public.clients (tenant_id) where archived_at is null;
create index clients_display_name_trgm_idx on public.clients using gin (display_name extensions.gin_trgm_ops);
create index clients_email_idx on public.clients (tenant_id, lower(email)) where email is not null;
create index clients_phone_idx on public.clients (tenant_id, phone) where phone is not null;

create trigger trg_clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- =============================================================================

create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  client_id uuid not null,
  first_name text not null check (btrim(first_name) <> ''),
  last_name text,
  job_title text,
  email text,
  phone text,
  preferred_contact_method text check (preferred_contact_method in ('email', 'phone', 'text')),
  is_primary boolean not null default false,
  notes text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references auth.users (id),
  unique (id, tenant_id),
  foreign key (client_id, tenant_id) references public.clients (id, tenant_id)
);

comment on table public.client_contacts is
  'Contacts for a client (a business client may have several; an individual client typically has zero — their own name/email/phone on `clients` suffice). Mutated exclusively via create_client_contact()/update_client_contact()/set_primary_contact()/archive_client_contact()/restore_client_contact().';

-- Declarative, concurrency-safe "at most one active primary contact per
-- client" — a partial unique index, not just application logic. A second
-- concurrent attempt to mark a different contact primary for the same
-- client fails at the database level with a unique violation, which
-- set_primary_contact() below turns into a clean, expected error.
create unique index client_contacts_one_primary_per_client
  on public.client_contacts (client_id)
  where is_primary = true and archived_at is null;

create index client_contacts_client_id_idx on public.client_contacts (client_id) where archived_at is null;

create trigger trg_client_contacts_set_updated_at
  before update on public.client_contacts
  for each row execute function public.set_updated_at();
