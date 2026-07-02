---
status: Accepted
date: 2026-07-02
supersedes: none
---

# ADR 0007 — Cross-tenant integrity via composite foreign keys

## Context

Phase 1 introduces a chain of tenant-scoped relationships (`clients` →
`client_contacts` → `opportunities` → `projects` → `project_addresses`,
plus `crm_notes`/`crm_activities` referencing several of these). RLS alone
proves that a *query* can't cross tenants, but it does nothing to stop a
row from being *written* with a `tenant_id` that doesn't match its
parent's `tenant_id` — e.g. an `opportunities` row whose `client_id`
points at a client belonging to a different tenant. The Phase 1 brief
explicitly calls this out: don't rely solely on RLS/trigger logic for
this, use declarative integrity where Postgres can enforce it directly.

## Decision

Every parent table gets a `unique (id, tenant_id)` constraint in addition
to its primary key. Every child table's foreign key to that parent is a
**composite** foreign key over both columns:

```sql
foreign key (client_id, tenant_id) references public.clients (id, tenant_id)
```

This makes it structurally impossible to insert a child row whose
`tenant_id` disagrees with its parent's `tenant_id` — Postgres rejects it
with a `23503 foreign_key_violation` before any RLS policy or
`SECURITY DEFINER` function logic even runs. Applied to: `client_contacts`
→ `clients`; `opportunities` → `clients`, `tenant_memberships` (assignee);
`projects` → `clients`, `opportunities`, `client_contacts` (primary
contact), `tenant_memberships` (assignee); `project_addresses` →
`projects`; `crm_notes`/`crm_activities` → `clients`, `opportunities`,
`projects` (see ADR 0008 for why these three are each nullable).

Application code still performs a same-tenant existence check before
calling a mutation function (e.g. `create_opportunity` does
`select * from clients where id = p_client_id and tenant_id = p_tenant_id`)
so that a cross-tenant reference fails with a clear, catchable
`P0002`/"not found in this tenant" application error. The composite FK is
the **second, independent** layer — proven in
`tests/rls/phase1-crm.test.ts` by attempting the cross-tenant insert
directly as `service_role`, bypassing the function entirely, and
confirming Postgres itself rejects it with `23503`.

## Consequences

- Adding a new tenant-scoped table requires remembering to add both the
  `unique (id, tenant_id)` on the parent and the composite FK on the
  child — not automatic, must be part of the review checklist for any
  future table (see docs/23-phase-1-rls-verification.md).
- Composite FKs use `MATCH SIMPLE` (Postgres's default): if **any** column
  in the FK is `NULL`, the constraint is not checked at all for that row.
  This is exploited intentionally for `crm_notes`/`crm_activities`, whose
  `client_id`/`opportunity_id`/`project_id` are each nullable — see ADR
  0008.
- Slightly more verbose DDL and slightly wider indexes (`(id, tenant_id)`
  instead of just `(id)`), a small, worthwhile cost for integrity that
  holds even against a direct `service_role` write or a bug in RLS policy
  logic.
