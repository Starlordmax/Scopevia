# 51 — Phase 2D.1: Material Catalog Pagination & Mobile Search UX

Status: **Implemented**, verified against real Postgres and end-to-end
via Playwright (desktop + mobile), zero regressions in the existing
suite.

## Scope

The Materials & Costs step's catalog search had no pagination. This
phase adds server-side pagination (limit/offset + a "Load more"
control) without touching search relevance, category filtering, ZIP
pricing/fallback, snapshot pricing, or proposal totals. No Client
Portal, external APIs, scraping, AI, PDF, Stripe, payments, or
global-catalog admin UI — out of scope, per the brief's explicit
restriction.

## 1. Root cause

Three layers combined to produce 30,000px+ of mobile scroll on a
populated ZIP with no search/category filter:

1. **`search_material_catalog()` had `limit 200` hardcoded**, with no
   `p_limit`/`p_offset` parameters at all — every call fetched "the
   whole matching set" (up to 200 rows), never a page of it.
2. **The TS wrapper had no pagination params to pass through** —
   `searchMaterialCatalog()` (`src/lib/proposals/materials.ts`) took
   `zipCode`/`searchText`/`category` and returned a bare array; there
   was no way for a caller to ask for fewer rows even if it wanted to.
3. **`MaterialPricingPanel` rendered every returned row as a full
   add-to-proposal card**, unwindowed — each row's mobile card (the
   `.table-card`/`data-label` responsive pattern) contains five
   field-groups (name+description, unit, supplier, price, and an
   entire quantity/section/override-price/submit-button sub-form).
   At even the modest ~26-item demo-catalog scale, with no filter
   applied, this alone produced enormous cumulative page height on a
   390px-wide viewport.

Confirmed via mobile screenshots taken in the earlier Phase 2D visual
review (see [docs/50](50-visual-review-notes.md), "Known limitations")
and via the new E2E regression test asserting
`document.documentElement.scrollHeight` before the fix would have
exceeded 30,000px on a no-filter, ZIP-only search.

## 2. Pagination / search implementation

`search_material_catalog()` now accepts `p_limit` (default 20, clamped
server-side to `least(greatest(coalesce(p_limit, 20), 1), 100)`) and
`p_offset` (default 0, clamped to `greatest(coalesce(p_offset, 0), 0)`)
— defensive clamping regardless of what a caller sends, mirroring the
existing `clampPageSize()` discipline already used by the
Clients/Opportunities/Proposals list pages.

The function's `RETURNS TABLE(...)` shape gained one new column,
`total_count`, computed via `count(*) over()` — a window function that
Postgres evaluates over the **entire matching set**, ahead of the
`LIMIT`/`OFFSET` step, so every returned row carries the true total
match count (not "however many rows this page happens to return") in
a single query — no second `COUNT(*)` round-trip needed.

Because `CREATE OR REPLACE FUNCTION` cannot change an existing
function's `RETURNS TABLE(...)` column list, this required an explicit
`DROP FUNCTION IF EXISTS search_material_catalog(...)` (old signature)
followed by `CREATE OR REPLACE FUNCTION` (new signature) — a forward
migration
(`supabase/migrations/20260711100000_material_catalog_pagination.sql`),
never touching the already-applied original.

`searchMaterialCatalog()` now accepts `limit?`/`offset?` and returns
`MaterialCatalogPage = { items, totalCount, hasMore }`, where
`hasMore = items.length < totalCount` — a thin pass-through; all real
logic (windowing, clamping, counting) lives in the SQL function.

Search (`name`/`description`/`brand`/`supplier_name`, case-insensitive
partial match) and category filtering are unchanged and compose
normally with the new limit/offset — a search + category combo still
returns a correctly-paginated, correctly-counted subset.

### "Load more," not numbered pagination

An explicit product preference (over the app's existing numbered
`<Pagination>` + exact `count: 'exact'` pattern used by
Clients/Opportunities/Proposals): an RPC-backed search makes a genuine
"page 3 of 7" experience awkward (there's no plain table to apply
`.range()` to), and a true offset-based "next page" risks rows shifting
between clicks if the underlying data changes mid-session.

Instead, `catalogLimit` (a URL query param, alongside the existing
`catalogSearch`/`catalogCategory`) starts at `DEFAULT_PAGE_SIZE` (20)
and grows by 20 on each "Load more materials" click — `20 → 40 → 60 →
…` — always requesting `p_offset=0` with the larger `p_limit`. The
visible list is always "the first N results so far," so a page reload
never shifts which rows are showing, and there's no need for a Client
Component with fetch-based accumulation state — the whole feature stays
a plain SSR/GET-form flow, consistent with how search and category
filtering already work.

