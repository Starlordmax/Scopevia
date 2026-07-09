# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Phase 2B — Material catalog by ZIP code, and proposal delete/archive

Adds a browsable, ZIP-priced material catalog to the Materials & Costs
step: enter a ZIP code, search/filter the catalog, add a material at
its resolved local price (or a state/default fallback — never an
invented price), and every added item **snapshots** its price
permanently — a later catalog price change never retroactively changes
an existing proposal. Two new tables (`material_catalog_items`,
`material_zip_prices`), 8 new permissions (`materials.*`,
`material_prices.*`), a global-vs-tenant RLS pattern (mirroring the
existing `roles.is_system` precedent), and a dedicated cross-tenant
integrity trigger where the standard composite-FK pattern can't express
a nullable-tenant global row. 26 seeded global materials across paint,
bathroom remodeling, and flooring, priced at 4 demo ZIPs — all
explicitly fictional/demo data, no scraping, no real supplier
integration. See [docs/42-material-catalog-by-zip.md](docs/42-material-catalog-by-zip.md).

Also relabels proposal "Archive" to "Delete proposal" in the UI
(internally unchanged — still the same `archive_proposal()`/
`restore_proposal()` functions from Phase 2A, never a hard delete), adds
a required confirmation dialog with exact copy, moves it into a
collapsed "Danger zone" section instead of the primary action row, and
replaces the proposals list's binary Active/Archived toggle with a real
three-way Active/Archived/All filter. See
[docs/43-proposal-delete-archive.md](docs/43-proposal-delete-archive.md).

A real cross-tenant security bug was found and fixed by this phase's
own RLS test suite before shipping: an internal price-lookup helper
(`find_material_zip_price()`) was mistakenly grantable directly to any
authenticated user, which would have let a caller pass an arbitrary
tenant id and read that tenant's private price overrides. See
[docs/44-material-catalog-rls-verification.md](docs/44-material-catalog-rls-verification.md).

No Client Portal, email, PDF, Stripe, payments, AI, or scraping work —
out of scope for this phase.

### Phase 2A.3 — Pricing Summary "$0.00" root cause found: unsaved-preview vs. saved-total clarity

Found the actual cause of the reported "Pricing Summary shows $0.00"
issue: not a data persistence or recalculation defect (proven via 3 new
tests reading raw database rows directly — labor/line-item totals and
`proposal_versions` totals all update correctly on every save, verified
against real Postgres), but a real UX ambiguity. Before a labor/cost
item is saved, the Add form's live preview (e.g. "$280.00") and the
already-persisted total (correctly "$0.00", since nothing has been
saved yet) were both visible at once with similar labels — easy to read
as contradictory rather than as "unsaved draft" vs. "what's actually in
the proposal."

