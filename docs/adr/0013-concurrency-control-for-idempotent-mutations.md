---
status: Accepted
date: 2026-07-02
supersedes: none
---

# ADR 0013 — Concurrency control for idempotent mutations

## Context

Phase 1 has three operations where two concurrent callers racing each
other could otherwise corrupt state or create duplicates: setting a
client's primary contact, setting a project's primary address, and
converting an opportunity into a project. Phase 0 already established a
pattern for this exact class of problem in `protect_last_owner()` (lock
the tenant row, then read/decide/write) — Phase 1 reuses and extends it.

## Decision

Each of the three operations combines the same three layers, in order:

1. **Row lock** (`SELECT ... FOR UPDATE`) on the shared parent before
   reading or mutating anything — the client row in
   `set_primary_contact()`, the project row in
   `set_primary_project_address()` and `create_project_address()`, and
   the opportunity row in `convert_opportunity_to_project()`. This
   serializes concurrent callers acting on the same parent so the
   "clear old, set new" (or "check existing, then insert") sequence can't
   interleave.
2. **A declarative constraint as the ground-truth backstop**, independent
   of the lock actually being honored by every caller: the partial unique
   indexes `client_contacts_one_primary_per_client` and
   `project_addresses_one_primary_per_project` (`WHERE is_primary = true
   AND archived_at IS NULL`) make "two primaries for the same parent"
   impossible at the database level regardless of application logic; the
   unique index `projects_opportunity_id_key` (`WHERE opportunity_id IS
   NOT NULL`) makes "two projects for the same opportunity" impossible
   the same way.
3. **Idempotent behavior, not just error-avoidance.** For
   `convert_opportunity_to_project()`, a caller retrying (or a second
   concurrent caller that loses the lock race) doesn't get an error — it
   gets back the *same* project row that the winning call created,
   because the function checks `select * from projects where
   opportunity_id = ...` both before attempting the insert (fast path)
   and again inside an `exception when unique_violation` handler (the
   backstop, for a caller that somehow bypassed the lock, e.g. a raw
   script). This matters because the client-side action layer treats
   convert-to-project as safe to retry on a network timeout without
   double-creating a project.

## Consequences

- Any future "exactly one X per Y" or "convert A into B exactly once"
  requirement should reach for this same three-layer pattern rather than
  inventing a new one: lock the shared parent, add the partial/unique
  index as the real guarantee, and make retries idempotent by checking
  for the existing result first.
- The row lock is a performance/contention tradeoff: two users editing
  addresses on the *same* project at the *same* moment will serialize
  (one waits briefly for the other's transaction to commit) rather than
  run in parallel. Acceptable at Phase 1's expected concurrency — a
  handful of staff per tenant, not high-frequency simultaneous edits to
  one record — and revisited only if it becomes a measured problem.
- Verified under real concurrency (not just code review) in
  `tests/rls/phase1-crm.test.ts`: two concurrent `set_primary_contact`
  calls leave exactly one primary; two concurrent
  `convert_opportunity_to_project` calls on the same opportunity return
  the same project id and create exactly one `projects` row. See
  docs/23-phase-1-rls-verification.md for the execution evidence.
