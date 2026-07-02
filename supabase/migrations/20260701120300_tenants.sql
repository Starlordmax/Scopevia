-- Phase 0: Foundations
-- `tenants` is the root of multi-tenant isolation. Every business-owned table
-- from Phase 1 onward will carry a tenant_id referencing this table.

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  -- Nullable + ON DELETE SET NULL: a tenant must survive its creator's
  -- account being deleted later (e.g. an account-deletion request from a
  -- founder who has since left the business) — it must never cascade into
  -- deleting the business record itself.
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.tenants is
  'A contractor business (the commercial entity). Root of tenant isolation. Rows are only ever inserted via create_tenant_with_owner() — never directly by client code.';
comment on column public.tenants.slug is
  'URL-safe identifier, unique across all tenants. Immutable in Phase 0 (no rename-slug flow yet).';
comment on column public.tenants.deleted_at is
  'Hard account closure (distinct from status=archived, which is a reversible business decision). Never physically deleted.';

create trigger trg_tenants_set_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();
