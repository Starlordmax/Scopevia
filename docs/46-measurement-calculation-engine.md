# 46 — Measurement Calculation Engine

Status: **Implemented and verified** two ways: a pure unit test suite
(`tests/unit/measurement-calculations.test.ts`, 27 tests) and an
integration test suite against real Postgres RPCs
(`tests/rls/phase2c-measurements.test.ts`).

## Authority

The **only** authoritative implementation is the PL/pgSQL functions in
`supabase/migrations/20260709140200_measurement_functions.sql` and
`20260709140100_labor_area_linear_pricing.sql` —
`add_measurement()`, `update_measurement()`, `save_measurement_shape()`,
`generate_material_from_measurement()`,
`add_proposal_labor_item_from_measurement()`. Every value that gets
persisted (area, perimeter, calculated material quantity, labor total)
is computed there, never trusted from the client.

`src/lib/proposals/measurements.ts` is a documented, non-authoritative
TypeScript mirror used only for the Measurements step's live preview —
exactly the same "mirror, not authority" pattern as
`src/lib/proposals/calculations.ts` (Phase 2A) and
`src/lib/crm/opportunity-transitions.ts`. If the TS mirror and the SQL
ever disagree, the SQL wins.

## Formulas

**Rectangle area/perimeter** (`manual_rectangle` shape, `floor_area`/
`ceiling_area`/`room`/`surface`/`custom` measurement types, and
`sketch_rectangle` shapes):

```
area      = length × width
perimeter = 2 × (length + width)
```

**Wall area** (`manual_rectangle` shape, `wall_area` measurement type —
length/width describe the room's floor footprint, used only to derive
the perimeter; the stored `area` column is the wall area, not the floor
area):

```
perimeter = 2 × (length + width)
wall_area = perimeter × height
```

Height is required for `wall_area`; omitting it is rejected server-side
(`"Height is required to calculate wall area"`).

**Direct area / direct linear length** (`manual_area`/`manual_linear`
shapes): the user-entered value is stored as-is (rounded to 2 decimals);
no perimeter is derivable from a direct area, and no area/perimeter
from a direct linear length — both columns are left `null`.

**Waste** (applied when *generating* a material, not stored on the
measurement's own area/perimeter):

```
quantity_with_waste = base_quantity × (1 + waste_bps / 10000)
```

**Material quantity from a measurement**
(`generate_material_from_measurement()`), the brief's paint-gallons and
flooring worked examples generalized into one formula:

```
raw_quantity = measurement_value × coats × (1 + waste_bps / 10000) / coverage_rate
```

- Paint gallons: `measurement_value` = wall/ceiling area, `coverage_rate`
  = sq ft per gallon (e.g. 350), `coats` = 2 → `ceil((600 × 2 × 1.10) / 350) = 4`.
- Flooring: `measurement_value` = floor area, `coverage_rate` = 1 (a
  direct 1:1 sq-ft-of-material-per-sq-ft-of-floor mapping), `coats` = 1
  → `300 × 1.10 / 1 = 330`.

**Labor from a measurement** (`add_proposal_labor_item_from_measurement()`):

```
area-based:   total_cents = round(measurement.area × rate_cents)
linear-based: total_cents = round(coalesce(measurement.linear_length, measurement.perimeter) × rate_cents)
```

Linear-based labor falls back to a measurement's `perimeter` when it
has no distinct `linear_length` (e.g. pricing trim off a room
measurement that only ever computed a perimeter, never a separate
linear run) — this is a deliberate convenience, not an accident; both
represent "how many linear feet/meters" in that context.

## Rounding

| Value | Rule |
|---|---|
| length, width, height, area, perimeter, linear_length | Rounded to 2 decimal places (`numeric`, never a float) |
| Material quantity — discrete units (`gallon`, `each`, `day`, `hour`) | Rounded **up** (`ceil`) — a contractor cannot buy 0.4 of a gallon |
| Material quantity — continuous units (`sq_ft`, `linear_ft`, `fixed`) | Rounded to 2 decimal places, can be fractional |
| Money (line item / labor totals) | `round()` to the nearest cent, `bigint`, never a float — the standing project convention |

## Units

Imperial (`ft`) is the default because the initial market is US
contractors; metric (`m`) is fully supported — the formulas above are
unit-agnostic (a rectangle's area is `length × width` regardless of
which unit `length`/`width` are already in). There is **no automatic
conversion** between `ft` and `m` anywhere in this phase — a
measurement's `unit` column is a plain label alongside already-converted
numbers, not a value the system ever transforms. Generating a material
trusts the coverage rate the user enters to already be expressed in
matching units.

## Validation

Every dimension is rejected if it is zero, negative, `NaN`, or (on the
TypeScript mirror) non-finite — both layers independently enforce
"greater than zero," verified by dedicated unit tests
(`rejects zero length`, `rejects negative width`, `rejects NaN`, etc.)
and RLS tests (`zero length is rejected`, `negative width is rejected`).
Waste percentage is bounded to 0–100% (0–10000 basis points); coats to
1–20.
