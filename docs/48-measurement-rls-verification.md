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
| `tests/rls/phase2c-measurements.test.ts` (25 Phase 2C + 14 Phase 2C.1 freehand) | 39 | PASS |
| Full `tests/rls/*` suite (all phases) | 247 (144 run + 103 skipped by env guard) | PASS, zero regressions |
| `npm run test` (unit, includes 46 measurement-calculation tests — 27 Phase 2C + 19 Phase 2C.1 polygon/simplify/scale) | 153 | PASS |
| `npx playwright test` (E2E, desktop + mobile, includes 2 measurement specs each — manual/rectangle + freehand) | 70 | PASS |

(As in every prior phase's verification, running the full `tests/rls/*`
suite with default parallelism hit `AuthApiError: Request rate limit
reached` on two files that each create many throwaway auth users in a
short window. Re-running those two files sequentially
(`--fileParallelism=false`) passed cleanly, 103/103 combined; not a
real failure, the same documented flakiness pattern as
[docs/35](35-phase-2a-rls-verification.md)/
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

## Phase 2C.1: freehand/brush drawing (14 additional tests)

**Freehand polygon CRUD & calculation correctness**: a closed polygon
(an L-shape) computes area via the shoelace formula and perimeter as
the full edge sum, matching a hand-worked example (75 sq ft, 40 ft
perimeter); an open path computes only `linear_length` (no area, no
perimeter); a closed shape with fewer than 3 points is rejected; an
open path with fewer than 2 points is rejected; collinear points (zero
area) are rejected; a negative scale reference length is rejected.

**Update/archive parity with rectangle mode**: `update_measurement()`
rejects editing a `sketch_polygon` row's dimensions identically to
`sketch_rectangle` (archive-and-redraw only); `archive_measurement()`
works normally on a freehand-created row.

**Tenant isolation**: Tenant B cannot read Tenant A's freehand
measurement or its `proposal_measurement_shapes` row via a direct
table query.

**Material + labor generation from a freehand-derived area**:
`generate_material_from_measurement()` against a `sketch_polygon`'s
`area` field produces the same snapshotted price/quantity as a
rectangle-derived measurement (200 sq ft, 2 coats, 10% waste, $0.42/sq
ft coverage → 2 gallons, $84.00), and correctly rejects a material
belonging to another tenant; `add_proposal_labor_item_from_measurement()`
against a freehand area computes `total_cents = area × rate` identically.

**Locked version rejection**: `save_measurement_polygon_shape()` itself
(not just downstream generation) rejects a `locked` proposal version.

**Permission parity**: Field Worker can save a freehand measurement via
`save_measurement_polygon_shape()` despite holding no `proposals.update`
— the same dedicated-permission design Phase 2C established extends
unchanged to the freehand path, since it is gated by the same
`measurements.create` check, not a new one.

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
