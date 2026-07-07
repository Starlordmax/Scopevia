---
status: Accepted
date: 2026-07-06
supersedes: none
---

# ADR 0030 — Labor calculation model

## Context

The brief's core Labor Calculator example: 2 workers × 5 days × 8 hours/day
× $30/hour = 80 hours, $2,400. Multiple labor items must be supported
(e.g. "Lead painter", "Remodeling crew"), and the total must always be
server-computed, never trusted from the client.

## Decision

`proposal_labor_items` stores `worker_count`, `estimated_days` (numeric,
supports half-days), `hours_per_day`, `hourly_rate_cents`, and two
derived columns (`total_hours`, `total_cents`) that are **only ever
written by** `add_proposal_labor_item()` / `update_proposal_labor_item()`
(`supabase/migrations/20260706141200_proposal_functions_sections_items.sql`):

```
total_hours = round(worker_count * estimated_days * hours_per_day, 2)
total_cents = round(total_hours * hourly_rate_cents)
```

`hourly_rate_cents` represents what the tenant charges the **customer**
per hour — not the employee's internal wage. A per-tenant default lives in
`tenant_proposal_settings.default_customer_hourly_rate_cents`
(pre-filled into the Labor step, overridable per item). Internal labor
cost (what the contractor pays their crew) is explicitly out of scope for
Phase 2A — the brief allows deferring it "oculto del MVP" (hidden from
the MVP) and no column for it exists yet; adding one later is additive,
not a breaking schema change.

Input bounds (`worker_count` 1–500, `estimated_days` and `hours_per_day`
> 0 with sane caps, `hourly_rate_cents >= 0`) exist purely to reject
NaN/Infinity/absurd-input attempts, not as realistic business limits — see
`docs/32-proposal-calculation-engine.md`.

A TypeScript mirror (`src/lib/proposals/calculations.ts`) implements the
identical formula for the Proposal Builder's live preview, explicitly
documented (same pattern as `opportunity-transitions.ts`) as **not the
authority** — the value that's actually saved always comes from the
server.

## Consequences

- Verified via the brief's own worked example both in a pure unit test
  (`tests/unit/proposal-calculations.test.ts`) and end-to-end through the
  real RPC (`tests/rls/phase2a-proposals.test.ts`) and a real browser
  session (manual smoke test) — all three independently produce 80 hours
  / $2,400.00.
- Multiple labor items on one proposal sum correctly
  (`recalculate_proposal_version()` sums `total_cents` across all
  non-archived rows).
