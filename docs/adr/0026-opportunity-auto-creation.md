---
status: Accepted
date: 2026-07-06
supersedes: none
---

# ADR 0026 — Direct proposal creation and opportunity auto-creation

## Context

Section 20 of the brief asks for a "New proposal" flow that lets a
contractor pick a client directly, without first creating an opportunity,
while section 21 requires the Opportunity detail page and the Pipeline to
stay meaningful (every proposal should be discoverable from a pipeline
item). Two options were evaluated: (a) allow `proposals.opportunity_id`
to be genuinely null for direct creation, or (b) always end up with an
opportunity attached, creating one automatically when none is given.

## Decision

**Option (b) — always ends with an opportunity attached.**
`create_proposal_direct()` accepts an optional `p_opportunity_id`; when
omitted, it creates a lightweight opportunity in the same transaction
(status `proposal_in_progress`, same title as the proposal, same client)
before creating the proposal. `create_proposal_from_opportunity()` is a
thin wrapper requiring the opportunity up front.

Reasoning: keeping `opportunity_id` effectively always-present avoids two
classes of problems that a genuinely-nullable design would create —
Pipeline/Dashboard views that need a `left join` and null-handling
everywhere, and a confusing UX where some proposals show up in the
Pipeline and others silently don't. The schema still allows
`opportunity_id is null` (no `not null` constraint) for forward
flexibility, but no Phase 2A code path produces one.

**Idempotency:** a `proposal_creation_requests` ledger
(`tenant_id, idempotency_key` primary key) guards against duplicate
opportunity+proposal pairs from a double-submit or retried request — see
`supabase/migrations/20260706141100_proposal_functions_core.sql`. The
client generates a fresh UUID per page load
(`src/app/(protected)/proposals/new/new-proposal-form.tsx`).

**Status sync:** the auto-created (or linked) opportunity is moved to
`proposal_in_progress` via `sync_opportunity_to_proposal_in_progress()`,
which is a no-op if the opportunity is already past that point (won/lost/
archived/already in progress) — see docs/31-proposal-state-machines.md.

## Consequences

- Every proposal is reachable from an opportunity, keeping Pipeline and
  Dashboard views simple (no null-handling for "orphan" proposals).
- An opportunity auto-created this way is otherwise a completely ordinary
  opportunity — it can be edited, moved through the pipeline, archived,
  etc. exactly like a manually-created one; nothing marks it as "special"
  in the schema besides the initial audit metadata
  (`auto_created_for_proposal: true` in the audit log's `metadata` jsonb).
- If a future phase needs proposals genuinely independent of any
  opportunity (e.g. a quick one-off quote with no pipeline tracking
  desired), that's a schema-compatible addition (the column is already
  nullable) rather than a breaking change.
