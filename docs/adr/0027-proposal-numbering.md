---
status: Accepted
date: 2026-07-06
supersedes: none
---

# ADR 0027 — Proposal numbering

## Context

Proposals need a human-facing sequential number per tenant (e.g. "Proposal
#42"), displayed alongside a tenant-configurable prefix
(`tenant_proposal_settings.proposal_number_prefix`). It must be safe under
concurrent creation (two proposals created in the same instant must never
receive the same number) and must never be settable by the client.

## Decision

`tenant_proposal_settings.next_proposal_number` is a plain `int`, advanced
exclusively by `allocate_next_proposal_number(p_tenant_id)`
(`supabase/migrations/20260706141000_proposal_helpers.sql`), which locks
the tenant's single settings row with `SELECT ... FOR UPDATE`, reads the
current value, increments it, and returns the pre-increment value — all
inside the same transaction as the proposal insert. No separate
`sequence`/table is used since a tenant already has exactly one settings
row to lock.

`proposals.proposal_number` is a plain `int` (not the display string) with
`unique (tenant_id, proposal_number)`; the prefix is applied only at
display time in the UI. There is no explicit gaplessness guarantee: a
transaction that allocates a number and then fails for any other reason
(e.g. a later validation error) leaves a gap, exactly as any bigserial-style
counter would. This is documented rather than silently promised, per the
brief's explicit instruction not to promise gaplessness unless truly
guaranteed.

## Consequences

- Verified under real concurrency:
  `tests/rls/phase2a-proposals.test.ts`, "concurrent creation produces
  different proposal_numbers" (5 parallel creates) and
  "next_proposal_number allocation is concurrency-safe" (10 parallel raw
  allocations) — both pass with zero collisions.
- `next_proposal_number` has no UPDATE grant to `authenticated` and no
  RPC that accepts a caller-supplied value — it can only move forward via
  `allocate_next_proposal_number()`.
- Two different tenants can have the same proposal_number (e.g. both
  tenant A and tenant B have a "#1") since the uniqueness is scoped to
  `(tenant_id, proposal_number)` — this is intentional, not a bug.
