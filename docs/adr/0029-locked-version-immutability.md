---
status: Accepted
date: 2026-07-06
supersedes: none
---

# ADR 0029 — Locked proposal version immutability

## Context

Once a version is `locked` (in a future phase: because it was sent),
neither its own commercial fields nor any of its child rows (sections,
labor items, line items, media) may change, even for a caller with a
valid mutation function and correct permissions — the same "second
barrier" discipline already used for `crm_activities` append-only
enforcement in Phase 1.

## Decision

Two triggers, defined in
`supabase/migrations/20260706140300_proposal_versions.sql`:

1. `prevent_locked_proposal_version_mutation()` on `proposal_versions`
   itself — once `version_status = 'locked'`, rejects any `UPDATE` that
   changes a commercial field, but explicitly **allows** `version_status`
   to move to `superseded` (the one sanctioned transition when a new
   version is created).
2. `prevent_locked_version_child_mutation()` — a single generic trigger
   function, reused as a `BEFORE INSERT OR UPDATE OR DELETE` trigger on
   `proposal_sections`, `proposal_labor_items`, `proposal_line_items`,
   and `proposal_media`. It looks up the parent version's
   `version_status` and raises if it's `locked`, for any of insert,
   update, or delete.

Every mutation function (e.g. `add_proposal_labor_item()`) additionally
checks `version_status = 'draft'` itself and raises a friendly error
*before* the trigger would ever fire — the trigger is defense in depth,
not the primary UX, and is the layer that also protects against a direct
`service_role` write bypassing the functions entirely.

## Consequences

- Verified directly: `tests/rls/phase2a-proposals.test.ts`, "Locked
  version immutability" forces a version to `locked` via `service_role`,
  then confirms (a) the ordinary update function is rejected, (b) a raw
  `service_role` `UPDATE` on a child row is rejected by the trigger, (c)
  a raw `service_role` `UPDATE` on the version's own commercial fields is
  rejected, and (d) the one sanctioned `locked → superseded` transition
  succeeds.
- The generic child trigger function means adding a new locked-version
  child table in the future (if the model grows) only needs one
  `CREATE TRIGGER` line, not new trigger logic.
