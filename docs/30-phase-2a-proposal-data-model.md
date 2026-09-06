# 30 — Phase 2A Proposal Data Model

Status: **Implemented**, 10 new tables plus one idempotency ledger, all
migrated in `supabase/migrations/20260706140000` through `20260706141800`.
See [docs/adr/0025](adr/0025-proposal-before-project.md) through
[0034](adr/0034-project-creation-after-acceptance.md) for the decisions
behind this shape.

> **Phase 2B addendum (2026-07-09):** two new tables,
> `material_catalog_items` and `material_zip_prices`, plus
> provenance-only snapshot columns on `proposal_line_items` and a
> pricing ZIP on `proposal_versions` — see
> [docs/42-material-catalog-by-zip.md](42-material-catalog-by-zip.md).

> **Phase 2C addendum (2026-07-09):** four new tables —
> `proposal_measurement_groups`, `proposal_measurements`,
> `proposal_measurement_shapes`, `proposal_measurement_materials` — plus
> two more `proposal_labor_items.pricing_method` values (`area`,
> `linear`) generated from a measurement. See
> [docs/45-measurements-takeoff-builder.md](45-measurements-takeoff-builder.md).

## Entity relationship overview

```text
tenants
  └─ tenant_proposal_settings (tenant_id, 1:1)
  └─ proposals (tenant_id; client_id, client_contact_id?, opportunity_id?)
       └─ proposal_versions (proposal_id) — exactly one version_status='draft' at a time
            ├─ proposal_sections (proposal_version_id)
            │    └─ proposal_line_items (section_id?)
            ├─ proposal_labor_items (proposal_version_id)
            ├─ proposal_line_items (proposal_version_id)
            └─ proposal_media (proposal_version_id; media_asset_id, portfolio_project_id?)

media_assets (tenant_id) — one row per uploaded file
portfolio_projects (tenant_id)
  └─ portfolio_project_media (portfolio_project_id, media_asset_id)

proposal_creation_requests (tenant_id, idempotency_key) — internal ledger only

-- Phase 2B
material_catalog_items (scope: global|tenant; tenant_id nullable)
  └─ material_zip_prices (material_catalog_item_id; tenant_id nullable)
proposal_line_items also optionally references material_catalog_items / material_zip_prices (provenance only)
```

## Tables

### `tenant_proposal_settings`

One row per tenant, created lazily by `ensure_tenant_proposal_settings()`.
`currency_code` is restricted to `'USD'` by CHECK — Phase 2A is USD-only.
`next_proposal_number` is only ever advanced by
`allocate_next_proposal_number()` under `FOR UPDATE` (see
[docs/adr/0027](adr/0027-proposal-numbering.md)).

### `proposals`

The container. `client_id` required; `client_contact_id`/`opportunity_id`
optional but validated to belong to the same client/tenant. `status` is
one of the 9 states in [docs/31](31-proposal-state-machines.md), but only
`draft`/`ready`/`archived` are reachable via any Phase 2A function.
`unique (tenant_id, proposal_number)`. A partial unique index,
`proposals_one_active_per_opportunity`, enforces at most one non-archived
proposal per opportunity.

### `proposal_versions`

Holds all commercial content (see
[docs/32](32-proposal-calculation-engine.md) for the derived totals
columns) and `version_status` (`draft`/`locked`/`superseded`). A partial
unique index, `proposal_versions_one_draft_per_proposal`, allows only one
draft at a time. Protected from post-lock mutation by two triggers — see
[docs/adr/0029](adr/0029-locked-version-immutability.md).

### `proposal_sections`, `proposal_labor_items`, `proposal_line_items`

Children of a `proposal_version`, archived (not hard-deleted) on removal.
`proposal_line_items.section_id` is optional — a line item can exist
without belonging to a specific scope section. All three are protected
from locked-version mutation by the shared
`prevent_locked_version_child_mutation()` trigger.

### `media_assets`

One row per uploaded file in the private `scopevia-media` bucket,
independent of usage (`media_type`: `current_job` | `portfolio` |
`general`) — see [docs/33](33-media-and-storage-security.md).

### `portfolio_projects` / `portfolio_project_media`

The reusable "previous work" gallery, entirely separate from the CRM
`projects` table. `location_label` is a free-text general area (e.g.
"Miami, FL"), never a full client address.

### `proposal_media`

Join between a `proposal_version` and a `media_asset`, tagged
`usage_type` (`current_job` | `previous_work`). Archiving a
`portfolio_projects` row never cascades here — see
[docs/adr/0032](adr/0032-media-asset-model.md).

### `proposal_creation_requests`

