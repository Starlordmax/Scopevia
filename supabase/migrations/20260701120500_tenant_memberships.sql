-- Phase 0: Foundations
-- N:M relationship between users and tenants, with exactly one role each.
-- Rows are never deleted — membership lifecycle is modeled with `status`
-- (invited/active/suspended/removed) so history and audit trails survive
-- an "offboarding".

create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role_id uuid not null references public.roles (id),
  status text not null default 'invited' check (status in ('invited', 'active', 'suspended', 'removed')),
  -- ON DELETE SET NULL: losing the inviter's account must not delete the
  -- membership it created, nor block deleting that inviter's account.
  invited_by uuid references auth.users (id) on delete set null,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One membership row per (tenant, user) for the lifetime of the relationship;
  -- re-inviting a removed member updates this same row rather than inserting a new one.
  unique (tenant_id, user_id)
);

comment on table public.tenant_memberships is
  'A user''s single role within a tenant. Mutated only via create_tenant_with_owner(), invite_member_by_email() and update_membership() — never by a direct client INSERT/UPDATE (see RLS policies migration).';

create index tenant_memberships_user_id_idx on public.tenant_memberships (user_id);
create index tenant_memberships_tenant_id_status_idx on public.tenant_memberships (tenant_id, status);

create trigger trg_tenant_memberships_set_updated_at
  before update on public.tenant_memberships
  for each row execute function public.set_updated_at();
