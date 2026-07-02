---
status: Accepted
date: 2026-07-01
supersedes: none
---

# ADR 0005 — Transactional tenant creation

## Context

Creating a tenant is really three writes that must succeed or fail together:
the `tenants` row, the owner's `tenant_memberships` row, and the audit trail
for both. A sequence of separate API calls (create tenant, then create
membership, then assign role) risks leaving an ownerless tenant if any step
fails partway — a state the rest of the system is not designed to handle
(RLS's `tenants_update` policy requires `user_has_permission`, which
requires an active membership; an ownerless tenant would be unmanageable by
anyone, including its creator).

## Decision

All three writes happen inside a single PostgreSQL function,
`create_tenant_with_owner(p_name, p_slug)`, called once via RPC. PL/pgSQL
functions execute within the transaction of the calling statement: if any
step raises (invalid input, duplicate slug, missing seeded owner role), the
entire function's effects — including the `tenants` insert — roll back
automatically. There is no application-level "create tenant, then create
membership" two-step sequence anywhere in the codebase.

## Consequences

- It is not possible, even under a mid-request crash or a concurrent
  duplicate-slug race, to end up with a `tenants` row that has no owner
  membership.
- Retrying a failed `create_tenant_with_owner` call (e.g. after a network
  timeout where the client is unsure if it succeeded) is safe with respect
  to leftover partial state — either the previous call fully committed, or
  it fully rolled back. It is *not* idempotent in the sense of returning the
  same tenant on retry (a second call with the same name/slug after a
  genuine success will hit the unique-slug constraint and surface a clear
  "already taken" error rather than silently creating a duplicate) — that
  is by design, not a Phase-0 gap: business names/slugs must be unique
  regardless of retry semantics.
- The same pattern (one `SECURITY DEFINER` function per multi-write
  invariant) is reused for `update_membership()` — see ADR 0004.
