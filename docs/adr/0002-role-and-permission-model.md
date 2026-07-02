---
status: Accepted
date: 2026-07-01
supersedes: none
---

# ADR 0002 — Role and permission model

## Context

The product spec ([docs/13-roles-and-permissions in 06-security-and-rls.md](../06-security-and-rls.md))
calls for roles that are "packages of permissions," with authorization
decisions always made against a granular permission key rather than a role
name. Phase 0 needed to decide two schema questions before writing a single
migration: (1) does a membership hold one role or many, and (2) are roles
global or per-tenant.

## Decision

1. **One role per membership.** `tenant_memberships.role_id` is a direct,
   required foreign key to `roles` — there is no `membership_roles`
   many-to-many join table, despite one being listed as an option to
   evaluate in the original schema sketch. The six Phase 0 roles
   (owner/admin/estimator/sales/field_worker/viewer) are mutually exclusive
   job functions; no real user needs two simultaneously, and a single-role
   model is simpler to reason about for the last-owner and
   self-modification protections (see ADR 0005).
2. **Roles are global system rows in Phase 0.** `roles.is_system = true`
   rows have `tenant_id = null` and are seeded once for all tenants
   (`supabase/migrations/20260701120900_seed_roles_and_permissions.sql`).
   The schema already supports per-tenant custom roles
   (`is_system = false`, `tenant_id` required) as a future extension — no
   migration will be needed to add that capability, only new rows and UI.
3. **Authorization always checks a permission key**, never a role name.
   `user_has_permission(tenant_id, permission_key)` is the only function the
   application and RLS policies call to make an authorization decision.

## Consequences

- Introducing a 7th fixed role, or a tenant-specific custom role, requires
  zero schema changes — only new `roles`/`role_permissions` rows.
- If a future phase discovers a genuine need for a user to hold multiple
  simultaneous roles in one tenant, that is a breaking schema change
  (introducing a join table and migrating `tenant_memberships.role_id` data
  into it) — flagged here explicitly so it isn't done casually.
- The Phase 0 permission matrix intentionally grants `estimator`, `sales`,
  `field_worker` and `viewer` only `tenant.view`: their real permissions
  (CRM, estimating, proposals) don't exist as modules yet, and granting
  speculative permissions for modules that don't exist would be
  unverifiable and misleading. See
  [docs/14-phase-0-foundations.md](../14-phase-0-foundations.md) for the
  full matrix and rationale for each corrected cell.
