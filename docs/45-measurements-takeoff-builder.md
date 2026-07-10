# 45 — Measurements / Takeoff Builder

Status: **Implemented**, verified against real Postgres
(`tests/rls/phase2c-measurements.test.ts`, 25 tests), a pure unit suite
(`tests/unit/measurement-calculations.test.ts`, 27 tests), and end-to-end
via Playwright (`tests/e2e/measurements.spec.ts` +
`measurements.mobile.spec.ts`).

## What this phase adds

A new **Measurements** step in the Proposal Builder, between Client & Job
and Scope of Work in the stepper's visual order:

```text
Client & Job → Measurements → Scope → Labor → Materials & Costs → Photos → Terms & Pricing → Review
```

A contractor can record room/surface dimensions — either typed
(**Manual entry**) or drawn (**Draw layout**, rectangle-only — see
[docs/47](47-drawing-sketch-mode.md)) — and then **generate** a catalog
material or a priced labor item directly from a measurement's computed
area, perimeter, or linear length. Generated materials/labor are
ordinary `proposal_line_items`/`proposal_labor_items` rows afterward —
they show up in the existing Materials & Costs / Labor steps' saved
lists exactly like any manually-added item, and the Pricing Summary and
proposal total recalculate through the same
`recalculate_proposal_version()` every other mutation in this app uses.

> **Scope note:** creating a new proposal still redirects to the Scope
> step (unchanged from Phase 2A), not Measurements — Measurements is
> reachable as the stepper's first tab, but is not forced on every new
> proposal. This was a deliberate call to avoid rewriting the large
> number of existing E2E assertions that expect the post-creation
> redirect target, for a requirement the brief's acceptance criteria
> didn't explicitly demand ("Existe Step Measurements", not "es el
> primer paso obligatorio al crear").

## Data model

Four new tables (see
[supabase/migrations/20260709140000_measurements_schema.sql](../supabase/migrations/20260709140000_measurements_schema.sql)):

```text
proposal_measurement_groups (proposal_version_id; a named grouping, e.g. "Bathroom")
  └─ proposal_measurements (measurement_group_id; one measured value: a floor, a wall, a linear run)
       ├─ proposal_measurement_shapes (1:1; the drawn rectangle, if sketch mode was used)
       └─ proposal_measurement_materials (provenance: which catalog material was generated, at what quantity/price)

proposal_labor_items gains: pricing_method 'area'|'linear', measured_area/measured_linear_length,
  labor_rate_per_area_cents/labor_rate_per_linear_cents, proposal_measurement_id (provenance)
```

Every table denormalizes `tenant_id` **and** `proposal_version_id`
directly (not just reachable via a join), matching this codebase's
standing pattern (`proposal_line_items`, `proposal_media`, etc.) — this
lets the existing generic `prevent_locked_version_child_mutation()`
trigger (which reads `NEW/OLD.proposal_version_id`) be reused unchanged
on all four tables, and keeps RLS a single `user_has_permission(tenant_id, …)`
check with no join required.

### Cross-tenant integrity

`proposal_measurement_materials` references `material_catalog_items` /
`material_zip_prices`, which have the same global-vs-tenant duality as
Phase 2B's catalog. A dedicated trigger,
`prevent_cross_tenant_measurement_material()`, enforces the same rule as
`prevent_cross_tenant_material_reference()` on `proposal_line_items` —
a tenant-scoped material/price must belong to the exact same tenant as
the row referencing it. Every other relationship uses the standard
`unique (id, tenant_id)` + composite-FK pattern (ADR 0007). Verified
directly with `service_role` raw inserts attempting cross-tenant
references — see [docs/48](48-measurement-rls-verification.md).

## Permissions