Internal idempotency ledger (`tenant_id, idempotency_key` primary key,
RLS enabled with **no policy and no grant** — deny-by-default, never
queried by the client directly). Used only by
`create_proposal_direct()`/`create_proposal_from_opportunity()`.

### `material_catalog_items` / `material_zip_prices` (Phase 2B)

See [docs/42](42-material-catalog-by-zip.md) for full detail. Briefly:
a global-vs-tenant material catalog with ZIP/state/default-tiered
pricing, cross-tenant integrity enforced by a dedicated trigger (rather
than the composite-FK pattern below, which can't express a nullable-tenant
global row), and price snapshotting into `proposal_line_items` at the
moment a material is added.

### `proposal_measurement_groups` / `proposal_measurements` / `proposal_measurement_shapes` / `proposal_measurement_materials` (Phase 2C)

See [docs/45](45-measurements-takeoff-builder.md) for full detail.
Briefly: a named grouping (`proposal_measurement_groups`) of individual
measured values (`proposal_measurements` — floor/wall/ceiling area,
linear length), an optional drawn rectangle
(`proposal_measurement_shapes`, 1:1 with a measurement), and provenance
of any catalog material generated from a measurement
(`proposal_measurement_materials`). All four denormalize both
`tenant_id` and `proposal_version_id` directly so the existing generic
`prevent_locked_version_child_mutation()` trigger and standard RLS
policy shape apply unchanged.

## Cross-tenant integrity

Every parent/child relationship uses the same composite-FK pattern
established in Phase 1 (ADR 0007): `unique (id, tenant_id)` on every
parent, `(child_id, tenant_id) references parent (id, tenant_id)` on
every child. Verified directly with `service_role` raw inserts attempting
cross-tenant references (`tests/rls/phase2a-proposals.test.ts`,
"Cross-tenant integrity") — Postgres rejects them with `23503`
regardless of any application-level check.

## Opportunity schema change

`opportunities.status` gained exactly one new value,
`proposal_in_progress` — see [docs/31](31-proposal-state-machines.md) for
why `inspection_scheduled`/`ready_for_estimate` were kept rather than
replaced, and why `proposal_sent`/a proposal-driven `won` were
deliberately not added yet.

## Functions added

| Function | Purpose |
|---|---|
| `ensure_tenant_proposal_settings` / `get_tenant_proposal_settings` / `update_tenant_proposal_settings` | Settings get-or-create, permission-checked read/write |
| `allocate_next_proposal_number` | Concurrency-safe numbering |
| `recalculate_proposal_version` | The calculation engine — see docs/32 |
| `create_proposal_direct` / `create_proposal_from_opportunity` / `create_initial_proposal_version` | Creation, with opportunity auto-creation |
| `sync_opportunity_to_proposal_in_progress` | Best-effort opportunity status sync |
| `mark_proposal_ready` / `return_proposal_to_draft` / `archive_proposal` / `restore_proposal` | Proposal lifecycle |
| `create_new_proposal_version` | Architecture prep (ADR 0028) |
| `add/update/archive_proposal_section` / `reorder_proposal_sections` | Scope sections |
| `add/update/archive_proposal_labor_item` | Labor calculator |
| `add/update/archive_proposal_line_item` | Materials & costs |
| `update_proposal_pricing` / `update_proposal_scope` | Version-level fields |
| `register_media_asset` / `attach_media_to_proposal` / `detach_media_from_proposal` | Media |
| `create_portfolio_project` / `update_portfolio_project` / `archive_portfolio_project` / `restore_portfolio_project` / `add_portfolio_project_media` | Portfolio |
| `create_project_from_accepted_proposal` | Architecture prep (ADR 0034), not exposed |
| `find_material_zip_price` / `search_material_catalog` | ZIP price fallback + catalog browse/search (Phase 2B) |
| `create/update/archive_tenant_material` / `create/update/archive_tenant_material_price` | Tenant catalog/price CRUD (Phase 2B) |
| `update_proposal_pricing_zip` / `add_proposal_line_item_from_catalog` | Version pricing ZIP + catalog-sourced line item snapshot (Phase 2B) |
| `create_measurement_group` / `add_measurement` / `update_measurement` / `archive_measurement` / `save_measurement_shape` | Measurement CRUD, manual and drawn (Phase 2C) |
| `generate_material_from_measurement` / `add_proposal_labor_item_from_measurement` | Generate a priced line item / labor item from a measurement (Phase 2C) |

Every function follows the same discipline as Phase 0/1: `auth.uid()`
required, membership/permission checked via `user_has_permission()`,
`SET search_path = public, pg_temp`, `EXECUTE` revoked from `PUBLIC` and
granted only to `authenticated` (except a handful of pure internal
helpers granted to neither — see the migration files).
