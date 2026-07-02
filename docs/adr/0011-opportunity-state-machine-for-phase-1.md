---
status: Accepted
date: 2026-07-02
supersedes: none
---

# ADR 0011 — Opportunity state machine for Phase 1

## Context

The Phase 1 brief proposed a specific opportunity status list and
transition table, with an explicit instruction not to adopt it
uncritically but to evaluate it against what Phase 1 actually needs to
support (no Estimates module yet, no proposals, no payments) and correct
it where it doesn't hold up. Two things about the proposal needed
re-examination: (1) whether `archived` should be reachable as an ordinary
pipeline transition, and (2) whether a `lost` opportunity should be a
true dead end.

## Decision

**Statuses:** `new`, `contacted`, `qualified`, `inspection_scheduled`,
`ready_for_estimate`, `won`, `lost`, `archived`.

**Transition table**, enforced exclusively inside
`change_opportunity_status()` (see
`supabase/migrations/20260702130700_crm_functions_opportunities.sql`):

| From | Allowed to |
|---|---|
| `new` | `contacted`, `lost` |
| `contacted` | `qualified`, `lost` |
| `qualified` | `inspection_scheduled`, `ready_for_estimate`, `lost` |
| `inspection_scheduled` | `qualified`, `ready_for_estimate`, `lost` |
| `ready_for_estimate` | `qualified`, `won`, `lost` |
| `won` | *(none — terminal)* |
| `lost` | `contacted`, `qualified` |
| `archived` | *(none — only reachable via `restore_opportunity()`)* |

Deviations from a naive "linear pipeline" reading of the proposal, and
the reasoning for each:

1. **`archived` is not a target of `change_opportunity_status()` at
   all.** It has its own function, `archive_opportunity()`, gated by its
   own permission (`opportunities.archive`, Owner/Admin only in the seeded
   matrix) — separate from `opportunities.change_status` (available to
   Sales/Estimator). Archiving is an administrative "get this off my
   active list" action with a different authorization bar than ordinary
   pipeline movement, and folding it into the same transition table would
   have hidden that distinction. Only `won` or `lost` opportunities can be
   archived (enforced in the function); the ordinary pipeline never
   auto-archives.
2. **`lost` is not terminal — reactivation is allowed** (`lost →
   contacted`, `lost → qualified`). Real contractor sales cycles have
   leads that go cold and later come back ("call me next spring"). Making
   `lost` a hard dead end would force staff to create a duplicate
   opportunity for the same client/deal, fragmenting history and note
   threads. `lost_reason` is deliberately **preserved, not cleared**, when
   leaving `lost` — reactivating doesn't erase why it was lost before, in
   case it happens again.
3. **`won` has no outgoing transition.** Unlike `lost`, there is no
   product reason to move a won opportunity back into the pipeline;
   "undo" is intentionally scoped to archive/restore, not to reopening a
   deal that's already been converted or is about to be.
4. **`inspection_scheduled` requires `inspection_scheduled_at`, enforced
   twice**: once inside `change_opportunity_status()` and again as a
   table-level CHECK constraint
   (`opportunities_inspection_date_required`) — defense in depth in case
   a future code path ever bypasses the function.
5. **Same-status transitions are a no-op**, not an error
   (`if v_row.status = p_new_status then return v_row`) — the UI can
   always call `change_opportunity_status()` unconditionally without
   first checking the current value.

**Why conversion does not change opportunity status:**
`convert_opportunity_to_project()` deliberately leaves `opportunities.status`
untouched. A `ready_for_estimate` opportunity that gets converted stays
`ready_for_estimate` (not auto-`won`) because conversion and winning are
different events — a contractor may convert to start scoping a project
before the deal is contractually won, or may need to convert a `won`
opportunity (already handled — `won` is also a valid source status for
conversion). Forcing a status change as a side effect of conversion would
conflate two independent facts.

Server enforcement is the sole authority; `src/lib/crm/opportunity-transitions.ts`
is an explicitly-labeled UI-only mirror used solely to decide which
buttons to show — see docs/22-phase-1-state-machines.md.

## Consequences

- Reopening a lost deal doesn't create data-integrity questions (same
  opportunity id, same notes/activity history) but does mean "lost" in a
  report isn't necessarily permanent — anyone building Phase 2 analytics
  on `opportunities.status = 'lost'` should query `crm_activities` for the
  actual win/loss timeline rather than trusting current status alone for
  historical reporting.
- If a future phase needs a genuinely different lost-reactivation
  permission tier, `opportunities.change_status` currently covers both
  forward pipeline movement and lost-reactivation with one permission —
  splitting them would be a backward-compatible permission addition, not
  a breaking change.