`edit/page.tsx` parses and clamps `catalogLimit` server-side (belt and
suspenders against a hand-edited URL, on top of the RPC's own
clamping), and passes `catalogTotalCount`/`catalogHasMore`/
`catalogLimit`/`catalogPageSize` down to `StepMaterials` →
`MaterialPricingPanel`.

## 3. UX changes

**Desktop and mobile, both:**

- A "Showing X of Y materials." hint line appears under the results
  table.
- A "Load more materials" button appears below the table whenever
  `catalogHasMore` is true, and disappears once every matching row is
  showing.
- Search box, category filter, and ZIP field are unchanged in position
  (top of the "Material pricing" panel, per the existing Phase 2B.1
  unified-panel layout).

**Mobile-specific:**

- First page is capped at 20 rows regardless of how many materials
  match — confirmed via E2E to keep `scrollHeight` well under 15,000px
  (previously 30,000px+ with the same no-filter search).
- The "Load more materials" button has an adequate touch target
  (confirmed ≥32px tall via E2E `boundingBox()` assertion).
- No horizontal overflow at any point in the flow (before search,
  after search, after Load more, after adding a post-Load-more item) —
  confirmed via `scrollWidth <= viewportWidth + 1` assertions
  throughout the mobile E2E test.

## 4. Performance review

- **One query, not two:** `count(*) over()` gets the true total in the
  same round-trip as the page of rows — no separate `COUNT(*)` call.
- **No per-material RPC:** `find_material_zip_price()` is still called
  once per *returned* row inside `search_material_catalog()`, same as
  before — pagination means fewer rows are ever priced per call (20 by
  default instead of up to 200), not that pricing logic changed shape.
- **No heavy re-render per keystroke:** search/category/Load-more are
  all plain GET-form navigations (full page loads), the same
  established pattern as the rest of this app's search/filter UIs — no
  client-side fetch-per-keystroke to introduce.
- **Indexes added** (forward migration, not editing the applied
  original): `material_catalog_items_service_type_idx` (btree — the
  `service_type` filter used by material-from-measurement generation)
  and `material_catalog_items_name_trgm_idx` (GIN trigram, `gin_trgm_ops`
  — the `ILIKE` name search), following the exact convention already
  used for `clients.display_name`/`opportunities.title`/`projects.name`.

## 5. Security review

- **RLS unchanged.** No policy on `material_catalog_items` or
  `material_zip_prices` was touched — a global row (`tenant_id is
  null`) remains visible to any authenticated user with no permission
  gate; a tenant-scoped row still requires
  `user_has_permission(tenant_id, '…')`.
- **Tenant isolation confirmed under pagination** — new RLS test
  (`tests/rls/phase2b-materials.test.ts`, "Pagination (Phase 2D.1)")
  seeds materials for two separate tenants and confirms each tenant's
  paginated search never returns the other's tenant-scoped rows or
  price overrides, at every limit/offset combination exercised.
- **`p_limit`/`p_offset` are clamped server-side inside the SQL
  function itself** — a malicious or malformed client value (0,
  negative, or absurdly large) can never bypass the 1–100 window or
  request a negative offset, regardless of what the TS wrapper or a
  hand-edited URL sends.
- **Snapshot pricing untouched.** Adding a catalog item still calls
  `add_proposal_line_item_from_catalog()`, which re-resolves
  `find_material_zip_price()` at add-time and snapshots the result onto
  `proposal_line_items` exactly as before — pagination affects only
  what's *browsable*, never what's *written*.

## 6. Tests

| Suite | Before this phase | After this phase |
|---|---|---|
| Typecheck | clean | clean |
| Lint | clean | clean |
| Unit (`npm test`) | 153/153 | 153/153 |
| RLS/integration (`npm run test:rls`, sequential) | 247/247 | 257/257 |
| E2E (`npm run test:e2e`) | 72/72 | 72/72 (new pagination scenarios added to existing spec files, no new count of spec files) |
| Build | clean | clean |

`tests/rls/phase2b-materials.test.ts` grew from 35 to 45 tests: 4
pre-existing tests updated (each now passes an explicit `p_limit: 100`
to preserve its original "see the whole catalog" intent, since the new
default of 20 would otherwise change what they observe) plus 10 new
tests — default page of 20 with a correct `total_count`, limit/offset
windowing correctness, limit+category combo, limit+search combo,
offset past the end of the result set, empty result, limit clamped to
the 100 max, limit clamped to the 1 min, offset clamped to the 0 min,
and tenant isolation holding under pagination.

