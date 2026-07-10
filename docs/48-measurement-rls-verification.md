# 48 — Measurement RLS Verification

Status: **Real Postgres, not mocked.** Same infrastructure discipline as
[44](44-material-catalog-rls-verification.md) — the dedicated
`scopevia-test` Supabase project, fresh users/tenants per run, real RPC
calls.

## Environment

| | |
|---|---|
| Database | `scopevia-test` (ref `msduefaopvxfjqktjymo`) |
| Test runner | Vitest, `tests/rls/phase2c-measurements.test.ts` |
| Logical users | Owner A (Tenant A), Owner B (Tenant B, cross-tenant target), Estimator, Sales, Viewer, Field Worker, Admin (used for the suspended-session case) — all created fresh per run |

## Results

| Suite | Tests | Result |
|---|---|---|
| `tests/rls/phase2c-measurements.test.ts` (new, this phase) | 25 | PASS |
| Full `tests/rls/*` suite (all phases) | 233 | PASS, zero regressions |
| `npm run test` (unit, includes 27 new measurement-calculation tests) | 134 | PASS |
| `npx playwright test` (E2E, desktop + mobile, includes 2 new measurement specs) | 68 | PASS |

(As in every prior phase's verification, a full `test:rls` run
immediately after the full Playwright E2E suite hit
`AuthApiError: Request rate limit reached` on two files — both create
many throwaway auth users in a short window. Re-running each affected
file alone passed cleanly (`tenant-isolation.test.ts` 40/40,
`phase2c-measurements.test.ts` 25/25); not a real failure, the same
documented flakiness pattern as [docs/35](35-phase-2a-rls-verification.md)/
[44](44-material-catalog-rls-verification.md).)

## What `phase2c-measurements.test.ts` covers

**Manual measurement CRUD & calculation correctness**: `manual_rectangle`
floor_area computes `area = length×width`, `perimeter = 2×(length+width)`;
`wall_area` computes `area = perimeter×height` (the brief's Bathroom
worked example: 10×8 room, 9ft ceiling → 324 sq ft); `wall_area` without
a height is rejected; `manual_area` accepts a direct area with no
perimeter; `manual_linear` accepts a direct linear length; zero length
and negative width are both rejected; metric `unit`/`unit_system` works
identically to imperial (the formulas are unit-agnostic);
`update_measurement()` recomputes area/perimeter; `archive_measurement()`
archives without touching already-generated content.

**Cross-tenant integrity**: Tenant A cannot read Tenant B's
measurements via a direct table query; a measurement cannot be created
under another tenant's proposal version (a `service_role` raw insert
mixing Tenant A's group with Tenant B's version/tenant_id is rejected
by the composite FK); `generate_material_from_measurement()` rejects a
material belonging to another tenant.

**Permission matrix**: Viewer cannot create a measurement; **Field
Worker CAN create a measurement despite holding no `proposals.update`
permission at all** (the specific case that required a dedicated
`measurements.create` permission rather than reusing `proposals.update`);
Field Worker cannot update a measurement or generate materials/labor
from one; Sales can create/update measurements but cannot archive or
generate materials/labor (both gated by permissions Sales deliberately
lacks); a suspended user's existing session cannot create a
measurement.

**Material + labor generation, and total recalculation**: generating a
material produces a correctly snapshotted `proposal_line_items` row at
the resolved ZIP price and recalculates `line_items_subtotal_cents`/
`total_cents`; generation is rejected outright (not defaulted to a
guessed price) when no catalog price exists for the selected ZIP, with
the brief's exact required message; area-based labor generation
computes `total_cents = area × rate` and recalculates
`labor_total_cents`; linear-based labor generation correctly falls back
to a measurement's `perimeter` when it has no distinct `linear_length`.

**Locked version immutability**: both `add_measurement()` and
`generate_material_from_measurement()` reject a `locked` proposal
version, consistent with every other mutation function in this
codebase.

## Design decisions this suite validates

- **A dedicated `measurements.*` permission set, not a reuse of
  `proposals.update`.** The Field Worker case above is the concrete
  reason: the brief's matrix requires Field Worker to create
  measurements, but Field Worker has never held `proposals.update` in
  any phase (see `20260706141600_seed_proposal_permissions.sql`'s
  matrix). Reusing `proposals.update` would have made this requirement
  impossible to satisfy without changing Field Worker's broader
  permissions elsewhere in the app.
- **`measurements.generate_materials` as a single gate**, withheld from
  roles lacking `proposals.manage_pricing` in the seed matrix, rather
  than double-checking both permissions inline in every generation
  function — simpler code, same practical effect.
- **A separate `add_proposal_labor_item_from_measurement()` function**
  rather than extending `add_proposal_labor_item()`'s signature further
  — verified by the fact that no existing hourly/fixed labor test in
  `phase2a-proposals.test.ts` needed any change for this phase to ship.
