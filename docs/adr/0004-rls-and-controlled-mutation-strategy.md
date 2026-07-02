---
status: Accepted
date: 2026-07-01
supersedes: none
---

# ADR 0004 — RLS strategy: read via policies, write via SECURITY DEFINER functions

## Context

Row Level Security in PostgreSQL is deny-by-default once enabled: a table
with RLS on and zero policies denies all access to any role that isn't the
table owner or `BYPASSRLS`. Phase 0 needed a consistent rule for how far to
push RLS policies (letting clients `UPDATE`/`INSERT` directly, gated by a
`USING`/`WITH CHECK` expression) versus routing mutations through a
`SECURITY DEFINER` function.

## Decision

- **Simple, single-table, no-side-effect updates** (renaming a tenant,
  editing your own profile) get a direct RLS `UPDATE` policy gated by
  `user_has_permission()` or `id = auth.uid()`.
- **Mutations with cross-table invariants or an audit requirement**
  (creating a tenant + owner membership atomically, changing a member's role
  or status, inviting a member) have **no** client-facing RLS
  `INSERT`/`UPDATE` policy at all. They are only reachable through a
  `SECURITY DEFINER` RPC function (`create_tenant_with_owner`,
  `update_membership`, `invite_member_by_email`) that re-validates
  authorization from `auth.uid()`, enforces the invariant, and writes the
  audit trail inside the same transaction.
- Every `SECURITY DEFINER` function: sets `search_path` explicitly, derives
  the actor exclusively from `auth.uid()` (never accepts a `user_id`
  parameter as authority), and has `EXECUTE` revoked from `PUBLIC` and
  granted only to `authenticated`.
- `tenant_memberships`, `roles`, `permissions`, `role_permissions` and
  `audit_logs` have **zero** `INSERT`/`UPDATE`/`DELETE` grants for
  `authenticated` — not just missing policies, but missing table-level
  `GRANT`s — making direct client mutation structurally impossible, not
  merely discouraged by policy.

## Consequences

- Two defense-in-depth layers protect the highest-risk invariants (last
  owner, self-modification): an explicit check inside the function AND a
  `BEFORE UPDATE` trigger (`protect_last_owner`,
  `prevent_self_membership_modification`) that fires regardless of the call
  path — including a hypothetical future direct `service_role` script.
- Adding a new mutation always starts with the question "does this need a
  function, or is a policy enough?" — documented here so the answer isn't
  reinvented ad hoc in a later phase.
- `audit_logs` writes performed *inside* another `SECURITY DEFINER`
  function's transaction (e.g. `tenant.created`) are transactionally
  guaranteed: if the audit insert fails, the entire action rolls back. This
  is a deliberately stronger guarantee than "log best-effort" for anything
  classified as a sensitive action.
