---
status: Accepted
date: 2026-07-02
supersedes: none
---

# ADR 0012 — Project state machine for Phase 1

## Context

The Phase 1 brief's original schema sketch (carried over from
docs/05-data-model.md's pre-implementation design) included project
statuses like `active`, `on_hold`, and `completed`. Phase 1 has no
Estimates module and no execution/scheduling tracking, so a project
cannot yet meaningfully be "in progress" (in progress doing *what* — there
is nothing to execute against) or "completed" (completed *how* — no
deliverable exists to mark done). Introducing those states now would
represent a capability the product doesn't have, which the Phase 1 brief
itself warns against ("no construyas funciones futuras 'por si acaso'").

## Decision

**Statuses:** `draft`, `inspection_pending`, `inspection_completed`,
`ready_for_estimate`, `cancelled`, `archived`. `active`/`on_hold`/
`completed` are deferred to whichever future phase actually adds
execution tracking.

**Transition table**, enforced inside `change_project_status()`:

| From | Allowed to |
|---|---|
| `draft` | `inspection_pending`, `cancelled` |
| `inspection_pending` | `inspection_completed`, `cancelled` |
| `inspection_completed` | `ready_for_estimate`, `inspection_pending`, `cancelled` |
| `ready_for_estimate` | `inspection_completed`, `cancelled` |
| `cancelled` | `draft` |
| `archived` | *(none — only reachable via `restore_project()`)* |

Notable decisions:

1. **A project starts in `draft` unconditionally**, whether created
   directly (`create_project()`) or via `convert_opportunity_to_project()`
   — never auto-promoted to a later status just because the source
   opportunity was further along. The two creation paths converge on the
   exact same starting state.
2. **`cancelled` is reversible** (`cancelled → draft`), mirroring the
   opportunity model's `lost → contacted/qualified` reactivation (ADR
   0011) — a cancelled project (customer paused, then came back a month
   later) doesn't need to be recreated from scratch.
3. **`inspection_completed → inspection_pending` is allowed** (a step
   back), covering "we need a second look" without forcing a full
   restart through `draft`.
4. **`archived` is its own function** (`archive_project()`), gated by
   `projects.archive`, separate from `projects.update` (which gates
   `change_project_status()`) — same administrative-tier reasoning as
   opportunities (ADR 0011). Only `cancelled` or `ready_for_estimate`
   projects can be archived.
5. **`inspection_pending` requires `inspection_scheduled_at`**, enforced
   both inside the function and via the table-level CHECK
   `projects_inspection_date_required` — the same double-enforcement
   pattern as the equivalent opportunity constraint.

Server enforcement is the sole authority; `src/lib/crm/project-transitions.ts`
is a UI-only mirror — see docs/22-phase-1-state-machines.md.

## Consequences

- `ready_for_estimate` is the practical Phase 1 "finish line" for a
  project — nothing later exists yet because Estimates (Phase 2+) is what
  would consume a project in this state. Any future "Estimates" phase
  should treat `ready_for_estimate` as its entry point rather than adding
  new project statuses to represent "estimate in progress."
- Reintroducing `active`/`on_hold`/`completed` later is an additive
  `CHECK` constraint change plus new transition rows — not a breaking
  schema change, since `status` is already a free-form `text` column with
  a `CHECK`, not a Postgres `enum` type (enums require more invasive
  migrations to extend safely).
