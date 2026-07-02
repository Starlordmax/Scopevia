-- Phase 0: Foundations
-- Row Level Security: deny-by-default on every table. Enabling RLS with zero
-- policies already denies all access to non-owner roles; every statement
-- below is an explicit, minimal exception to that default.
--
-- Every policy is scoped `to authenticated` explicitly — `anon` must never
-- match a policy here, regardless of its USING clause (CREATE POLICY without
-- `TO <role>` defaults to PUBLIC, which would otherwise include anon).
--
-- Mutations (INSERT/UPDATE/DELETE) on tenants, tenant_memberships, roles,
-- permissions, role_permissions and audit_logs are handled EXCLUSIVELY by the
-- SECURITY DEFINER functions in the previous migration, which run as the
-- table owner and therefore bypass RLS for their own writes. Consequently
-- there are deliberately NO insert/update/delete policies for `authenticated`
-- on those tables below — direct client mutation is impossible by design,
-- not merely discouraged.

-- =============================================================================
-- profiles
-- =============================================================================

alter table public.profiles enable row level security;

create policy profiles_select on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.tenant_memberships mine
      join public.tenant_memberships theirs
        on theirs.tenant_id = mine.tenant_id
      where mine.user_id = auth.uid()
        and mine.status = 'active'
        and theirs.user_id = profiles.id
        and theirs.status = 'active'
    )
  );

create policy profiles_update_self on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

grant select, update (full_name, avatar_url, locale, timezone) on public.profiles to authenticated;

-- =============================================================================
-- tenants
-- =============================================================================

alter table public.tenants enable row level security;

create policy tenants_select on public.tenants
  for select
  to authenticated
  using (public.user_is_active_tenant_member(id));

create policy tenants_update on public.tenants
  for update
  to authenticated
  using (public.user_has_permission(id, 'tenant.update'))
  with check (public.user_has_permission(id, 'tenant.update'));

grant select, update (name, status) on public.tenants to authenticated;
-- No insert/delete grant: tenants are only created via create_tenant_with_owner().

-- =============================================================================
-- tenant_memberships
-- =============================================================================

alter table public.tenant_memberships enable row level security;

create policy tenant_memberships_select on public.tenant_memberships
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or (
      public.user_is_active_tenant_member(tenant_id)
      and public.user_has_permission(tenant_id, 'members.view')
    )
  );

grant select on public.tenant_memberships to authenticated;
-- No insert/update/delete grant: all mutations go through create_tenant_with_owner(),
-- invite_member_by_email() and update_membership().

-- =============================================================================
-- roles
-- =============================================================================

alter table public.roles enable row level security;

create policy roles_select on public.roles
  for select
  to authenticated
  using (
    is_system = true
    or (tenant_id is not null and public.user_has_permission(tenant_id, 'roles.view'))
  );

grant select on public.roles to authenticated;
-- No insert/update/delete grant in Phase 0: custom per-tenant roles are a
-- future extension; system roles are immutable seed data.

-- =============================================================================
-- permissions / role_permissions (reference catalogs)
-- =============================================================================

alter table public.permissions enable row level security;

create policy permissions_select on public.permissions
  for select
  to authenticated
  using (true);

grant select on public.permissions to authenticated;

alter table public.role_permissions enable row level security;

create policy role_permissions_select on public.role_permissions
  for select
  to authenticated
  using (true);

grant select on public.role_permissions to authenticated;

-- =============================================================================
-- audit_logs
-- =============================================================================

alter table public.audit_logs enable row level security;

create policy audit_logs_select on public.audit_logs
  for select
  to authenticated
  using (
    (tenant_id is not null and public.user_has_permission(tenant_id, 'audit.view'))
    or actor_user_id = auth.uid()
  );

grant select on public.audit_logs to authenticated;
-- No insert/update/delete grant: writes go exclusively through log_audit_event(),
-- and UPDATE/DELETE are additionally blocked by trg_audit_logs_no_update/no_delete
-- even for roles that could otherwise bypass RLS.