Five new permissions — `measurements.view` / `.create` / `.update` /
`.archive` / `.generate_materials` — **not** a reuse of
`proposals.update`, because Field Worker must be able to create
measurements despite never holding `proposals.update` at all (see the
brief's explicit matrix).

| Role | view | create | update | archive | generate_materials |
|---|---|---|---|---|---|
| Owner / Admin | ✅ | ✅ | ✅ | ✅ | ✅ |
| Estimator | ✅ | ✅ | ✅ | ✅ | ✅ |
| Sales | ✅ | ✅ | ✅ | ❌ | ❌ |
| Field Worker | ✅ | ✅ | ❌ | ❌ | ❌ |
| Viewer | ✅ | ❌ | ❌ | ❌ | ❌ |

`measurements.generate_materials` is deliberately withheld from
Sales/Field Worker: both lack `proposals.manage_pricing`, and the
brief conditions "generate materials/labor from a measurement" on
holding pricing permission — a single permission check achieves the
same effect as double-gating without an extra inline
`proposals.manage_pricing` check inside every generation function.

## Generating materials from a measurement

`generate_material_from_measurement()` mirrors
`add_proposal_line_item_from_catalog()`'s material lookup and price
resolution exactly (same global/tenant visibility check, same
`find_material_zip_price()` 3-tier fallback, same "never invent a
price" guarantee — a material with no catalog price for the selected
ZIP shows exactly: *"No catalog price is available for this material
in the selected ZIP code. Add a custom cost instead."*), plus:

1. Reads the measurement's `area`, `perimeter`, or `linear_length`
   (caller picks which field applies).
2. Computes `quantity = value × coats × (1 + waste_bps/10000) / coverage_rate`,
   rounded per [docs/46](46-measurement-calculation-engine.md)'s table.
3. Inserts a normal `proposal_line_items` row — the price/quantity
   snapshot is copied in exactly like a plain catalog add; a later
   catalog price change never retroactively changes it.
4. Records provenance in `proposal_measurement_materials` (which
   measurement, which field, what coverage/coats/waste were used).
5. Calls `recalculate_proposal_version()` — the Pricing Summary and
   total update immediately, no different from any other line item.

## Generating labor from a measurement

`add_proposal_labor_item_from_measurement()` is a **separate** function
from the existing `add_proposal_labor_item()` (hourly/fixed) — deliberately,
to avoid growing that function's already-large signature further and to
keep zero regression risk to hourly/fixed labor, which this migration
does not touch at all. `proposal_labor_items` gains two more
`pricing_method` values:

- **`area`**: `total_cents = round(measurement.area × rate_cents)`.
- **`linear`**: `total_cents = round(coalesce(measurement.linear_length, measurement.perimeter) × rate_cents)`
  — falls back to perimeter when a measurement has no explicit linear
  length (e.g. pricing trim off a room's floor measurement, which only
  has `perimeter` computed, not a separate linear run).

Both snapshot the measurement's value at generation time
(`measured_area`/`measured_linear_length` columns) — editing the
measurement afterward never retroactively changes an already-generated
labor item's total, the same "snapshot, not live reference" guarantee
Phase 2B established for materials.

## UI

`step-measurements.tsx`: one "Measurements" panel (group creation,
Manual entry / Draw layout tabs, saved measurements list) plus a
"Generate materials from measurement" / "Generate labor from
measurement" panel (measurement picker, catalog search reusing
`searchMaterialCatalog()`, coverage/coats/waste inputs, and a
labor-by-area/linear form). See [docs/34](34-proposal-builder-ux.md)
for how this fits into the builder's step-by-step flow.

## Preview

The standalone Preview/Review document gained a "Measurements" section
— name, type, dimensions, area, perimeter, waste %, and which
materials/labor were generated from each measurement (by human-readable
name, e.g. "Material: Laminate Flooring" / "Labor: Flooring install
labor"). No internal IDs, no `shape_data` JSON, no permission keys are
ever rendered — matching the standing rule for every other section of
this document.

## Known limitations

- **Draw layout supports rectangles only** — no polygons, no moving
  individual points after drawing. See [docs/47](47-drawing-sketch-mode.md)
  for the full reasoning.
- **No cross-unit-system conversion.** A measurement's dimensions are
  stored in whichever base unit (`ft` or `m`) its group uses; generating
  a material trusts the coverage rate the user enters to already be in
  matching units (e.g. "350 sq ft/gallon" for an imperial measurement).
  There is no automatic ft↔m conversion anywhere in this phase.
- **The Manual entry form's `unit` field is a hidden input defaulted
  from the first measurement group created in the proposal**, not from
  whichever group is currently selected in the dropdown, and it is not
  independently editable on that form. For the common case (one unit
  system per proposal) this is invisible and correct. A proposal that
  deliberately mixes an imperial group and a metric group would silently
  save every Manual-entry measurement in the *first* group's unit,
  regardless of which group is actually selected — a real limitation,
  not just a display quirk. The Draw layout tab does not have this
  problem: its unit is a plain, user-visible `<select>` (Feet/Meters)
  the contractor can change per drawing regardless of any default.
  Fixing Manual entry cleanly is UI-only (make its unit field a visible,
  independently-editable `<select>` like Draw layout's) and is a
  reasonable follow-up.
- **No "edit a drawn shape" flow** — a sketch-mode measurement's
  dimensions can only be changed by drawing and saving a new one;
  `update_measurement()` explicitly rejects attempts to edit a
  `sketch_rectangle`/`sketch_polygon` row (see
  [docs/47](47-drawing-sketch-mode.md)).
- **No AI measurement detection, blueprint/PDF upload parsing, or
  full CAD editor** — explicitly out of scope for this phase, per the
  brief.
