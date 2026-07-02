---
status: Accepted
date: 2026-07-02
supersedes: none
---

# ADR 0010 — Archive and restore strategy

## Context

Every Phase 1 entity except `crm_activities` (append-only by design, ADR
0008) needs a soft-delete-like "archive" concept — contractors don't want
to permanently lose a lost opportunity or an old client, but also don't
want it cluttering active lists. `clients`, `client_contacts`, and
`project_addresses` need only a binary archived/active state. `opportunities`
and `projects` are more subtle: they already have a multi-value `status`
column (see ADR 0011/0012), and archiving one of them needs to remember
*which* status it was archived from, so restoring is meaningful.

## Decision

Two variants of the same pattern, chosen per entity:

1. **Simple entities** (`clients`, `client_contacts`, `project_addresses`,
   `crm_notes`): a nullable `archived_at timestamptz` +
   `archived_by uuid references auth.users(id)`. Active = `archived_at is
   null`. No separate status column, no state machine. `restore_*()`
   simply nulls both columns back out. `crm_notes` has no `restore_note()`
   / `notes.restore` permission at all — archiving a note is a
   low-stakes, frequent action (hide clutter) and Phase 1 doesn't seed a
   restore permission for it; if that turns out to be wrong, adding
   `notes.restore` + `restore_note()` later is a pure additive change with
   no migration of existing data.
2. **State-machine entities** (`opportunities`, `projects`): archiving is
   itself a `status` transition, but a special one — `status` becomes
   `'archived'` while `pre_archive_status` (nullable, CHECK-constrained to
   the specific statuses that can be archived) remembers what it was
   before. `restore_*()` reads `pre_archive_status` back into `status` and
   clears both `pre_archive_status` and `archived_at`/`archived_by`.
   Archiving is deliberately kept **out of** the ordinary
   `change_opportunity_status()`/`change_project_status()` transition
   table and given its own function + its own permission
   (`opportunities.archive`/`projects.archive`, distinct from
   `opportunities.change_status`/`projects.update`) — see ADR 0011/0012
   for why archive/restore is a different authorization tier than normal
   pipeline movement.

Both variants share the same idempotency discipline: calling
`archive_*()` on an already-archived row, or `restore_*()` on a
not-archived row, is a no-op that returns the current row rather than
erroring — consistent with how Phase 0's `accept_invitation()`-adjacent
functions handle "already in the target state."

## Consequences

- `pre_archive_status` only exists on the two state-machine tables; simple
  entities don't need it since there's only one prior state (active) to
  return to.
- A future entity needs to pick a lane up front: if it will ever need a
  true multi-value lifecycle status, use the `status` +
  `pre_archive_status` variant from day one rather than bolting on
  `pre_archive_status` after the fact.
- `clients` deliberately has **no** `status` column at all (see the
  `20260702130100_clients_and_contacts.sql` migration header) —
  archived/active is its entire lifecycle, everything richer lives on
  `opportunities.status`.
