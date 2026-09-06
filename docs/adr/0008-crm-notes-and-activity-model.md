---
status: Accepted
date: 2026-07-02
supersedes: none
---

# ADR 0008 — CRM notes and activity model

## Context

Phase 1 needs two conceptually different things that both attach to "a
client, or an opportunity, or a project": human-authored **notes**, and a
system-generated business **activity timeline**. Both need to remain
distinct from the security-focused `audit_logs` table introduced in
Phase 0. Three schema shapes were on the table:

1. Per-entity tables (`client_notes`, `opportunity_notes`,
   `project_notes`, and the same three for activities) — real integrity,
   but 6 near-identical tables, 6 sets of RLS policies, 6 sets of CRUD
   functions for what is behaviorally one concept.
2. A generic polymorphic pair (`entity_type text`, `entity_id uuid`) — the
   pattern the Phase 1 brief explicitly warns against, because Postgres
   cannot declare a foreign key that means "references whichever table
   `entity_type` names." This gives **zero** enforced referential
   integrity: a typo'd `entity_type` or a deleted parent row silently
   orphans the note with no database-level way to catch it.
3. One shared table per concept (`crm_notes`, `crm_activities`), each with
   three nullable, individually-composite-FK'd columns (`client_id`,
   `opportunity_id`, `project_id`) — an "exclusive arc."

## Decision

Option 3. `crm_notes` and `crm_activities` each have `client_id`,
`opportunity_id`, and `project_id` as nullable columns, each with its own
composite foreign key (`(client_id, tenant_id) references clients (id,
tenant_id)`, etc. — see ADR 0007). Postgres's default `MATCH SIMPLE` FK
semantics mean a foreign key is only checked when its referencing column
is non-null, so a note with `client_id` set and the other two null gets
full, real referential integrity on the one relationship that actually
exists, with no custom trigger code required.

`crm_notes` additionally has `crm_notes_exactly_one_parent` (exactly one
of the three must be set — a note always belongs to precisely one
thing). `crm_activities` has `crm_activities_at_least_one_parent`
(loosened to "at least one," anticipating that a future activity type
might reasonably tag both an opportunity and the project it produced,
though no Phase 1 activity type does this yet).

`crm_notes` is human-authored and mutable (`update_note()`,
`archive_note()`). `crm_activities` is system-generated only — every row
is inserted internally by `log_crm_activity()`, called from inside the
various mutation functions, never directly by a client — and is
append-only, enforced the same way `audit_logs` is in Phase 0
(`prevent_crm_activity_mutation()` trigger blocking UPDATE/DELETE
unconditionally, even for `service_role`).

**Kept explicitly separate from `audit_logs`:** `audit_logs` is the
Phase 0 security/compliance trail (who did what, for access-review and
incident-response purposes). `crm_activities` is a product-facing
business timeline ("Opportunity won," "Inspection scheduled") meant to be
displayed in the UI. Every Phase 1 mutation function that matters to a
user calls **both** `log_audit_event()` and `log_crm_activity()` as two
independent inserts — see `tests/rls/phase1-crm.test.ts`, "creating a
note produces rows in crm_notes, crm_activities, AND audit_logs," which
confirms all three tables are populated independently.

## Consequences

- No fourth or fifth notes/activities table is needed if a future phase
  adds a new attachable entity — add one more nullable column + composite
  FK to the existing two tables.
- The exclusive-arc CHECK constraints must be kept in sync by hand if a
  new parent column is ever added (e.g. if Phase 2 adds an `estimate_id`
  column, both the arc CHECK and every RLS policy referencing "which
  parent" logic must be updated together).
- `crm_notes` has no `restore_note()` / `notes.restore` permission — see
  ADR 0010 for why archiving a note is treated as a lighter-weight action
  than archiving a client/opportunity/project.
