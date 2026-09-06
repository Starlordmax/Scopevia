# 44 — Material Catalog RLS Verification

Status: **Real Postgres, not mocked.** Same infrastructure discipline as
[35](35-phase-2a-rls-verification.md) — the dedicated `scopevia-test`
Supabase project, fresh users/tenants per run, real RPC calls.

## Environment

| | |
|---|---|
| Database | `scopevia-test` (ref `msduefaopvxfjqktjymo`) |
| Test runner | Vitest, `tests/rls/phase2b-materials.test.ts` |
| Logical users | Owner A (Tenant A), Owner B (Tenant B, cross-tenant target), Estimator, Sales, Viewer, Admin (used for the suspended-session case) — all created fresh per run |

## Results

| Suite | Tests | Result |
|---|---|---|
| `tests/rls/phase2b-materials.test.ts` (new, this phase) | 27 | PASS |
| Full `tests/rls/*` suite (all phases) | 200 | PASS, zero regressions |
| `npm run test` (unit) | 107 | PASS |
| `npx playwright test` (E2E, desktop + mobile) | 64 | PASS |

(One `AuthApiError: Request rate limit reached` was observed on a full
`npm run test:rls` run immediately following the full Playwright E2E
suite — both create many throwaway auth users in a short window. Re-run
of the affected file alone passed cleanly (64/64); not a real failure,
not a regression, the same class of flakiness already documented in
[docs/35](35-phase-2a-rls-verification.md).)

## What `phase2b-materials.test.ts` covers

**Demo seed data**: 26+ global materials exist; Interior Paint has
`manual_seed` prices for all 4 demo ZIPs.

**Catalog search & ZIP price fallback**: exact ZIP match (Interior Paint
at 33101 = $42.00); category filter narrows correctly; the state
fallback tier resolves Waterproof Membrane at 33101 (FL) but not at
78701 (TX) — proving the tier is genuinely state-scoped, not a blanket
fallback; the ZIP/state-agnostic default resolves Sandpaper Pack at a
ZIP outside the 4 seeded demo ZIPs; Construction Debris Disposal never
gets an invented price at any ZIP.

**Cross-tenant integrity** (`service_role`/RPC, bypassing every
application-level check):

- A tenant's custom material is invisible to another tenant via
  `search_material_catalog()`, and `search_material_catalog()` itself
  rejects a `p_tenant_id` the caller doesn't belong to.
- A `service_role` raw insert attempting a price for Tenant A's
  material under Tenant B is rejected by
  `prevent_cross_tenant_material_price()` (`23514`).
- A `proposal_line_item` cannot reference another tenant's custom
  material, even via `service_role` raw insert — rejected by
  `prevent_cross_tenant_material_reference()` (`23514`).
- `create_tenant_material_price()` rejects a material belonging to
  another tenant.

**Permission matrix**: Viewer cannot create or archive a tenant
material; Estimator can create a tenant material; nobody (not even
Owner) can edit the global catalog via `update_tenant_material()`;
Sales can add a catalog item to a proposal at the catalog price
(`proposals.update` only) but is rejected when attempting a price
override (`proposals.manage_pricing` required); Owner (has
`manage_pricing`) can override; adding a catalog item with no available
price is rejected outright rather than defaulting to zero.

**Snapshot pricing**: adding a catalog item recalculates the version's
totals server-side; a later direct price change (via `service_role`,
simulating a future catalog update) never retroactively changes an
already-added line item's `unit_price_cents`/`line_total_cents`;
changing the proposal's pricing ZIP only affects materials added
afterward — the first item's price and `source_zip_code` are
unaffected.

**Proposal archive/restore — additional coverage** (beyond
[docs/35](35-phase-2a-rls-verification.md)'s existing round-trip test):
Tenant B cannot archive Tenant A's proposal; a suspended user's existing
session cannot archive (same pattern as
`tests/rls/phase1-restore.test.ts`); archiving writes a real
`audit_logs` row and never deletes line items.

## A real security bug found and fixed by this suite

`find_material_zip_price()` was initially granted `EXECUTE` to
`authenticated` directly. It performs no permission check of its own
(by design — it's an internal helper called by
`search_material_catalog()`/`add_proposal_line_item_from_catalog()`,
both of which already gate on a tenant_id the caller has proven access
to before calling it). Granting it directly meant any authenticated
user could call it with an **arbitrary** `p_tenant_id` and read that
tenant's own tenant-owned price overrides — exactly the cross-tenant
leak this phase's brief explicitly requires never happen.

Caught by this suite's "state fallback" test attempting a direct call
and asserting it should be rejected — the test initially expected
success and failed with a real result, which is what prompted tracing
the grant back to the bug. Fixed in
`20260708120600_material_catalog_security_fix.sql`:
`revoke execute on function public.find_material_zip_price(uuid, uuid, text) from authenticated;`
— `SECURITY DEFINER` functions execute as their owner when calling
another function internally, so this revoke does not break
`search_material_catalog()`/`add_proposal_line_item_from_catalog()`.
Verified: the direct-call test now asserts (and gets) a rejection, and
every test that exercises the fallback tiers *indirectly* (via
`search_material_catalog()`) still passes.
