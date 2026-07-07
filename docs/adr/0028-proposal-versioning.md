---
status: Accepted
date: 2026-07-06
supersedes: none
---

# ADR 0028 — Proposal versioning

## Context

A proposal's commercial content (scope, labor, line items, media, terms,
pricing) needs to support future revisions after being sent, without
losing the historical record of what was actually presented to the
client. The brief asks for `draft`/`locked`/`superseded` version states,
exactly one editable draft at a time, and immutability once locked —
implemented and tested even though nothing in Phase 2A can actually
trigger a real "send" yet.

## Decision

- `proposal_versions` holds all commercial content and derived totals;
  `proposals` itself only holds identity/status/routing fields
  (client, contact, opportunity, title, service type, numbering).
- Exactly one `version_status = 'draft'` row may exist per proposal
  (`proposal_versions_one_draft_per_proposal`, a partial unique index —
  the declarative backstop, same pattern as Phase 1's
  "one primary contact per client").
- `version_number` increments per proposal, starting at 1
  (`create_initial_proposal_version()`).
- Locking (`draft → locked`) has no real trigger yet — no code path sets
  it in Phase 2A, since sending doesn't exist. It is tested via a
  **controlled test preparation**: `tests/rls/phase2a-proposals.test.ts`
  uses the service-role client to set `version_status = 'locked'`
  directly, then verifies the database itself refuses further edits — see
  ADR 0029.
- `create_new_proposal_version()` (architecture prep for the sending
  phase) copies a locked version's sections/labor/line items/media into a
  fresh draft, marks the old version `superseded`, and repoints
  `proposals.current_version_id`. It requires the current version to
  already be `locked`, so it cannot be invoked in the ordinary Phase 2A
  flow (no version ever reaches `locked` through the UI) — it exists and
  is tested (grant present) purely so the sending phase doesn't need a
  schema change to use it.

## Consequences

- A locked version is a true point-in-time snapshot: even a subsequent
  Portfolio archive or media re-caption never alters what a locked
  version displays, because its own rows are frozen (see ADR 0029) and it
  references `media_assets` rows, not live Portfolio state.
- Because `create_new_proposal_version()` is unreachable without a prior
  lock, and Phase 2A never locks anything through ordinary use, this
  function currently has zero real callers outside tests — that is
  intentional, not dead code to be deleted; it is the seam the sending
  phase will use.
