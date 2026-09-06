---
status: Accepted
date: 2026-07-02
supersedes: none
---

# ADR 0009 — Assignee reference strategy

## Context

`opportunities.assigned_to` and `projects.assigned_to` need to point at
"the team member responsible for this." Two candidates: reference
`auth.users(id)` directly (the person), or reference
`tenant_memberships(id)` (the person's membership *in this specific
tenant*). The choice affects both cross-tenant integrity (ADR 0007) and
what happens when someone's relationship with the tenant changes.

## Decision

`assigned_to` references `tenant_memberships`, via the composite FK
`(assigned_to, tenant_id) references tenant_memberships (id, tenant_id)`
— not `auth.users`. Reasons:

1. **Composite cross-tenant integrity requires it.** `auth.users` has no
   `tenant_id` column (a user isn't scoped to one tenant), so a composite
   FK against it is not possible. Referencing `tenant_memberships`
   instead lets the same declarative-integrity pattern from ADR 0007
   apply here too: assigning someone from another tenant is rejected by
   Postgres itself, not just an application check (though
   `create_opportunity`/`create_project`/`update_*` also validate via
   `is_active_member_of_tenant()` for a clean error message first).
2. **Membership rows are never deleted**, only status-transitioned
   (`active` → `suspended`/`removed`, per Phase 0's `update_membership`).
   So `assigned_to` never dangles when someone is suspended or removed —
   the FK target still exists, and the UI/permission layer independently
   decides whether to still show that assignment prominently, offer to
   reassign, or gray it out. No `ON DELETE` behavior needed at all.

## Consequences

- The assignee dropdown (`getAssignableMembers()`) must resolve a
  membership id to a display name via a join, not just show `auth.users`
  directly — already how Phase 0 lists members, so no new pattern.
- If a suspended/removed member remains assigned to an opportunity or
  project, the record keeps pointing at a real (but now-inactive)
  membership row rather than silently losing the assignment or erroring.
  Phase 1 does not add UI to warn about this or force reassignment —
  documented as a known gap, not a bug, in
  docs/20-phase-1-crm-and-projects.md.
- Querying "opportunities assigned to user X across their tenants" is not
  a single join (membership ids differ per tenant) — not a Phase 1
  requirement, and not expected to be one, since assignment is inherently
  tenant-scoped.
