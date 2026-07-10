# 32 — Proposal Calculation Engine

Status: **Implemented and verified** three independent ways: a pure unit
test suite, an integration test suite against real Postgres RPCs, and a
real-browser manual walkthrough. See
[docs/adr/0030](adr/0030-labor-calculation-model.md) and
[docs/adr/0031](adr/0031-tax-and-discount-model.md) for the decisions.

> **Nota de estado (2026-07-08):** Labor now supports a second pricing
> mode — a single fixed price, alongside the original hourly calculation
> — see "Labor" below and
> [docs/39-fixed-labor-pricing.md](39-fixed-labor-pricing.md) for the full
> design and [docs/40-proposal-total-refresh-fix.md](40-proposal-total-refresh-fix.md)
> for the investigation into a reported "Pricing Summary shows $0.00" bug.

> **Nota de estado (2026-07-09):** `add_proposal_line_item_from_catalog()`
> (Phase 2B) is a second way to create a `proposal_line_items` row,
> alongside the original `add_proposal_line_item()` — it resolves a ZIP
> price via `find_material_zip_price()`, snapshots it, and calls the
> exact same `recalculate_proposal_version()` as every other mutation
> here. No new calculation logic, no new authority — the total is still
> always `round(quantity × unit_price_cents)` regardless of whether the
> price came from a manual entry or a catalog lookup. See
> [docs/42-material-catalog-by-zip.md](42-material-catalog-by-zip.md).

> **Nota de estado (2026-07-09, Phase 2C):** `proposal_labor_items`
> gains two more `pricing_method` values, `area` and `linear`, generated
> exclusively from a measurement's computed area/perimeter/linear_length
> via a new, separate function
> (`add_proposal_labor_item_from_measurement()` — the existing
> `add_proposal_labor_item()`/`update_proposal_labor_item()` for
> hourly/fixed labor are untouched). `total_cents` is still always
> `round(measured_value × rate_cents)`, still recalculated through the
> same `recalculate_proposal_version()`. Generating a material from a
> measurement (`generate_material_from_measurement()`) uses its own
> formula layered on top of the existing catalog snapshot mechanics —
> see [docs/45](45-measurements-takeoff-builder.md) and
> [docs/46](46-measurement-calculation-engine.md) for the full detail
> (rounding table, worked examples, unit handling).

## Authority

The **only** authoritative implementation is
`recalculate_proposal_version()`
(`supabase/migrations/20260706141000_proposal_helpers.sql`), called
internally after every labor/line-item mutation. Nothing else — not the
client, not a cached value — ever supplies a total that gets persisted.
`src/lib/proposals/calculations.ts` is a documented, non-authoritative
TypeScript mirror used only for the Proposal Builder's live preview
(exactly the same "mirror, not authority" pattern as
`src/lib/crm/opportunity-transitions.ts`).

## Labor

Two pricing methods, chosen per labor item (`proposal_labor_items.pricing_method`):

**Hourly** (the original, default mode):

```
total_hours = worker_count × estimated_days × hours_per_day   (rounded to 2 decimals)
total_cents = round(total_hours × hourly_rate_cents)
```

Worked example from the brief: 2 workers, 5 days, 8 hours/day, $30/hour →
80 hours, $2,400.00. A second worked example: 1 worker, 1 day, 8
hours/day, $35/hour → 8 hours, $280.00.

**Fixed** (new — for a contractor who prices labor as a single flat
amount rather than deriving it from a rate):

```
total_hours = 0   (not tracked for a fixed-price item)
total_cents = fixed_total_cents   (entered directly, validated >= 0, never computed)
```

Worked example: a $700.00 fixed labor price → `total_cents = 70000`,
`total_hours = 0`.

Both are verified in `tests/unit/proposal-calculations.test.ts`,
`tests/rls/phase2a-proposals.test.ts` (see its "Fixed-price labor"
describe block), and real browser sessions (see [docs/36](36-phase-2a-e2e-verification.md)).

Multiple labor items — hourly, fixed, or a mix of both on the same
proposal — sum independently and are added together for the version's
`labor_total_cents`. Which fields apply is enforced at the database level
by `proposal_labor_items_pricing_fields_check`: an hourly row always has
all four hourly fields and a null `fixed_total_cents`; a fixed row always
has `fixed_total_cents` and null hourly fields — never a mix of both on
the same row, and never silently defaulted.

## Materials & other costs (line items)

```
line_total_cents = round(quantity × unit_price_cents)
```

`quantity` supports decimals (`numeric(12,3)`, e.g. `12.5` gallons).
`taxable` is a per-line-item boolean.

## Total

Order of operations, deterministic and server-only:

1. `subtotal = labor_total + line_items_subtotal`
2. `discount = fixed value, or floor(subtotal × percent_bps / 10000)` — capped at `subtotal`, never negative
3. `taxable_subtotal = labor_total + line_items_taxable_subtotal`, then the discount is subtracted from it **in proportion to its share of the subtotal** (proration — see below)
4. `tax = floor(taxable_subtotal × tax_rate_bps / 10000)`
5. `total = subtotal − discount + tax` — floored at 0 as a second defense (the discount cap already prevents a negative result)

**Labor is always taxable** — a documented decision, not an oversight;
there is no per-tenant "labor is non-taxable" toggle in Phase 2A (see
ADR 0031 for why).

**Discount proration**: when a discount applies across a mix of taxable
and non-taxable line items, it's removed from the taxable portion
proportionally to that portion's share of the whole subtotal — not
applied entirely to one side. This keeps tax always computed on the
*actual* post-discount taxable amount, regardless of which specific items
happened to be taxable.

`calculation_version` is stored as a literal (currently `1`) on every
version — reserved so a future formula change can distinguish rows
computed under the old vs. new rules, without needing to infer it from
timestamps.

## Manipulation resistance

- No `UPDATE` grant exists on `proposal_labor_items`, `proposal_line_items`,
  or `proposal_versions` for `authenticated` — every total field can only
  change via the `SECURITY DEFINER` functions, which recompute from the
  underlying rows every time, ignoring any total the client might send.
- Verified directly: `tests/rls/phase2a-proposals.test.ts`, "a manipulated
  total_cents sent directly via .update() is never accepted."
- Input validation rejects zero/negative/absurd values before any
  calculation runs (`worker_count` 1–500, `estimated_days`/`hours_per_day`
  bounded and > 0, `hourly_rate_cents`/`unit_price_cents` ≥ 0,
  `quantity` > 0) — these bounds exist to reject NaN/Infinity/garbage
  input, not as realistic business limits.

## Test coverage

`tests/unit/proposal-calculations.test.ts` (23 cases) and
`tests/rls/phase2a-proposals.test.ts` (real RPC calls) together cover:
one worker, a crew, multiple labor items, multiple line items, decimal
quantity, fixed discount, percentage discount, a discount exceeding the
subtotal (capped), taxable vs. non-taxable line items, labor-always-
taxable, discount proration, rounding, a zero-value proposal, high
realistic values, and the impossibility of injecting a manipulated total
(the pure function's input type has no total field to inject; the RPC has
no grant that would accept one).
