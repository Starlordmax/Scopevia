---
status: Accepted
date: 2026-07-06
supersedes: none
---

# ADR 0034 — Project creation after proposal acceptance

## Context

Section 40 of the brief asks for architectural preparation for
`create_project_from_accepted_proposal()`: implement the function, do not
expose it in the UI, and test it "a nivel de integración usando una
preparación controlada de test" rather than by faking a real acceptance
flow through the interface (real acceptance requires the Client Portal,
out of scope for this phase).

## Decision

**Implemented as a function only, no UI.**
`create_project_from_accepted_proposal()`
(`supabase/migrations/20260706141800_create_project_from_accepted_proposal.sql`)
requires `proposals.status = 'accepted'`, copies `client_id`,
`opportunity_id`, `client_contact_id` (as `primary_contact_id`), `title`
(as `name`), and `service_type` into a new `projects` row, and is
idempotent: if a project already exists for the proposal's opportunity
(Phase 1's `projects_opportunity_id_key` unique index), it returns that
project instead of erroring or duplicating.

It is granted to `authenticated` (like `create_new_proposal_version()`,
ADR 0028) because its own precondition check makes that safe: no Phase
2A code path can ever produce a proposal with `status = 'accepted'` (see
docs/31-proposal-state-machines.md), so calling it in practice always
fails with a clear error. No route or button in the UI calls it.

**Tested via controlled preparation, not a faked acceptance flow:** the
test uses the `service_role` client to set `proposals.status = 'accepted'`
directly (bypassing the real, currently-nonexistent acceptance path),
then calls the function as an authenticated user and verifies the copy
and idempotency — see `tests/rls/phase2a-proposals.test.ts`, "Project
creation from an accepted proposal (architecture prep)."

## Consequences

- The Client Portal phase can call this function directly once real
  acceptance exists — no schema or function change needed, only the
  event that flips `proposals.status` to `accepted`.
- Because the precondition is unreachable today, this function has zero
  real callers in production — that is intentional (architecture prep,
  not dead code) and mirrors `create_new_proposal_version()`'s status in
  this same phase.
