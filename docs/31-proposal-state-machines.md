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
draft ◄──► ready ──► [future: sent] ──► accepted  (via the Client Portal — Phase 3B)
  │          │                     └──► declined  (via the Client Portal — Phase 3B)
  │          │
  ▼          ▼
archived ◄───┘  (via archive_proposal(), from draft or ready only)
  │
  └──► draft or ready  (via restore_proposal(), back to pre_archive_status)

accepted / declined ──► draft  (via create_proposal_revision() — Phase 3B.1,
                                 "revision in progress"; see docs/58)
```

| From | To | Function | Actor permission | Effects |
|---|---|---|---|---|
| *(new)* | `draft` | `create_proposal_direct` / `create_proposal_from_opportunity` | `proposals.create` | Creates version 1, syncs opportunity, audit + activity |
| `draft` | `ready` | `mark_proposal_ready` | `proposals.mark_ready` | Audit + activity |
| `ready` | `draft` | `return_proposal_to_draft` | `proposals.mark_ready` | Audit + activity |
| `draft`/`ready` | `archived` | `archive_proposal` | `proposals.archive` | Records `pre_archive_status`, frees the opportunity for a new proposal |
| `archived` | `draft`/`ready` | `restore_proposal` | `proposals.restore` | Rejected (friendly error) if the opportunity has since acquired a different active proposal |
| `ready`/`sent` | `accepted` | `submit_proposal_client_response(p_response_type := 'accepted')` (Phase 3B) | *(none — the actor is the CLIENT, via a verified portal session, never a tenant member)* | Locks the responded version, audit + activity, one row in `proposal_client_responses` |
| `ready`/`sent` | `declined` | `submit_proposal_client_response(p_response_type := 'declined')` (Phase 3B) | *(same as above)* | Same as above |
| `accepted`/`declined` | `draft` | `create_proposal_revision` (Phase 3B.1) | `proposals.create_revision` | Copies the locked version into a new draft version, old version → `superseded`, audit + activity — see [docs/58](58-proposal-revision-flow.md) |

**Not user-selectable by a CONTRACTOR, by design:** `sent`, `viewed`,
`expired`, `superseded` remain exactly as originally documented — no
tenant-member-facing function accepts them as a target status, and
`proposals` still has no `UPDATE` grant to `authenticated` at all (a raw
client-side `.update()` is still a silent no-op). **`accepted`/`declined`
are the first exception**, and a deliberate one: they are reachable only
through `submit_proposal_client_response()`, called exclusively by the
CLIENT (via their verified portal session, through the service-role admin
client — see [docs/57](57-client-response-security.md)), never by any
contractor-facing action. Verified directly:
`tests/rls/phase2a-proposals.test.ts`, "a user cannot set status directly
to sent/viewed/accepted/declined via .update()," still passes unmodified
— a tenant member (contractor) still cannot set these values themselves,
by any path other than the client actually responding. **`accepted`/
`declined` → `draft` is the one path a contractor DOES control** (Phase
3B.1's `create_proposal_revision()`) — but note it only ever moves
*forward* out of a responded state into a fresh editable draft; a
contractor still cannot set a proposal directly to `accepted`/`declined`,
and cannot silently edit the accepted/declined content itself (that stays
locked on the old, now-`superseded` version forever).

**Guards enforced inside every transition function**, on top of the
transition table: idempotent same-status no-ops, permission checks
before any row is touched, and (for `restore_proposal`) a friendly
rejection instead of a raw constraint-violation error when the
`proposals_one_active_per_opportunity` partial unique index would be
violated.

## Client Portal links/OTP/viewing do NOT change proposal status — only a response does (Phase 3A / 3B)

Creating or revoking a client portal link, a client requesting/verifying a
code, or a client viewing the proposal in the portal — **none** of these
touch `proposals.status`, exactly as Phase 3A originally documented.
**Exporting/printing a proposal (Phase 3C, either the contractor or the
Client Portal route) is likewise read-only** — it never touches
`proposals.status`, `proposal_versions.version_status`, or any other
state; it's purely a different rendering of data that's already there. See
[docs/60](60-proposal-pdf-print-export.md).
`sent` remains reserved-but-unreachable ("Crear portal link no
necesariamente marca sent... El estado sent se reservará para cuando
exista email delivery real"). A link can only be **created** for a
`ready` (or, for forward-compatibility, `sent`) proposal —
`create_proposal_portal_link()` rejects `draft` and `archived` — but
creating one does not itself advance the proposal's status.

**Phase 3B adds exactly one exception**: the client's own accept/decline
decision, via `submit_proposal_client_response()` — see the transition
table above and [docs/56](56-client-portal-accept-decline.md). Every
other portal action still only ever produces `crm_activities`
(`client_portal_link_created`, `client_portal_link_revoked`,
`proposal_viewed_by_client`, and — new — `proposal_accepted_by_client`/
`proposal_declined_by_client`) and `audit_logs` entries
(`portal_link.created`, `portal_link.revoked`, `portal_otp.requested`,
`portal_otp.verified`, `proposal.viewed`, and — new —
`proposal.accepted_by_client`/`proposal.declined_by_client`) — visible to
the contractor, and only the last two of these ever change the proposal's
own state machine.

## Proposal version lifecycle (`proposal_versions.version_status`)

`draft` → `locked` → `superseded`. See
[docs/adr/0028](adr/0028-proposal-versioning.md) and
[docs/adr/0029](adr/0029-locked-version-immutability.md). `locked` is now
reached in real, ordinary use — `submit_proposal_client_response()` locks
the current version the instant a client responds (Phase 3B). `superseded`
is likewise now reached in real, ordinary use —
`create_proposal_revision()` moves the just-responded-to version from
`locked` to `superseded` the moment a revision is created (Phase 3B.1; see
[docs/58](58-proposal-revision-flow.md)). Both `locked` and `superseded`
are treated as equally immutable by `prevent_locked_proposal_version_mutation()`
and `prevent_locked_version_child_mutation()` — see docs/58 for why that
trigger behavior was tightened in this phase.