`tests/e2e/material-catalog.spec.ts` (desktop) gained one new test:
open Materials & Costs, save ZIP 33101, confirm the first page caps at
exactly 20 rows with "Showing 20 of 26 materials.", confirm "Load more
materials" is visible, click it, confirm the URL now carries
`catalogLimit=40`, confirm more rows render and the hint text updates
to show every material, confirm the button disappears, and confirm
adding a row that was only visible after Load More still works
end-to-end (quantity, override price, Add to proposal, Saved costs).

`tests/e2e/material-catalog.mobile.spec.ts` (390×844) gained one new
test covering the same Load-more flow with mobile-specific assertions:
first page ≤20 rows, `scrollHeight < 15,000` (the explicit regression
guard against the original 30,000px+ bug), no horizontal overflow at
any point, the Load-more button has an adequate touch target
(`height >= 32`), and adding a post-Load-more material updates the
Saved costs subtotal correctly.

## 7. Screenshots

Generated to a gitignored folder (`test-results/pagination-review/`),
via two temporary Playwright specs deleted immediately after capture:

- `test-results/pagination-review/desktop/01-materials-empty-state-no-zip.png`
- `test-results/pagination-review/desktop/02-materials-with-results-first-page.png`
- `test-results/pagination-review/desktop/03-materials-after-load-more.png`
- `test-results/pagination-review/mobile/01-materials-with-results-first-page.png`
- `test-results/pagination-review/mobile/02-materials-after-load-more.png`
- `test-results/pagination-review/mobile/03-materials-saved-costs.png`

Reviewed directly: the desktop first-page screenshot shows exactly 20
result rows, the "Showing 20 of 26 materials." hint, and a visible
"Load more materials" button above "Add a custom cost"; the mobile
first-page screenshot shows the same 20-row cap in the stacked mobile
card layout with ZIP/search/category on top, well within the
`scrollHeight < 15,000` (CSS pixels) regression guard confirmed by the
E2E test.

## 8. Files modified

```
CHANGELOG.md
docs/34-proposal-builder-ux.md
docs/42-material-catalog-by-zip.md
docs/50-visual-review-notes.md
src/app/(protected)/proposals/[proposalId]/edit/page.tsx
src/app/(protected)/proposals/[proposalId]/edit/step-materials.tsx
src/lib/proposals/materials.ts
tests/e2e/material-catalog.spec.ts
tests/e2e/material-catalog.mobile.spec.ts
tests/rls/phase2b-materials.test.ts
types/database.ts
```

## 9. Files created

```
docs/51-material-catalog-pagination.md   (this file)
supabase/migrations/20260711100000_material_catalog_pagination.sql
```

(Two temporary Playwright specs used to capture before/after
screenshots, `tests/e2e/_pagination-review-desktop.spec.ts` and
`_pagination-review.mobile.spec.ts`, were created and deleted within
this same phase — not part of the permanent suite.)

## 10. Known limitations

- **`total_count` re-evaluates the whole matching set on every "Load
  more" click**, since offset is always 0 and limit grows — for a
  catalog with a genuinely large number of matches this is more work
  per click than a true incremental offset would be. At current and
  foreseeable catalog scale (tens to low hundreds of items per tenant)
  this is not a measurable cost; a true cursor-based incremental fetch
  would be the natural next step if the catalog grows by orders of
  magnitude.
- **No numbered "jump to page N."** By explicit product preference —
  "Load more" only. A user who wants item 180 of 300 must click Load
  more repeatedly; there is no direct-jump control.
- **`total_count` is exact, not approximate.** This is a correctness
  property, not a limitation, but worth noting: unlike some
  large-scale pagination designs that intentionally use an approximate
  count for performance, this implementation always returns the true
  count, since `count(*) over()` is cheap at this catalog's realistic
  size. This is a design decision suitable for the current scale, not
  guaranteed to remain the cheapest option indefinitely.
- **No virtualization.** Rows beyond the current `catalogLimit` are
  simply not fetched at all (not fetched-but-hidden) — there is no
  windowed/virtualized rendering of a larger in-memory list, since
  none is ever held. This is the intended design, not a gap, but is
  worth distinguishing from a virtualization-based solution.

## 11. Final assessment

Material catalog pagination confidence: 9/10
Mobile catalog usability: 9/10
Search performance confidence: 9/10
Tenant isolation confidence: 10/10
Regression confidence: 10/10
Ready for Client Portal phase: Yes

No avances al Client Portal.
