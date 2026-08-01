# 42 — Material Catalog by ZIP Code

Status: **Implemented**, verified against real Postgres
(`tests/rls/phase2b-materials.test.ts`, 45 tests) and end-to-end via
Playwright (`tests/e2e/material-catalog.spec.ts` +
`material-catalog.mobile.spec.ts`).

> **Nota de estado (`docs/73`, client address + ZIP defaults):** `proposal_versions.pricing_zip_code`
> can now be seeded automatically at proposal creation, from the
> selected client's saved address ZIP (`clients.postal_code`) —
> `create_proposal_direct()` passes it to
> `create_initial_proposal_version()`, which normalizes a ZIP+4 to 5
> digits and silently ignores anything non-US-shaped (never blocks
> creation). This only affects the *initial* value of the column
> described below — `update_proposal_pricing_zip()` remains the only
> writer after creation, so a manual change is still never overwritten.
> See [docs/73](73-client-address-and-material-zip-defaults.md).
>
> **Nota de estado (2026-07-15, Phase 2D.1):** `search_material_catalog()`
> now paginates server-side instead of returning up to 200 unwindowed
> rows. See "Pagination (Phase 2D.1)" below and
> [docs/51-material-catalog-pagination.md](51-material-catalog-pagination.md)
> for the full writeup.

