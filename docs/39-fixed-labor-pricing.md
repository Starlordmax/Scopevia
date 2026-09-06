# 39 — Fixed Labor Pricing

Status: **Implemented and verified** — 13 new RLS-layer tests, 3 new unit
tests, 2 new E2E tests (desktop), extended mobile E2E coverage.

## The problem

The Labor step only supported an hourly calculation
(`workers × days × hours/day × rate`). Some contractors don't price labor
that way at all — they know the total labor cost as a single number
(e.g. "$700 for this bathroom remodel") and had no way to enter it
without fabricating hourly-looking inputs that don't reflect how they
actually think about the job.

## The two modes

A labor item now has a `pricing_method`: `'hourly'` (unchanged, and the
default) or `'fixed'` (new).

| | Hourly | Fixed |
|---|---|---|
| Fields | Workers, Days, Hours/day, Rate/hour | Fixed labor price |
| Formula | `total_hours = workers × days × hours/day`; `total_cents = round(total_hours × rate)` | `total_hours = 0`; `total_cents = fixed_total_cents` verbatim |
| Worked example | 1 worker × 1 day × 8h × $35/hr → 8 hours, $280.00 | $700.00 entered directly → $700.00 |

Both modes are always computed/validated server-side inside
`add_proposal_labor_item()`/`update_proposal_labor_item()` — never
trusted from the client, matching every other part of the calculation
engine (see [docs/32](32-proposal-calculation-engine.md)).

## Data model

`supabase/migrations/20260707160000_labor_fixed_pricing.sql` (new
forward migration — no existing migration was edited):

- `proposal_labor_items.pricing_method text not null default 'hourly'`,
  constrained to `('hourly', 'fixed')`.
- `proposal_labor_items.fixed_total_cents bigint`, nullable, constrained
  to `>= 0` (and a generous upper bound to reject absurd/overflow input,
  matching the existing pattern for the hourly fields).
- The four hourly-only columns (`worker_count`, `estimated_days`,
  `hours_per_day`, `hourly_rate_cents`) lost their `NOT NULL` constraint
  so a fixed-price row can leave them null. Their existing per-column
  `CHECK` constraints (e.g. `worker_count > 0`) already pass on `NULL`
  under standard SQL three-valued logic, so nothing else about them
  needed to change.
- A composite `CHECK` (`proposal_labor_items_pricing_fields_check`)
  enforces that every row has *exactly* the fields its own
  `pricing_method` requires — an hourly row can never have a
  `fixed_total_cents`, and a fixed row can never have a stray hourly
  value left over from before a mode switch.

