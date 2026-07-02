-- Phase 0: Foundations
-- Roles are packages of permissions. Authorization decisions are always made
-- against a *permission key*, never against a role name — this lets Phase 1+
-- introduce per-tenant custom roles without touching any authorization check.
--
-- Design decision (see docs/adr/0002-role-and-permission-model.md):
-- a tenant_membership has EXACTLY ONE role (not many). The MVP's roles
-- (owner/admin/estimator/sales/field_worker/viewer) are mutually exclusive
-- job functions — nobody needs to hold two simultaneously — so a direct
-- `tenant_memberships.role_id` foreign key is used instead of a
-- `membership_roles` many-to-many join table. This is a deliberate
-- simplification of the originally proposed schema.

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  name text not null,
  description text,
  is_system boolean not null default false,
  tenant_id uuid references public.tenants (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- System roles are global (no tenant); custom roles (future work) always
  -- belong to exactly one tenant. Never both, never neither.
  constraint roles_system_or_tenant_scoped check (
    (is_system = true and tenant_id is null) or
    (is_system = false and tenant_id is not null)
  )
);

comment on table public.roles is
  'Catalog of roles. Phase 0 ships 6 fixed system roles (is_system=true, tenant_id NULL), seeded in a later migration. Per-tenant custom roles are a schema-supported future extension, not implemented in Phase 0.';

create unique index roles_system_key_key on public.roles (key) where is_system = true;
create unique index roles_tenant_key_key on public.roles (tenant_id, key) where is_system = false;

create trigger trg_roles_set_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

comment on table public.permissions is
  'Catalog of granular permission keys (e.g. members.invite). Authorization checks always reference permissions.key, never a role name directly.';

create table public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

comment on table public.role_permissions is
  'Grants a permission to a role. The full authorization matrix for Phase 0 is seeded in 20260701120900_seed_roles_and_permissions.sql.';