> **Nota de estado (Phase 2B.1, 2026-07-09):** The ZIP field and the
> catalog search/results now live in a single unified panel ("Material
> pricing") instead of two separate cards, and the search text now
> matches name/description/brand/supplier_name (not just name), with
> three distinct empty states instead of one generic message. A real
> bug is fixed: an empty-string category/search filter (the literal
> value the UI's "All categories" option and a cleared search box
> submit) was reaching the SQL function as `''`, not `null`, and
> `category = ''` matched nothing — silently returning zero results
> instead of "no filter." See "ZIP + search: one unified panel" and
> "The empty-string bug" below.

> **Nota de estado (Phase 2C, 2026-07-09/10):** A third way to add a
> catalog material to a proposal now exists —
> `generate_material_from_measurement()` — alongside manually
> typing a custom cost and browsing/adding straight from this catalog.
> It reuses the exact same material lookup, `find_material_zip_price()`
> fallback, and "never invent a price" guarantee documented below; the
> only difference is the quantity is computed from a measurement's area/
> perimeter/linear length rather than typed directly. See
> [docs/45-measurements-takeoff-builder.md](45-measurements-takeoff-builder.md).

> **This phase is internal/demo data.** Every price seeded in
> `20260708120500_seed_material_catalog_demo_data.sql` is fictional
> (though reasonable) and every supplier name is the generic "Demo
> Supplier" — never a real brand. No scraping, no real Home Depot/
> Lowe's/Sherwin-Williams data, no external API of any kind. The
> architecture (variable pricing by ZIP, point-in-time price
> snapshotting) is real and production-shaped; the *data* is not. A
> later phase can add CSV import or real supplier integrations without
> touching this schema — see "Known limitations" below.

## The problem

Before this phase, the Materials & Costs step only accepted manually
typed description/unit/price. This phase adds a browsable catalog with
location-aware pricing, while guaranteeing that a proposal's price is
locked in the moment a material is added — a later catalog price change
must never retroactively change an existing proposal.

## Data model

```text
material_catalog_items (scope: 'global' | 'tenant')
  └─ material_zip_prices (material_catalog_item_id; tenant_id nullable)

proposal_line_items
  ├─ material_catalog_item_id? / material_zip_price_id?  (provenance only)
  └─ source_type: 'catalog' | 'custom', source_zip_code, source_supplier_name,
     source_price_effective_date

proposal_versions
  └─ pricing_zip_code / pricing_state_code / pricing_city
```

### `material_catalog_items`

`scope='global'` (Scopevia's shared catalog, `tenant_id` null) or
`scope='tenant'` (a contractor's own custom material, `tenant_id`
required) — enforced by `material_catalog_items_scope_tenant_check`.
**No exposed function creates or edits a global row in this phase** —
the global catalog is seed/migration-only (see
`20260708120500_seed_material_catalog_demo_data.sql`); every exposed
create/update function (`create_tenant_material`,
`update_tenant_material`) only ever touches `scope='tenant'` rows, and
`update_tenant_material` explicitly rejects an attempt to edit a global
row even for an Owner.

`category` and `service_type` are fixed CHECK enums (paint, primer,
tape, brushes, rollers, drop_cloths, drywall, tile, flooring, wood,
plumbing, electrical, hardware, disposal, other /
interior_painting, exterior_painting, bathroom_remodeling,
general_remodeling, flooring, custom) — no JSONB, no free-text taxonomy.

### `material_zip_prices`

A price for one `material_catalog_item_id`, optionally scoped to a
`zip_code`/`state_code`/`city` and/or a specific `tenant_id`.
`tenant_id` null = usable by any tenant (a shared/default price);
non-null = a tenant-owned override, visible and usable only by that
tenant. `unit_price_cents` is a bounded `bigint` (money is always
cents, never floats — the standing project convention). `price_source`
is a CHECK enum: `manual_seed` and `tenant_custom` are the only values
actually written to in this phase; `manual_admin`, `csv_import`, and
`future_external` are reserved column values for later phases, not
implemented paths.

### Cross-tenant integrity: a trigger, not a composite FK

Every other table in this codebase enforces cross-tenant integrity with
the established `unique (id, tenant_id)` + composite FK pattern (ADR
0007). That pattern assumes a child's `tenant_id` always matches its
parent's — but a **global** material has `tenant_id = null`, which a
composite FK can't express ("this child may reference this global
parent regardless of the child's own tenant_id"). Per the brief's
explicit authorization to deviate here, this phase uses two
`SECURITY DEFINER` trigger functions instead:

- `prevent_cross_tenant_material_price()` (on `material_zip_prices`):
  a price for a `scope='tenant'` material must have the *exact same*
  `tenant_id` as that material. A price for a `scope='global'` material
  has no such restriction.
- `prevent_cross_tenant_material_reference()` (on `proposal_line_items`):
  a line item referencing a tenant-scoped material/price must belong to
  that same tenant.

Both raise `23514` on violation and are verified directly with
`service_role` raw inserts in `tests/rls/phase2b-materials.test.ts`,
"Cross-tenant integrity" — bypassing every application-level check, the
same discipline as every other cross-tenant test in this codebase.

## ZIP pricing fallback

`find_material_zip_price(material_id, tenant_id, zip_code)` resolves
the best available price in three tiers, and **never invents a price**
— it returns null rather than guessing:

1. **Exact ZIP match.**
2. **Same state** — the state is inferred from any *other* price row
   that happens to share the exact target ZIP (there is no canonical
   ZIP→state table in this phase; see "Known limitations").
3. **ZIP/state-agnostic default** (`zip_code` and `state_code` both
   null on the price row).

A tenant-owned override always wins over a global price at the same
tier. `search_material_catalog()` (the browse/search RPC) calls this
per result; `add_proposal_line_item_from_catalog()` (the write path)
calls it again at the moment of adding — a display-time price and an
add-time price are always computed from the exact same function, so
they can never disagree.

If no tier resolves a price, the UI shows "No price available for this
ZIP" and the Add button either stays disabled (no override capability)
or requires an explicit manual override (see "Permissions" below) — a
catalog item is never silently added at $0.

## Proposal item snapshot

`proposal_line_items` already had (since Phase 2A) the columns that
drive every calculation and every display: `description`, `unit`,
`unit_price_cents`, `quantity`, `line_total_cents`, `taxable`. This
phase adds provenance-only columns —
`material_catalog_item_id`/`material_zip_price_id` (which catalog
row/price this came from) and `source_type`/`source_zip_code`/
`source_supplier_name`/`source_price_effective_date` (what was true at
the moment of adding). **The provenance columns are metadata only.**
Every calculation and every render reads exclusively the pre-existing
snapshot columns, exactly as before — a later catalog or price change
can never retroactively change an existing line item, because nothing
ever re-reads `material_catalog_items`/`material_zip_prices` for an
already-added row.

Verified directly in `tests/rls/phase2b-materials.test.ts`, "Snapshot
pricing": add a catalog item, then update the underlying seed price
directly via `service_role`, then confirm the already-added line item's
`unit_price_cents`/`line_total_cents` are unchanged.

### Changing the ZIP

`update_proposal_pricing_zip()` sets `proposal_versions.pricing_zip_code`
(+ state/city). This **only** affects materials added *after* the
change — every already-added line item keeps its own
`source_zip_code`/price snapshot. The UI shows this warning verbatim
next to the ZIP field:

> Changing ZIP code only affects new materials you add. Existing
> proposal items keep their saved prices.

Verified end-to-end: add at ZIP 33101, change to 78701, add a second
material, confirm the first item's price/ZIP are untouched
(`tests/rls/phase2b-materials.test.ts` and
`tests/e2e/material-catalog.spec.ts`).

## Permissions

| Permission | Purpose |
|---|---|
| `materials.view` / `.create` / `.update` / `.archive` | The catalog itself (global read + a tenant's own custom materials) |
| `material_prices.view` / `.create` / `.update` / `.archive` | ZIP prices (global read + a tenant's own price overrides) |

A deliberate two-tier design for *adding a catalog item to a proposal*,
reconciling the brief's "Sales should be able to add catalog items"
with the existing (Phase 2A) decision that Sales does not manage
pricing by default:

- Adding a catalog item **at its resolved catalog price** only requires
  `proposals.update` (which Sales already has) — picking from an
  already-priced list is not itself a pricing decision.
- **Overriding** that price with a manual value requires the stricter
  `proposals.manage_pricing` (which Sales deliberately lacks — see
  `20260706141600_seed_proposal_permissions.sql`'s module comment).

| Role | materials.view/prices.view | materials create/update | prices create/update | add catalog item to proposal | override price |
|---|---|---|---|---|---|
| Owner / Admin | ✅ | ✅ | ✅ | ✅ | ✅ |
| Estimator | ✅ | ✅ (tenant only) | ✅ (tenant only) | ✅ | ✅ |
| Sales | ✅ | ❌ | ❌ | ✅ | ❌ |
| Field Worker | ✅ | ❌ | ❌ | ❌ (no `proposals.update`) | ❌ |
| Viewer | ✅ | ❌ | ❌ | ❌ | ❌ |

RLS visibility (`material_catalog_items`/`material_zip_prices`): a
global row (`scope='global'` / `tenant_id is null`) is visible to any
authenticated user with no permission gate — the same precedent as the
existing `roles` table's `is_system=true` rows (reference data, not a
tenant's private information). A tenant-scoped row requires
`user_has_permission(tenant_id, '…')` exactly like every other table in
this codebase.

`find_material_zip_price()` is **not** directly callable by
`authenticated` (see `20260708120600_material_catalog_security_fix.sql`)
— it performs no permission check of its own and is only meant to be
called internally by `search_material_catalog()`/
`add_proposal_line_item_from_catalog()`, both of which gate on a
tenant_id the caller has already proven access to. Granting it directly
would let any authenticated user pass an arbitrary `p_tenant_id` and
read that tenant's private price overrides — found and fixed before
this phase shipped (see "Known limitations" is not the place for this;
it was a bug, not a limitation, closed same-day).

## UI

Materials & Costs step (`step-materials.tsx`):

1. **Material pricing** — a single panel (`MaterialPricingPanel`)
   containing the ZIP field, the search/category form, and the results
   list, in that order — see "ZIP + search: one unified panel" below.
2. **Add a custom cost** — the pre-existing (Phase 2A) manual entry
   form, relabeled to make the distinction from catalog items explicit;
   unchanged behavior, still gated by `proposals.manage_pricing`.
3. **Saved costs** — unchanged table, with a small "via catalog — ZIP
   NNNNN" hint under any catalog-sourced row's description.

No preview-vs-saved-total regression: adding a catalog item calls
`recalculate_proposal_version()` exactly like every other mutation in
this module, and the Pricing Summary reads the same server-computed
totals it always has — see
[docs/40](40-proposal-total-refresh-fix.md#round-2-definitive-db-proof-and-the-actual-ux-fix).

## ZIP + search: one unified panel

Originally the ZIP field and the catalog search/results were two
separate `.section-card`s, read as two unrelated modules rather than one
flow. Phase 2B.1 merges them into a single card, `MaterialPricingPanel`,
under one heading ("Material pricing"):

1. ZIP code field + Save ZIP + the "only affects new materials" warning.
2. "Search materials" — the search box (matches name, description,
   brand, and supplier_name — see below) + category filter, a plain GET
   form (`?catalogSearch=&catalogCategory=`, matching this codebase's
   existing simplicity discipline — no client-side fetch/autosave;
   pressing Enter in the search box submits it natively, no JS needed).
3. A results heading that reflects the current filter state —
   `Results for ZIP 33101`, or `Showing plumbing materials for ZIP
   33101` once a category is applied — followed by the results table,
   each row with its own compact Add form (quantity, optional section,
   and — only for users with `manage_pricing` — an optional price
   override).

### Three distinct empty states

Previously every "nothing to show" case rendered the same generic "No
materials match your search," which conflated three different
situations. Now:

| Situation | Message |
|---|---|
| No ZIP saved yet, and the current filter matches zero materials | "Enter a ZIP code to load material pricing." |
| A ZIP is saved, but the filter matches zero materials at all | "No materials match your search for this ZIP code. Try a different keyword or category." |
| The filter matches real materials, but none of them have a price at this ZIP (all three fallback tiers exhausted) | "No price is available for these materials in this ZIP code. Try another ZIP code or add a custom cost." (shown above the results table, which still lists the matched — just unpriced — materials) |

An unfiltered browse (no ZIP, no search text, no category) always shows
the full catalog with every price column reading "No price available
for this ZIP" — it is never blank just because no ZIP has been set yet.

## Broadened text search

`search_material_catalog()`'s text filter previously matched only
`name`. It now matches `name`, `description`, `brand`, and
`supplier_name` (all via case-insensitive `ILIKE '%…%'` partial match)
— e.g. searching "weather-resistant" now finds Exterior Paint via its
description, not just its name.

## Pagination (Phase 2D.1)

`search_material_catalog()` previously had a hardcoded `limit 200` and
no offset — the TS wrapper and every caller fetched (and rendered)
"everything," which was fine at the ~26-item seed-catalog scale but
meant the Materials & Costs step had no actual paging behavior. As the
catalog grows this doesn't scale, and even at 26 items the UI rendered
every row as a full add-to-proposal card (name/description, unit,
supplier, price, quantity, section, override price, submit button),
producing 30,000px+ of scroll on a 390px mobile viewport.

The function now takes `p_limit` (default 20, clamped server-side to
1–100) and `p_offset` (default 0, clamped to ≥0), and returns an
additional `total_count` column computed via `count(*) over()` — a
window function evaluated over the full matching set before the
`LIMIT`/`OFFSET` step, so every returned row carries the *true* total
match count in one query, no second round-trip. `searchMaterialCatalog()`
(`src/lib/proposals/materials.ts`) returns `{ items, totalCount, hasMore }`
(`hasMore = items.length < totalCount`) instead of a bare array.

The UI ("Load more materials," not numbered pagination — an RPC-backed
search makes an exact-count query awkward, and a running numbered
`<Pagination>` component isn't a good fit for a growing result window)
tracks a single `catalogLimit` query param that starts at 20 and grows
by 20 each click (`?catalogLimit=40`, `60`, …), always requesting
`p_offset=0` with the larger `p_limit` — a "growing cumulative limit,"
not a true paged offset. This keeps the feature entirely
server-rendered/GET-form-driven, consistent with the existing
`catalogSearch`/`catalogCategory` params, with no Client Component
fetch/accumulation state and no risk of rows shifting between clicks.
A "Showing X of Y materials." hint and a `has_more`-gated "Load more
materials" button sit below the results table; both disappear once
every matching row is showing.

Two indexes were added to keep this fast as the catalog grows:
`material_catalog_items_service_type_idx` (btree, for the
`service_type` filter used by material-from-measurement generation) and
`material_catalog_items_name_trgm_idx` (GIN trigram, for the `ILIKE`
name search), in
`supabase/migrations/20260711100000_material_catalog_pagination.sql` —
a forward migration; the already-applied
`search_material_catalog` migration was never edited, since changing a
`RETURNS TABLE(...)` shape requires `DROP FUNCTION` + `CREATE OR
REPLACE`, not just `CREATE OR REPLACE` alone.

Search still matches `name`/`description`/`brand`/`supplier_name`,
category filtering still combines with search, ZIP pricing/fallback and
snapshot pricing are untouched — pagination only changes how many rows
of an already-computed result set are returned per call.

## The empty-string bug (found and fixed)

A real bug, not just a design gap: the category `<select>`'s "All
categories" option has `value=""`, and a cleared search box also
submits `""`. The Next.js call site normalized `""` to `null` before
calling the RPC (`emptyToNull()` in `src/lib/proposals/materials.ts`),
but **the SQL function itself did not** — a raw call to
`search_material_catalog()` with `p_category = ''` hit
`mci.category = p_category`, which is never true for an empty string,
silently returning zero rows instead of "no filter." Any caller that
didn't go through the specific JS wrapper (a different action, a
future API route, a direct RPC call, a test) would hit the same bug.

Fixed at the source in
`20260709100100_material_catalog_search_empty_string_fix.sql`: every
optional filter (`p_zip_code`, `p_search_text`, `p_category`,
`p_service_type`) is normalized with `nullif(btrim(coalesce(…, '')), '')`
inside the function body itself, so `''` and `null` are always
equivalent regardless of who calls it — the caller-side normalization
in the JS wrapper is now redundant defense-in-depth, not the only
guard. Verified directly:
`tests/rls/phase2b-materials.test.ts`, "Text search…", calls the RPC
with a literal `""` for both `p_search_text` and `p_category` and
asserts the full catalog still comes back.

## Seed data

26 global materials across three categories (paint, bathroom
remodeling, flooring), priced at 4 demo ZIPs — 33101 (Miami, FL), 78701
(Austin, TX), 90001 (Los Angeles, CA), 10001 (New York, NY) — plus
deliberately uneven coverage to exercise every fallback tier:

- **Interior Paint**: all 4 ZIPs + a ZIP/state-agnostic default.
- **Waterproof Membrane, Roll**: only a state-level FL price (tier 2).
- **Sandpaper Pack** / **Floor Transition Strip**: only a
  ZIP/state-agnostic default (tier 3).
- **Construction Debris Disposal**: no price at all (tests "No price
  available for this ZIP").

## Known limitations

- **No real external pricing of any kind.** All prices are fictional
  demo data (`price_source = 'manual_seed'`); `manual_admin`,
  `csv_import`, and `future_external` are reserved enum values for a
  future phase, not implemented.
- **No canonical ZIP→state table.** The "same state" fallback tier
  infers state from any other price row that happens to share the exact
  target ZIP — reliable within this phase's 4 seeded demo ZIPs, not a
  general-purpose ZIP database.
- **No global-catalog admin UI.** The shared catalog is
  seed/migration-only; a future phase could add an admin panel, CSV
  import, or scraping without changing this schema.
- **No tenant-material-management UI in this phase.** The backend
  (`create_tenant_material`/`create_tenant_material_price` and their
  update/archive counterparts) is fully implemented and tested, but
  this phase's UI only exposes browsing the catalog and adding to a
  proposal — not a "manage my own materials" screen.