**Compatibility:** every pre-existing labor item is implicitly `'hourly'`
(the column's `DEFAULT`), so no existing proposal was affected and no
data was rewritten. No locked version's data was touched.

### Why the SQL functions were dropped and recreated, not just replaced

`add_proposal_labor_item()`/`update_proposal_labor_item()` needed two new
trailing parameters (`p_pricing_method`, `p_fixed_total_cents`, both with
`DEFAULT`s for backward compatibility). Appending parameters changes a
function's parameter **type list**, which Postgres treats as a distinct
overload rather than a replacement — `CREATE OR REPLACE FUNCTION` alone
would have silently left the old 6/7-parameter version callable
alongside the new one. That is exactly the ambiguous-overload condition
that caused the `update_proposal_scope` "schema cache" bug (see
[docs/37](37-proposal-scope-rpc-fix.md)) — so the old signatures are
`DROP FUNCTION IF EXISTS`'d explicitly before the new ones are created,
and grants/revokes are reapplied to the new signature.

## Validation

`worker_count`/`estimated_days`/`hours_per_day`/`hourly_rate_cents` are
validated by `add_proposal_labor_item()` (SQL) exactly as before, but
only inside the `'hourly'` branch. `fixed_total_cents` is validated
inside the `'fixed'` branch: must be present (an explicit
`fixed_total_cents is null` check — a fixed item with no price is
rejected, not silently treated as $0) and `>= 0`.

On the TypeScript side, `addProposalLaborItemSchema`
(`src/lib/validation/proposals.ts`) is a Zod discriminated union on
`pricingMethod` rather than one object with optional fields — which
fields are required is an exhaustive, compiler-checked fact rather than
something enforced ad hoc. `requiredDollarsToCentsSchema` (reused from
the existing line-item price field) rejects an empty string outright via
regex rather than coercing it to `0`.

`updateProposalLaborItemAction`/an "edit labor item" UI does not exist —
the builder has only ever supported Add + Remove for labor items (no
edit flow, for either pricing method). `update_proposal_labor_item()`
was still extended to support both modes at the SQL layer (tested
directly via RPC, see below) for architectural completeness and to allow
switching a mode later without a schema change, but no new UI was added
for it — that would be functionality beyond this fix's scope.

## UI

`src/app/(protected)/proposals/[proposalId]/edit/step-labor.tsx`: a
"How do you want to price labor?" toggle (Hourly estimate / Fixed price)
switches which fields render. The existing items table gained a
"Details" column that shows either the hourly breakdown
(`2 × 5d × 8h/day @ $30.00/hr`) or "Fixed price", so a proposal with a
mix of both item types displays clearly. The live preview tile is
present for both modes, labeled "(preview — server confirms on save)" in
both cases — unchanged wording, now used for both formulas.

## Tests

- **Unit** (`tests/unit/proposal-calculations.test.ts`, 3 new cases in a
  new "fixed pricing method" describe block, plus 2 new
  `computeProposalTotals` cases): fixed price computes `total_hours=0`/
  `total_cents=fixedTotalCents`; a fixed price of exactly `0` is valid;
  switching method changes which fields are read; the exact manual
  verification cases from the brief ($700 fixed + $80 material = $780;
  $280 hourly).
- **RLS/integration** (`tests/rls/phase2a-proposals.test.ts`, new
  "Fixed-price labor" describe block, 13 cases against real Postgres):
  creation (`total_hours=0`, correct `total_cents`, hourly fields null);
  version recalculation; the exact $700+$80=$780 manual-verification
  case; negative price rejected; `null` price rejected (not treated as
  `0`); invalid `pricing_method` string rejected; switching hourly→fixed
  and fixed→hourly via `update_proposal_labor_item` (each direction
  clears the other mode's fields); a manipulated `total_cents`/
  `fixed_total_cents` via raw `.update()` never persists (no `UPDATE`
  grant); a locked version rejects both adding and updating fixed-price
  labor; cross-tenant add rejected; Estimator (has
  `proposals.manage_pricing`) can add fixed-price labor; Viewer cannot.
  The pre-existing hourly-only permission-matrix tests (Viewer/Sales/
  Field Worker rejected, Estimator allowed) were not duplicated for
  fixed mode, since the permission gate in both SQL functions runs
  identically before any `pricing_method` branch — one shared code path,
  already covered.
- **E2E** (`tests/e2e/proposals.spec.ts`, new "Labor pricing method"
  describe block, 2 cases): the fixed-price flow end to end (create
  proposal → switch to Fixed price → $700 → add a $80 material → Pricing
  Summary shows $700/$80/$780 → survives a hard reload); the hourly
  worked example end to end. Mobile coverage extended in
  `tests/e2e/proposals.mobile.spec.ts` (see [docs/41](41-photo-gallery-ui-fix.md)
  for the rest of that file's changes) to assert the Pricing Summary
  never shows a stale `$0.00` after adding hourly labor.

## Known limitations

No dedicated "edit an existing labor item" UI (matches the pre-existing
hourly-only behavior — Add + Remove only). No bulk migration tool to
convert an existing hourly item to fixed through the UI; the underlying
RPC supports it (tested directly), but a user would currently Remove and
re-Add to switch modes.
