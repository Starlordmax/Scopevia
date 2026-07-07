# 31 — Proposal State Machines

Status: **Implemented.** Two state machines: the (minimally extended)
Opportunity pipeline from Phase 1, and the new Proposal lifecycle.

## Opportunity pipeline (extended)

Phase 1's 8 states are kept in full; exactly one new state is added,
`proposal_in_progress`:

```text
new ──► contacted ──► qualified ─┬──► inspection_scheduled ─┐
                                  ├──► ready_for_estimate ◄──┤
                                  └──► proposal_in_progress ◄┘
                                             │
                                             ▼
                                           lost (requires lost_reason)
```

| From | Allowed to |
|---|---|
| `new` | `contacted`, `lost` |
| `contacted` | `qualified`, `lost` |
| `qualified` | `inspection_scheduled`, `ready_for_estimate`, `proposal_in_progress`, `lost` |
| `inspection_scheduled` | `qualified`, `ready_for_estimate`, `proposal_in_progress`, `lost` |
| `ready_for_estimate` | `qualified`, `proposal_in_progress`, `won`, `lost` |
| `proposal_in_progress` | `qualified`, `lost` |
| `won` | *(none — terminal)* |
| `lost` | `contacted`, `qualified` |
| `archived` | *(none — only via `restore_opportunity()`)* |

**Why `inspection_scheduled`/`ready_for_estimate` were kept, not
replaced**, even though the brief's own "recommended" list omits them:
removing them would break Phase 1's existing data, tests, and documented
behavior with no compatibility migration — section 7 of the brief
explicitly forbids that. This is the brief's own "evaluate before
adopting" instruction applied to itself: the minimal, backward-compatible
change is to add the new state alongside the old ones, not replace them.

**Why `proposal_sent` and a proposal-driven `won` are NOT yet added:** no
function in Phase 2A can reach them (sending/acceptance don't exist
until a later phase). Per this project's established pattern (ADR 0012),
a status value with no code path that can produce it is not added
speculatively — they'll be added in the phase that implements
sending/acceptance.

**Conceptual sync** (not literal status mirroring — Opportunity does not
replicate every Proposal-internal state):

| Proposal status | Opportunity status |
|---|---|
| `draft` or `ready` | `proposal_in_progress` |
| `sent` or `viewed` *(future)* | `proposal_sent` *(future)* |
| `accepted` *(future)* | `won` *(future)* |
| `declined` *(future)* | `lost` *(future)* |

Implemented today via `sync_opportunity_to_proposal_in_progress()`: when
a proposal is created for/from an opportunity that's `new`, `contacted`,
`qualified`, `inspection_scheduled`, or `ready_for_estimate`, it's moved
to `proposal_in_progress`. An opportunity already `won`/`lost`/`archived`/
`proposal_in_progress` is left untouched — the proposal is still created
and linked either way, never blocked by this sync.

## Proposal lifecycle

```text
draft ──► ready ──► [future: sent ──► viewed ──► accepted/declined/expired]
  │          │
  └──────────┘  (ready → draft)
  │          │
  ▼          ▼
archived ◄───┘  (via archive_proposal(), from draft or ready only)
  │
  └──► draft or ready  (via restore_proposal(), back to pre_archive_status)

[any non-terminal] ──► superseded  (future: when a new version is created after sending)
```

| From | To | Function | Actor permission | Effects |
|---|---|---|---|---|
| *(new)* | `draft` | `create_proposal_direct` / `create_proposal_from_opportunity` | `proposals.create` | Creates version 1, syncs opportunity, audit + activity |
| `draft` | `ready` | `mark_proposal_ready` | `proposals.mark_ready` | Audit + activity |
| `ready` | `draft` | `return_proposal_to_draft` | `proposals.mark_ready` | Audit + activity |
| `draft`/`ready` | `archived` | `archive_proposal` | `proposals.archive` | Records `pre_archive_status`, frees the opportunity for a new proposal |
| `archived` | `draft`/`ready` | `restore_proposal` | `proposals.restore` | Rejected (friendly error) if the opportunity has since acquired a different active proposal |

**Not user-selectable in Phase 2A, by design:** `sent`, `viewed`,
`accepted`, `declined`, `expired`, `superseded`. No function accepts
these as a target status; the UI never renders a control for them (the
Review step's "Send" button is present but disabled with an explanatory
tooltip, never wired to an action). Verified directly:
`tests/rls/phase2a-proposals.test.ts`, "a user cannot set status directly
to sent/viewed/accepted/declined via .update()" — no UPDATE grant exists
on `proposals` at all, so even a raw client-side `.update()` call is a
silent no-op, never actually changing the row.

**Guards enforced inside every transition function**, on top of the
transition table: idempotent same-status no-ops, permission checks
before any row is touched, and (for `restore_proposal`) a friendly
rejection instead of a raw constraint-violation error when the
`proposals_one_active_per_opportunity` partial unique index would be
violated.

## Proposal version lifecycle (`proposal_versions.version_status`)

`draft` → `locked` → `superseded`. See
[docs/adr/0028](adr/0028-proposal-versioning.md) and
[docs/adr/0029](adr/0029-locked-version-immutability.md) — no Phase 2A
function ever sets `locked` in ordinary use; it's tested via a
service-role-driven controlled preparation.