Fixed by making the distinction impossible to miss: the preview tile now
reads "Not saved yet. Click '+ Add labor item' below to save it." with a
distinct dashed warning-colored style; the saved-items table moved under
an explicit "Saved labor" / "Saved costs" heading positioned after the
add form; the persisted-total hint text is now "Saved labor total:" /
"Saved materials & costs subtotal:"; the Add button is now
primary-styled. No calculation, persistence, or Pricing Summary data
source changed — this is a legibility fix for an already-correct system.
See [docs/40-proposal-total-refresh-fix.md](docs/40-proposal-total-refresh-fix.md#round-2-definitive-db-proof-and-the-actual-ux-fix).

### Phase 2A.2 — Fixed labor pricing, Pricing Summary investigation, photo gallery UI

Adds a second labor pricing mode to the Proposal Builder: alongside the
existing hourly calculation (workers × days × hours/day × rate), a
contractor can now enter labor as a single **Fixed price** (e.g. "$700"
for a bathroom remodel) with no hourly breakdown required. A new
`pricing_method` column on `proposal_labor_items` (`'hourly'` default,
`'fixed'` new) drives which fields apply; both modes are validated and
computed exclusively server-side, and every existing labor item remains
unaffected (`'hourly'` by default, no data rewritten). See
[docs/39-fixed-labor-pricing.md](docs/39-fixed-labor-pricing.md).

Investigates a reported "Pricing Summary shows $0.00 after adding labor
and materials" bug: traced the full save → recalculate → read → display
path (SQL functions, `getFullProposal`, `revalidatePath`, the client
Router Cache's actual Next.js 16 defaults) and reproduced the reported
scenario live, multiple ways, against a running build — found no code
defect. Documented honestly as investigated-not-reproduced rather than
claimed fixed, with the most plausible explanation (preview-vs-saved
confusion in the Add Labor/Add Line Item forms, likely worsened by the
previous lack of a fixed-price option) and 18 new automated tests (13
RLS + 5 E2E) closing the coverage gap that let this scenario go
untested before. See
[docs/40-proposal-total-refresh-fix.md](docs/40-proposal-total-refresh-fix.md).

Gives the photo "Upload" button a distinct green (`.button-success`)
style with context-specific text ("Upload job photo" / "Upload portfolio
photo"), and replaces every full-size photo display (current-job,
previous-work, Portfolio, the Portfolio picker — which previously showed
no image at all) with a responsive thumbnail grid (`.photo-grid`/
`.photo-card`/`.photo-thumb`, capped height, 2 columns on narrow mobile
viewports) so a photo can no longer fill the entire builder screen. See
[docs/41-photo-gallery-ui-fix.md](docs/41-photo-gallery-ui-fix.md).

### Phase 2A.1 — Job Summary RPC fix and navigation simplification

Fixes a real bug where saving the Proposal Builder's Job Summary step
with any optional field left blank failed with a raw "Could not find the
function ... in the schema cache" error, caused by the client omitting
empty fields (serialized as JSON `undefined`, which `JSON.stringify`
drops) instead of sending them as `null`, combined with
`update_proposal_scope` having no SQL `DEFAULT` on any optional
parameter. Fixed on both sides: the SQL function now accepts
`DEFAULT NULL` on all four optional parameters, and the client always
sends every optional key explicitly (as `null` when empty, never
omitted). See [docs/37-proposal-scope-rpc-fix.md](docs/37-proposal-scope-rpc-fix.md).

Also removes Pipeline and Projects as visible UI modules — the
underlying `opportunities`/`projects` tables, RPCs, and RLS are
completely untouched. `/pipeline` and `/projects` (and its children) now
redirect to `/proposals` rather than rendering. Client detail's
Projects/Opportunities sections are replaced by a Proposals section
("Create proposal" is now its primary action); Opportunity detail's
"Convert to project" legacy CTA is removed (reversing a Phase 2A
decision). Navigation is now Dashboard/Proposals/Clients/Portfolio
(main) + Members/Proposal Settings/Profile (Administration); mobile adds
a 5th "More" bottom-nav slot (an in-page disclosure, not a new route)
that also fixes a pre-existing gap where Members/Proposal Settings had
no mobile entry point at all. See
[docs/38-navigation-simplification.md](docs/38-navigation-simplification.md).

### Phase 2A — Proposal-centric pivot

Pivots the primary product flow from Client → Opportunity → Project →
*(future Estimate)* to Client → Opportunity → **Proposal** →
*(future Sent/Viewed/Accepted)* → Project. A contractor can now build a
professional proposal — scope, a labor calculator, materials & costs,
current-job and reusable previous-work (Portfolio) photos, discount/tax,
and a live preview — without ever creating a Project first. See
[docs/29-proposal-centric-product-pivot.md](docs/29-proposal-centric-product-pivot.md)
for the full pivot and
[docs/35](docs/35-phase-2a-rls-verification.md)/[docs/36](docs/36-phase-2a-e2e-verification.md)
for test evidence.

**Added**

- `proposals`, `proposal_versions`, `proposal_sections`,
  `proposal_labor_items`, `proposal_line_items`, `media_assets`,
  `portfolio_projects`, `portfolio_project_media`, `proposal_media`,
  `tenant_proposal_settings` tables — full composite-FK cross-tenant
  integrity (ADR 0007 pattern), verified with real `service_role` raw
  inserts. See [docs/30](docs/30-phase-2a-proposal-data-model.md).
- One new opportunity status, `proposal_in_progress`, added alongside
  (not replacing) Phase 1's 8 states — see ADR 0025.
- A deterministic, server-only calculation engine: labor
  (`workers × days × hours/day × rate`), materials/costs
  (`quantity × unit price`), discount (fixed/percentage, capped at
  subtotal), tax (labor always taxable, discount prorated between taxable
  and non-taxable amounts) — see
  [docs/32](docs/32-proposal-calculation-engine.md) and ADRs 0030/0031.
  Verified impossible to manipulate: no `UPDATE` grant exists on any
  pricing table.
- A private `scopevia-media` Storage bucket (10 MB limit,
  JPEG/PNG/WebP only, RLS-equivalent tenant-scoped policies on
  `storage.objects`, signed URLs only, no public URLs) — see
  [docs/33](docs/33-media-and-storage-security.md) and ADR 0033.
- 20 new permission keys and a Phase 2A role matrix — Sales can create/
  edit proposal scope but not pricing by default; Field Worker can upload
  current-job photos but not manage pricing/terms/ready/archive.
- A 7-step, mobile-first Proposal Builder (`/proposals/new`,
  `/proposals/[id]/edit?step=…`) — Client & Job, Scope of Work, Labor,
  Materials & Costs, Photos, Terms & Pricing, Review — with a
  non-authoritative live-preview calculation mirror
  (`src/lib/proposals/calculations.ts`) and a shared, professional
  document component used by both the Review step and the standalone
  `/proposals/[id]/preview` route. See
  [docs/34](docs/34-proposal-builder-ux.md).
- A reusable Portfolio module (`/portfolio`) for previous-work photos,
  selectable from the Proposal Builder's Photos step without duplicating
  files.
- `/settings/proposals` — tenant-wide proposal defaults (hourly rate,
  hours/day, tax rate, validity, number prefix, terms, exclusions).
- Dashboard rebuilt around Proposals: draft/ready/sent/accepted counts,
  total quoted value, a real (not invented) "needs follow-up" signal, and
  a recent-proposals table — replacing the Phase 1 opportunity/project
  metric tiles.
- Navigation restructured: Proposals added to the primary nav and mobile
  bottom bar (capped at 5 items per design constraint); Members/Proposal
  Settings/Profile grouped under a new "Administration" sidebar section.
- The Opportunity detail page now shows a Proposal section (Create/Open
  proposal) as the primary action; "Convert to project" demoted to a
  labeled legacy/secondary flow, kept fully functional.
- `create_project_from_accepted_proposal()` — architecture prep for the
  future Client Portal phase, not exposed in the UI, tested via a
  controlled service-role preparation rather than a faked acceptance flow
  (ADR 0034).
- `tests/rls/phase2a-proposals.test.ts` (34 cases) and
  `tests/rls/phase2a-storage.test.ts` (14 cases) against the real
  `scopevia-test` project and its real Storage bucket.
- `tests/unit/proposal-calculations.test.ts` (23 cases) for the
  calculation engine mirror.
- `tests/e2e/proposals.spec.ts` and `tests/e2e/proposals.mobile.spec.ts`.
- ADRs 0025–0034.

**Fixed** (found via real testing, not code review)

- `formatCents()` rendered money inconsistently between Server and Client
  Components (`"USD 2,400.00"` server-side vs `"$30.00"` client-side) —
  `toLocaleString(undefined, …)` resolves to whatever locale the current
  runtime defaults to, which differs between Node and the browser. Pinned
  to `"en-US"` explicitly.
- A newly-regenerated `types/database.ts` surfaced a pre-existing
  generator limitation in `src/lib/audit/log.ts`: `log_audit_event`'s
  `p_tenant_id`/`p_actor_user_id` are typed non-nullable even though
  Postgres accepts `NULL` for either — documented, narrow cast, same
  pattern as the existing `p_metadata` cast.
- A test-authoring bug (not an app bug) where `page.waitForURL()`'s
  default `waitUntil: "load"` never resolves for a Server-Action-driven
  cross-route redirect — the same class of race already documented for
  the Phase 1.6 tenant-switching fix, now generalized: assert on the
  resulting page's real content, not a navigation lifecycle event.

### Phase 1.5 — Real browser E2E verification and restore coverage

Closed the two gaps flagged in
[docs/24-phase-1-manual-testing.md](docs/24-phase-1-manual-testing.md):
a real Playwright browser walkthrough of the Phase 1 UI, and dedicated
automated coverage for the five restore operations. See
[docs/25-phase-1-e2e-verification.md](docs/25-phase-1-e2e-verification.md)
for full results.

**Fixed** (all found via real browser testing, not code review)

- **Critical**: the tenant-switcher `<select onChange={...}>` was rendered
  directly inside a Server Component (`(protected)/layout.tsx`) — React
  forbids event handlers on host elements there. Any signed-in user
  belonging to 2+ tenants got a 500 on every protected page, since Phase 0.
  Extracted into `src/app/(protected)/tenant-switcher.tsx`, a Client
  Component.
- Cross-tenant data exposure: `/clients/[id]`, `/clients/[id]/edit`,
  `/opportunities/[id]`, `/projects/[id]`, `/projects/[id]/edit` fetched
  their row by id alone with no `tenant_id` filter, relying entirely on
  RLS — which checks the row's own tenant, not the caller's active tenant.
  A user in two tenants with overlapping permissions could load another
  tenant's record via a stale URL. Added the missing tenant filter to all
  five queries.
- RPC error messages (e.g. `"Missing permission: opportunities.archive"`,
  `"... uses archive_opportunity()/restore_opportunity() instead"`) were
  shown to users unsanitized, exposing internal permission-key and
  function names. Added `src/lib/errors/friendly-message.ts`, applied at
  every RPC-error-to-banner call site in the Phase 1 action files.
- Accessibility: the tenant-switcher `<select>` had no label at all —
  added `aria-label="Switch business"`.
- A flaky `tests/rls/*.test.ts` timeout under real network latency (5s
  default) — raised `testTimeout`/`hookTimeout` to 15s in
  `vitest.config.ts`.

**Added**

- `tests/e2e/` — a Playwright suite (48 tests, 9 spec files) covering
  authentication, Clients, Contacts, Opportunities, Pipeline (desktop +
  real 390×844 mobile viewport), Projects (conversion idempotency,
  address primary-switching), Notes/Activities, and permissions
  (Viewer/Sales/Field Worker/tenant switching, including a manipulated
  tenant-id rejection test) — stable at 48/48 across three consecutive
  full runs, against a production build and the real `scopevia-test`
  database.
- `tests/rls/phase1-restore.test.ts` — 27 new cases covering
  `restore_client`/`restore_client_contact`/`restore_opportunity`/
  `restore_project`/`restore_project_address`: correct-permission restore,
  safe no-op on non-archived resources, Viewer/cross-tenant/suspended-user
  rejection, audit/activity logging accuracy, and two concurrency races
  (simultaneous restores; archive-vs-restore).
- `playwright.config.ts` — desktop + mobile projects, an auth setup
  project with real UI logins reused via `storageState`, trace-on-failure,
  screenshot-on-failure, no retries (so a pass means it actually worked).

### Phase 1 — CRM & Projects

Built the CRM/pipeline module on top of the verified Phase 0 foundation:
Clients → Contacts → Opportunities → Projects → Project Addresses, plus
notes and a system-generated activity timeline. See
[docs/20-phase-1-crm-and-projects.md](docs/20-phase-1-crm-and-projects.md)
for full scope and design decisions, and
[docs/23-phase-1-rls-verification.md](docs/23-phase-1-rls-verification.md)
for real test-run evidence (68/68 combined Phase 0 + Phase 1 RLS/integration
tests passing against the `scopevia-test` Postgres project, zero
regression).

**Added**

- `clients`, `client_contacts`, `opportunities`, `projects`,
  `project_addresses`, `crm_notes`, `crm_activities` tables, each
  tenant-isolated via RLS **and** declarative composite foreign keys
  (`(child_id, tenant_id) references parent (id, tenant_id)`) — not RLS
  alone. See ADR 0007.
- 27 new permission keys and an extended per-role grant matrix, with
  deliberate asymmetries (Estimator can't originate opportunities, Sales
  can't update projects after handoff, Field Worker gets tenant-wide
  `projects.view` with no per-assignment scoping — documented as a real
  limitation, not faked).
- Opportunity and project state machines, each enforced exclusively
  inside a `SECURITY DEFINER` SQL function via an explicit transition
  table — `lost`/`cancelled` are reactivable rather than terminal;
  archiving is a separate function/permission from ordinary pipeline
  movement. See ADR 0011/0012.
- `convert_opportunity_to_project()` — atomic, idempotent conversion
  (row lock + unique index + exception-handler backstop); safe to retry,
  never duplicates. See ADR 0013.
- Concurrency-safe "exactly one primary" enforcement for client contacts
  and project addresses (`set_primary_contact()`,
  `set_primary_project_address()`), backed by partial unique indexes as
  the declarative ground truth, not just application logic.
- `crm_notes` (human-authored, mutable, archivable) and `crm_activities`
  (system-generated, append-only, trigger-enforced) as two distinct
  tables using an "exclusive arc" pattern (nullable, individually
  composite-FK'd `client_id`/`opportunity_id`/`project_id` columns)
  rather than per-entity table duplication or an unsafe
  `entity_type`/`entity_id` polymorphic pair. Kept explicitly separate
  from the Phase 0 `audit_logs` security trail. See ADR 0008.
- Mobile-first pipeline Kanban board (`/pipeline`) that collapses to a
  vertical stack below 640px, with an explicit tap-based status-advance
  control — no drag-and-drop dependency.
- Dashboard metrics and a recent-activity feed on the protected home page.
- `src/lib/search.ts` — two-layer escaping (SQL `ILIKE` wildcards, then
  PostgREST `.or()` filter syntax) before any user search input reaches a
  Supabase query.
- `types/enums.ts` — hand-maintained literal unions for the text+CHECK
  "enums" that `supabase gen types` cannot capture.
- Regenerated `types/database.ts` from the real linked `scopevia-test`
  project via `npm run db:types`.
- `tests/rls/phase1-crm.test.ts` (28 cases: tenant isolation, cross-tenant
  FK rejection via a raw `service_role` insert, the full permission
  matrix, concurrency races, state machine guards, notes/activity/audit
  separation) and `tests/unit/crm-validation.test.ts` (34 cases: Zod
  schemas, both transition maps).
- Migration `20260702131200_crm_update_functions_nullable_defaults.sql` —
  a forward-fix (never edited the already-applied originals) adding
  `default null` to several `update_*` functions' optional parameters,
  needed for correct nullable-vs-required typing after regenerating
  Supabase types.
- `docs/20` through `docs/24`, and ADRs 0007–0013.

### Phase 0.5 — Security hardening & verification

Reviewed the Phase 0 implementation before allowing it to proceed to Phase 1: audited every `SECURITY DEFINER` function, verified the actual RLS/permission/concurrency behavior against a real Postgres instance (not just manual SQL review), and fixed everything the review found. See [docs/18-phase-0-security-hardening.md](docs/18-phase-0-security-hardening.md) and [docs/19-phase-0-verification-evidence.md](docs/19-phase-0-verification-evidence.md).

**Fixed**

- `protect_last_owner()`: closed a race condition where two concurrent transactions demoting/suspending two different owners could both succeed, leaving a tenant with zero owners. Now locks the tenant row first, serializing membership mutations per tenant.
- `update_membership()`: closed a privilege-escalation path found during this review — an Admin (holding only `members.update`) could promote any member straight to Owner. Granting the `owner` role now requires `roles.manage` (Owner-only).
- `invite_member_by_email()`: no longer grants immediate `active` access. Memberships are created as `invited` (zero access under every existing RLS policy) until the invited user calls the new `accept_invitation()` themselves.

**Added**

- `accept_invitation()`, `get_pending_invitations()` — self-service invitation acceptance; "Pending invitations" section on `/select-tenant`.
- `validate_membership_role_tenant()` trigger — guarantees a membership's role is either a global system role or belongs to its own tenant, ahead of the (not yet built) custom-roles feature.
- `pickActiveTenant()` extracted as a pure, unit-tested function proving cookie manipulation can never grant access to a foreign tenant.
- Expanded `tests/rls/tenant-isolation.test.ts` from 10 to 40 cases: invitation consent, suspension/removal revoking an already-issued session immediately, cross-tenant role guards, tenant-creation concurrency, and the last-owner concurrency race specifically.
- Migration `20260701121000_security_hardening.sql`.
- `docs/18-phase-0-security-hardening.md`, `docs/19-phase-0-verification-evidence.md`.
- Git version control initialized; base commit created after a secret scan of all staged files.

### Phase 0 — Foundations

Initial implementation: project scaffolding, Supabase integration, authentication, multi-tenancy, roles/permissions, Row Level Security, onboarding, and the protected application shell. No product features (CRM, estimating, proposals, payments) yet — see [docs/14-phase-0-foundations.md](docs/14-phase-0-foundations.md) for full scope and design decisions.

**Added**

- Next.js 16 (App Router) + TypeScript + React 19 project scaffold, mobile-first plain CSS.
- Supabase client separation: browser, server, middleware, admin (`src/lib/supabase/`).
- Email/password authentication: sign up, sign in, sign out, forgot/reset password, email confirmation callback.
- `profiles` table auto-provisioned from `auth.users` via trigger.
- Multi-tenancy: `tenants`, `tenant_memberships`, with a cookie-hinted, server-revalidated active tenant.
- RBAC: `roles`, `permissions`, `role_permissions`, seeded with 6 system roles and 9 permissions.
- Row Level Security on every table, deny-by-default; mutations routed through `SECURITY DEFINER` functions (`create_tenant_with_owner`, `update_membership`, `invite_member_by_email`, `log_audit_event`).
- Defense-in-depth triggers: last-owner protection, self-modification prevention, append-only audit log enforcement.
- Append-only audit trail (`audit_logs`) covering tenant/membership/profile lifecycle events.
- Onboarding flow (create business), tenant selector, protected app shell with a Phase 0 verification panel, profile page, members page (view/invite/update role/suspend/remove, permission-gated).
- Route protection via `proxy.ts` (Next.js 16's successor to `middleware.ts`).
- Versioned SQL migrations, runnable from an empty database (`supabase/migrations/`).
- Unit tests (validation schemas, permission keys) and an integration test suite proving tenant isolation (`tests/rls/`, requires local Supabase via Docker).
- Documentation: `docs/14` through `docs/17`, and ADRs 0001–0006.
