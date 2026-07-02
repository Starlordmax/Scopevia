# 22 — Phase 1 State Machines

Both state machines below are enforced **exclusively** inside their
`SECURITY DEFINER` SQL function (`change_opportunity_status()` /
`change_project_status()`), as an explicit `values(...)` transition
table checked with `exists(select 1 from (values ...) as t(from_status,
to_status) where ...)`. The client never decides whether a transition is
legal — it can only ask the server to attempt one and handle success or
rejection.

`src/lib/crm/opportunity-transitions.ts` and
`src/lib/crm/project-transitions.ts` each export a `Record<Status,
Status[]>` map that mirrors the SQL table. These exist **only** to decide
which buttons the UI shows (e.g. don't offer a "Mark Won" button on a
`new` opportunity) — they are documented in-file as "UI-only mirrors, not
the authority," and `tests/unit/crm-validation.test.ts` guards against
them silently drifting from the actual status list (every status has an
entry, every listed target is itself a valid status). If the SQL table
and the TypeScript mirror ever disagree, the SQL table wins — the UI
would just show a button that fails server-side with a clear error.

## Opportunity pipeline

```text
new ──────────► contacted ──────────► qualified ─────┬──► inspection_scheduled
  │                  │                     │          │         │
  │                  │                     │          │         ▼
  │                  │                     └──► ready_for_estimate ◄──┘
  │                  │                                  │
  ▼                  ▼                                  ▼
lost ◄───────────────┴──────────────────────────────────┘
  │  ▲
  └──┘ (lost → contacted / lost → qualified: reactivation)

won ◄── ready_for_estimate           (terminal — no outgoing transition)

archived ◄── (via archive_opportunity() only, from won/lost)
archived ──► (via restore_opportunity() only, back to pre_archive_status)
```

| From | Allowed to |
|---|---|
| `new` | `contacted`, `lost` |
| `contacted` | `qualified`, `lost` |
| `qualified` | `inspection_scheduled`, `ready_for_estimate`, `lost` |
| `inspection_scheduled` | `qualified`, `ready_for_estimate`, `lost` |
| `ready_for_estimate` | `qualified`, `won`, `lost` |
| `won` | — |
| `lost` | `contacted`, `qualified` |
| `archived` | — |

Guards enforced inside `change_opportunity_status()`, on top of the
transition table:

- `p_new_status = 'lost'` requires a non-blank `p_lost_reason` (also a
  table-level CHECK, `opportunities_lost_reason_required`).
- `p_new_status = 'inspection_scheduled'` requires
  `p_inspection_scheduled_at` (also a table-level CHECK,
  `opportunities_inspection_date_required`).
- Same-status "transitions" are a no-op (return the row unchanged), not
  an error.
- `lost_reason` is **preserved**, not cleared, when leaving `lost` via
  reactivation — see "why `lost` is reactivable" below.

**Why `lost` is reactivable, not terminal:** real contractor sales
cycles have leads that go cold and later come back. Making `lost` a hard
dead end would force staff to create a duplicate opportunity for the
same deal, fragmenting notes/activity history. See ADR 0011 for the full
evaluation against the brief's originally proposed table.

**Why `archived` is not an ordinary transition target:** archiving
requires `opportunities.archive`, a separate, more restrictive
permission than `opportunities.change_status` (Owner/Admin only vs.
Sales/Estimator too, per the docs/20 matrix) — it's an administrative
action with a different authorization tier, not another pipeline step.
Only `won` or `lost` opportunities can be archived.

**Why conversion does not change opportunity status:**
`convert_opportunity_to_project()` requires `status in
('ready_for_estimate', 'won')` but leaves `status` untouched afterward. A
converted `ready_for_estimate` opportunity stays `ready_for_estimate` —
converting to a project and winning the deal are different, independent
facts, and a contractor may need to start project work before the deal
is contractually finalized. Forcing a status change as a side effect of
conversion would conflate them.

## Project pipeline

```text
draft ──────► inspection_pending ──────► inspection_completed ──────► ready_for_estimate
  ▲                   │                        │  ▲                        │
  │                   ▼                        │  └────────────────────────┘
cancelled ◄───────────┴────────────────────────┴─────────────────► cancelled
  │
  └──► draft (reactivation)

archived ◄── (via archive_project() only, from cancelled/ready_for_estimate)
archived ──► (via restore_project() only, back to pre_archive_status)
```

| From | Allowed to |
|---|---|
| `draft` | `inspection_pending`, `cancelled` |
| `inspection_pending` | `inspection_completed`, `cancelled` |
| `inspection_completed` | `ready_for_estimate`, `inspection_pending`, `cancelled` |
| `ready_for_estimate` | `inspection_completed`, `cancelled` |
| `cancelled` | `draft` |
| `archived` | — |

Guards:

- `p_new_status = 'inspection_pending'` requires
  `p_inspection_scheduled_at` (also a table-level CHECK,
  `projects_inspection_date_required`).
- Same-status transitions are a no-op.
- A project always starts in `draft`, whether created directly or via
  conversion from an opportunity — never auto-promoted based on the
  source opportunity's status.

**Why no `active`/`on_hold`/`completed`:** the original
pre-implementation sketch (docs/05) included them, but Phase 1 has no
Estimates module and no execution tracking — there is nothing for a
project to be "in progress" against yet. See ADR 0012.

**Why `cancelled` is reversible:** mirrors the opportunity model's `lost`
reactivation — a paused project shouldn't require recreating the whole
record (and its notes/activity history) from scratch if the customer
comes back.

## What was evaluated and changed from the original brief

The Phase 1 brief proposed status lists and transition tables for both
entities with an explicit instruction to evaluate rather than adopt them
automatically. The two changes made after that evaluation, in both
cases documented in the corresponding ADR (0011, 0012):

1. **Archiving pulled out of the ordinary transition table entirely**,
   for both entities — given its own function and its own, stricter
   permission, rather than being "just another status you can move to."
2. **`lost`/`cancelled` made reversible** rather than terminal dead ends,
   reflecting how contractor sales/project cycles actually behave (leads
   go cold and come back; customers pause and resume).
