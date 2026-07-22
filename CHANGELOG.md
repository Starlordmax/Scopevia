# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Phase 3D.1 — Render Staging Deployment Prep

Prepares Scopevia to run as a Render **Web Service** (not a Static Site —
it needs Next.js SSR, Server Actions, httpOnly cookies, and the Supabase
service role, none of which a static host can run) for a closed beta.
No product features were added; this is deployment/infrastructure
preparation only.

**Added:** `/api/health` — a shallow, public health-check route (no
Supabase call, no secrets, no user data) for Render's health checker,
added to `proxy.ts`'s always-allowed paths so it's reachable without a
session; `src/lib/env-validation.ts` + `src/instrumentation.ts` — a
"fail fast, not fail quiet" startup check that refuses to boot a
production/staging server with a misconfigured email provider or missing
Supabase/`APP_BASE_URL` config, verified live against a real `next start`
process; `render.yaml` (a Blueprint with every secret marked `sync: false`
— no real values anywhere in the repo); `engines.node` and a
`predeploy:staging` script (typecheck + lint + unit tests + build).

**Reviewed and confirmed already correct, nothing weakened to "make it
deploy":** portal/tenant session cookies (`secure: true` already keys off
`NODE_ENV=production`, which `next start` sets automatically — Render's
HTTPS domains just work); no hardcoded `localhost` in any real code path;
no `next/image` usage anywhere, so no image-domain config was needed or
added; every email-related error message already excludes secrets
(confirmed by the same audit Phase 3D's delivery-security review already
did).

15 new unit tests (env validation — every required-variable and
dev-provider-in-production rule, individually and aggregated, plus a
check that error messages never echo a secret value; the health route's
response shape and non-leakage), 2 new E2E smoke tests
(`tests/e2e/health.spec.ts`, pure HTTP checks against a real running
server). Three new docs (`docs/64`–`66`): the deployment guide, the
environment-variable reference (names and where to get them, never
values), and a manual post-deploy smoke-test checklist covering the
internal, portal, and revision flows against real Resend email. No
Stripe/payments/deposits/e-signature/AI — 247/247 unit + existing
RLS/E2E suites unchanged (no product code touched). See
[docs/64](docs/64-render-staging-deployment.md),
[docs/65](docs/65-render-environment-variables.md), and
[docs/66](docs/66-staging-smoke-test-checklist.md).

### Phase 3D — Email Notifications for Client Portal Events

The contractor's team now gets a real email when a client views, accepts,
or declines a proposal — not just an in-app activity/audit trail. Sent to
every active Owner/Admin/Estimator/Sales member of the tenant (Viewer and
Field Worker excluded); a short confirmation is also sent to the client
themselves on accept/decline. A "viewed" email fires only on a session's
first view — a reload never spams a second one. Every send is deduplicated
by a hard database constraint (`unique(dedupe_key)` on the new
`proposal_notification_deliveries` table), not a best-effort check, and a
delivery failure of any kind (misconfigured provider, network error) is
caught, logged, and recorded — it never reverts the client's response or
blocks their flow.

**Added:** `proposal_notification_deliveries` (RLS: `audit.view`-gated
read, no write policy at all — every insert/update goes through the
service-role admin client); `get_proposal_notification_recipients()`
(new SECURITY DEFINER function, portal-facing discipline); a generic email
sender (`src/lib/email/send.ts`) deliberately separate from the existing
OTP-specific path, reusing `resolveEmailProvider()`/`validateResendConfig()`
unchanged; five email templates (viewed/accepted/declined + two client
confirmations); `APP_BASE_URL` env var for building the "Open in Scopevia"
link (never blocks a send if unset); one line of contractor-facing copy
on the Client Portal panel.

**Extended two existing RPCs' return shapes** (forward-fixed, `DROP` +
`CREATE`, no validation logic touched) so the TypeScript call sites could
build a notification without an extra query: `portal_get_session_context()`
now also returns `is_first_view`/`client_email`; `submit_proposal_client_response()`
now also returns `tenant_id`/`proposal_id`/`proposal_version_id`/
`client_email`/`responded_at`.

16 new unit tests (dedupe-key generation, `APP_BASE_URL` link generation
and its missing-value behavior, error sanitization, and every email
template — including an explicit "never leaks a token/session/storage
path/raw UUID" regression guard), 16 new RLS/integration tests (recipient
selection excluding Viewer/Field Worker/suspended/removed/invited-only/
cross-tenant, the dedupe constraint itself, full RLS coverage, and the two
RPCs' new fields), 4 new E2E scenarios (viewed notification + no-spam-on-
reload, accepted notification to both team and client, declined
notification with the reason, and a mobile accept flow with no horizontal
overflow) — all against `EMAIL_PROVIDER=dev`'s local capture, never a real
provider. No PDF attachments, Stripe, payments, deposits, e-signature, or
retry queue — 232/232 unit + 377/377 RLS + 100/100 E2E, zero regressions.
See [docs/62](docs/62-proposal-email-notifications.md) and
[docs/63](docs/63-notification-delivery-security.md) for the full writeup.

### Phase 3C — Proposal PDF / Print Export

A professional, printable version of a proposal, exportable from both the
contractor app and the Client Portal — via print-to-PDF (the browser's
own "Print → Save as PDF"), not a server-generated PDF file. `ProposalDocument`
(already control-free and internal-ID-free since Phase 2A) is reused
verbatim; two new dedicated, bare-layout routes —
`/proposals/[id]/print` (contractor, plus `?version=<id>` for a historical
version via a new "Print" link on each Version History row) and
`/p/[token]/print` (Client Portal) — render it alongside a "Print / Save
as PDF" button, with zero app-shell/portal chrome. A new print stylesheet
(`@media print` in `globals.css`) handles page breaks, table/photo sizing,
and hides every on-screen-only control.

**Added:** `getFullProposal()` gained an optional `versionId` parameter
(defaults to current — every existing caller unaffected), validated
against `proposal_id` before use, never trusted blindly; a Client Response
section on `ProposalDocument` (accepted/declined, with a footnote that
explicitly does not claim legal e-signature validity); a photo-unavailable
fallback for any signed URL that fails to generate (benefits every
existing caller of `ProposalDocument`, not just the new export routes);
`src/lib/proposals/export-copy.ts` (unit-testable export document copy);
`PrintButton` (`src/components/print-button.tsx`).

**Version safety, the point of this phase**: an export always shows the
exact version it's bound to, never "whatever is current." This required
zero new SQL — the portal export reuses `portal_get_session_context()`
completely unmodified, inheriting Phase 3B.1's historical-version fix for
free; the contractor export's only new logic (the `versionId` parameter
above) is covered by a dedicated cross-proposal-id-confusion test.
Verified end-to-end: decline → contractor creates a revision → edits →
marks ready → creates a new link — the OLD link's export still shows the
OLD declined content, the NEW link's export shows the revised content with
no response yet recorded.

11 new unit tests (`export-copy.test.ts`), 11 new RLS/integration tests
(`phase3c-proposal-export.test.ts` — ownership, cross-tenant isolation,
cross-proposal version-id confusion, revoked/expired/archived rejection,
old-link/new-link version resolution across a revision, response-to-exact-
version attachment), 6 new E2E scenarios (contractor export content +
control-free + no internal IDs, printing a specific historical version
from Version History, portal export before/after accepting, the old-link/
new-link revision-safety flow, and two mobile checks for the export button
and no horizontal overflow). No PDF file generation, Stripe, payments,
deposits, e-signature, or email notifications — 203/203 unit + 361/361 RLS
+ 96/96 E2E, zero regressions. See
[docs/60](docs/60-proposal-pdf-print-export.md) and
[docs/61](docs/61-export-version-safety.md) for the full writeup.

### Phase 3B.1 — Proposal Revision / New Version Flow

Closes the loop Phase 3B deliberately left open: once a client accepts or
declines, that exact `proposal_version` is locked forever — correct, but
until now there was no way forward. A contractor can now click "Create
revised version" (declined) or "Create new revision" (accepted, behind an
explicit strong-warning confirmation dialog) on the proposal detail page.
`create_proposal_revision()` copies the locked version's sections, labor
(every pricing method — hourly/fixed/area/linear), materials (including
full catalog-snapshot provenance), measurements/shapes/generated-materials,
photos, and terms into a brand-new editable draft version; the old version
moves from `locked` to `superseded` and stays exactly as the client left
it, forever, with their response still attached to it. `proposals.status`
returns to `draft` — no new status literal was invented; the UI shows
"— Revision in progress" whenever `version_number > 1`. The old portal
link keeps resolving the old, superseded version's content; the contractor
must mark the new version ready and create a fresh link before sending it
again. A new "Version history" section on the proposal detail page lists
every version, its response (if any), and its portal link status.

**Added:** `create_proposal_revision(p_proposal_id)` (SECURITY DEFINER,
`proposals.create_revision` permission — Owner/Admin/Estimator/Sales, not
Viewer/Field Worker); a "Version history" table
(`getProposalVersionHistory()`, `VersionHistoryPanel`); declined/accepted
revision cards on the proposal detail page; a locked-version banner in the
builder when navigating directly to a responded-to proposal's edit page;
`src/lib/proposals/revision-copy.ts` (unit-testable UI copy); one new audit
action (`proposal.revision_created`) and one new CRM activity
(`proposal_revision_created`).

**Fixed two real gaps found while designing this phase, before either ever
reached a test run:** (1) `prevent_locked_proposal_version_mutation()`/
`prevent_locked_version_child_mutation()` (Phase 2A) only ever protected a
version while `version_status = 'locked'` — the instant a row became
`'superseded'` (never reachable from the UI before this phase), its
trigger-level immutability silently disappeared. Forward-fixed to treat
`locked` and `superseded` identically. (2) `portal_get_link_info()`/
`portal_request_otp()`/`portal_get_session_context()` all gated on the
proposal's *current* status — the instant a revision moved
`proposals.status` back to `draft`, an OLD portal link (still bound to the
old, superseded, perfectly-intact version) would have become unreachable,
breaking "old links keep showing old content" entirely. Forward-fixed to
validate the link's own bound version instead of always the proposal's
current status.

19 new RLS/integration tests (`phase3b1-proposal-revision.test.ts` — full
content-copy correctness across every table/pricing-method, old-version-
superseded, old-response-stays-with-old-version, new-version-has-no-
response, old-link-still-resolves-old-content, new-link-points-at-new-
version, state gating, cross-tenant isolation, permission matrix, audit/
activity trail), 6 new unit tests (`revision-copy.test.ts` plus additions
to `status-badge.test.ts`), 3 new E2E scenarios (full desktop decline →
revise → edit → mark ready → new link → old link still shows old,
accepted-revision confirmation dialog, and a mobile version verifying no
horizontal overflow in the builder and version history). No PDF, Stripe,
payments, deposits, e-signature, or contractor/client email notifications —
200/200 unit + 350/350 RLS + 90/90 E2E, zero regressions. See
[docs/58](docs/58-proposal-revision-flow.md) and
[docs/59](docs/59-proposal-version-history.md) for the full writeup.

### Phase 3B — Client Portal Accept/Decline

The first real client action inside the Client Portal: a client viewing a
proposal at `/p/[token]/view` can now **accept** (typed name + a
confirmation checkbox + a confirm dialog) or **decline** (an optional
reason + a confirm dialog) it, right there. The response is recorded
permanently, the proposal's status updates to `accepted`/`declined`
(reserved-but-unreachable since Phase 2A), and the exact version the
client responded to is **locked** — an immutable historical record,
using the version-locking mechanism that has existed since Phase 2A but
had never been exercised in real usage until now. The contractor sees the
decision (who, when, and any decline reason) immediately, in a prominent
"Client response" card on the proposal detail page. This completes the
core Scopevia loop: create proposal → send portal link → client verifies
email → client views → client accepts/declines → contractor sees the
result.

**Added:** `proposal_client_responses` (one row per `proposal_version_id`,
ever — `unique(proposal_version_id)` is the entire duplicate-response
guard: no accept-after-decline, no decline-after-accept, no double accept,
no second link/session responding after a final decision, all from one
constraint plus a friendly pre-check); `submit_proposal_client_response()`
(SECURITY DEFINER, service-role only, re-validates the session/link/
proposal on every call exactly like every portal function since Phase
3A); `acceptProposalAction`/`declineProposalAction` Server Actions; a
`PortalResponseSection` on the portal view page (buttons → confirm forms →
a final "Proposal accepted"/"Proposal declined" state that survives
reloads); a "Client response" card on the contractor's proposal detail
page; two new audit actions (`proposal.accepted_by_client`/
`proposal.declined_by_client`) and two new CRM activities
(`proposal_accepted_by_client`/`proposal_declined_by_client`).

**Fixed a real gap found by this phase's own E2E testing**: broadening
`portal_get_session_context()` alone wasn't enough — a visitor without an
already-valid session cookie (a different device, or a lapsed cookie)
couldn't even reach the OTP step for an already-answered proposal, since
`portal_get_link_info()`/`portal_request_otp()` still gated on
`ready`/`sent` only. Forward-fixed (originals never edited) to also accept
`accepted`/`declined`, matching the view function exactly — archived-
proposal and revoked-link rejection are unaffected, since both are
independent `or` conditions, not folded into the status list. Also fixed:
a contractor-UX bug where the "Client portal" panel kept suggesting "Mark
this proposal ready..." for a proposal that had already been responded
to; and a real, pre-existing, app-wide CSS bug where every checkbox
(including the Materials step's "Taxable" toggle) inherited block-level
input styling meant for text fields, rendering as a huge, disconnected
square — found via this phase's own screenshot review, fixed with one
global `input[type="checkbox"]`/`input[type="radio"]` rule.

12 new unit tests (`portal-response-validation.test.ts`,
`status-badge.test.ts`), 28 new RLS/integration tests
(`phase3b-client-response.test.ts` — accept/decline happy paths, every
duplicate/conflict combination, revoked/expired/archived rejection,
cross-tenant isolation, RLS visibility, locked-version immutability, the
full audit/activity trail with a metadata-content assertion that no
secret ever leaks into it), 5 new E2E scenarios (accept, decline with a
reason, decline with no reason, a second session blocked after a final
response, and a mobile accept flow with no horizontal overflow). No PDF,
Stripe, payments, deposits, e-signature, questions/comments, or AI —
187/187 unit + 331/331 RLS + 87/87 E2E, zero regressions. See
[docs/56](docs/56-client-portal-accept-decline.md) and
[docs/57](docs/57-client-response-security.md) for the full writeup.

### Phase 3A.1 — Real email provider + Client Portal delivery hardening

Replaces the Client Portal's dev-only email path with a provider
abstraction: `EMAIL_PROVIDER=dev` (default, unchanged local/test capture
behavior) or `resend` (a real HTTP send via the Resend API, with a shared
HTML+text template); `sendgrid`/`smtp` are recognized names that fail
loudly as "not implemented yet" rather than silently no-op-ing.
`sendPortalCodeEmail()` remains the single public entry point every OTP
request goes through.

**Hardened:** a real production deployment can no longer silently fall
back to logging codes to a server console — `dev` is refused whenever
`NODE_ENV=production` unless the deliberately dangerous
`EMAIL_ALLOW_DEV_PROVIDER_IN_PRODUCTION="true"` is explicitly set (a
variable that only ever belongs in a gitignored `.env.local`/CI secret,
never a real deployment). A provider send failure for an authorized
request is now caught and logged server-side only — never surfaced as a
browser-visible outcome different from normal, preserving the "no revelar
si el email existe" guarantee (a naive try/catch that showed the error
would have leaked authorization status). `EMAIL_FROM`/`EMAIL_REPLY_TO`/
`RESEND_API_KEY` are validated before any send is attempted, with a clear
error naming exactly which variable is missing (never its value).

**Added:** `src/lib/email/provider-selection.ts` and `src/lib/email/
providers/resend-config.ts` — the provider-choice and Resend-config
validation logic, deliberately pure (no `server-only`, no `process.env`
access) so they're directly unit-tested; `src/lib/email/templates/
portal-code.ts` — the shared subject/text/HTML email template
(HTML-escaped business name/proposal title, no internal ids/tokens/tenant
data ever included). A discreet, contractor-only notice ("Email provider
is in development mode...") now appears on the proposal detail page's
"Client portal" section whenever the dev provider is active — never on
the public portal.

22 new unit tests (`tests/unit/email-provider-selection.test.ts`,
`tests/unit/email-template.test.ts` — provider resolution including the
full production/dev-override matrix, Resend config validation, secret
non-leakage, template completeness and HTML-escaping); two new E2E
assertions confirming the dev-mode notice's contractor-only visibility.
No RLS/integration test changes needed — the email abstraction is
entirely TypeScript/application-layer, never called from SQL, so the
existing 46 `phase3a-client-portal.test.ts` tests (unchanged) already
cover every database-layer guarantee this phase didn't touch. 175/175
unit + 303/303 RLS + 82/82 E2E (same test count, two existing tests
gained an extra assertion each), zero regressions. No real Resend send was
executed by any automated test (per the brief, to avoid calling a real
email API in CI) — manual verification with a real API key is still
required before enabling the Client Portal for real customers; see
[docs/55](docs/55-client-portal-email-delivery.md).

### Phase 3A — Client Portal with email + OTP access

A secure, view-only Client Portal: a contractor can generate a revocable
link for a **ready** proposal; the client opens it, verifies their own
email with a one-time 6-digit code (no Supabase Auth account, no
password), and views a read-only version of the proposal at `/p/[token]/
view` — the exact same `ProposalDocument` component the internal Preview
uses. Accept/decline, PDF, e-signature, Stripe/payments, and AI remain
explicitly out of scope for this phase.

**Added:** four new tables (`proposal_portal_links`, `proposal_portal_otps`,
`proposal_portal_sessions`, `proposal_view_events`), none of which ever
change `proposals.status` (see
[docs/31](docs/31-proposal-state-machines.md)); six SECURITY DEFINER
functions (`create_proposal_portal_link`/`revoke_proposal_portal_link` for
contractors, `portal_get_link_info`/`portal_request_otp`/
`portal_verify_otp`/`portal_get_session_context` for anonymous visitors,
called exclusively via the service-role admin client since a portal
visitor has no Supabase Auth session at all); three new permissions
(`proposal_portal_links.create/.view/.revoke` — Owner/Admin/Estimator/Sales
get all three, Viewer gets `.view` only); a "Client portal" section on the
proposal detail page (create/copy-once/revoke, a status/expiry/last-viewed
table); three public routes outside the app shell
(`/p/[token]` → `/p/[token]/verify` → `/p/[token]/view`); rate limiting (8
requests/link/15min, 3/link+email/15min, 5 verify attempts/code) enforced
in Postgres; a pluggable email abstraction
(`sendPortalCodeEmail()`, `src/lib/email/portal.ts`) with a dev/test
capture mode standing in for a real provider (not yet implemented — see
docs/52, "Email strategy").

**Security:** the raw link token/OTP code/session token are generated in
TypeScript and hashed (SHA-256) before ever reaching Postgres — the
plaintext never appears in a query, plan, or log line. `proposal_portal_otps`/
`proposal_portal_sessions` have RLS enabled with **zero** policies — not
even a tenant's own Owner can select them directly; they're reachable only
through the four portal-facing functions. The session cookie is httpOnly,
scoped to `/p/<token>`, and named per-link, so multiple portal sessions
never collide. A real rate-limiting gap was found and fixed during
test-writing (a non-matching email never got rate-limited, since no row
was inserted for it) — see
[docs/53](docs/53-client-portal-security.md).

46 new RLS/integration tests (`tests/rls/phase3a-client-portal.test.ts`,
46/46 passing) and 9 new E2E scenarios (8 desktop + 1 mobile, including a
full happy-path flow with real OTP-capture retrieval and 5 negative cases:
invalid token, revoked link, archived proposal, wrong code, too many
attempts, non-matching email); 153/153 unit + 303/303 RLS + 82/82 E2E, zero
regressions. Two real bugs found and fixed during verification (a wrong
env-var gate on the email abstraction, and a test-only synchronization
race) — see [docs/54](docs/54-client-portal-e2e-verification.md) for the
full writeup.

### Phase 2D.1 — Material catalog pagination & mobile search UX

The Materials & Costs step's catalog search had no pagination:
`search_material_catalog()` returned up to 200 unwindowed rows, and
`MaterialPricingPanel` rendered every one as a full add-to-proposal
card — at the ~26-item seed-catalog scale this alone produced
30,000px+ of scroll on a 390px mobile viewport.

**Added:** server-side pagination — `search_material_catalog()` now
takes `p_limit` (default 20, clamped 1–100) / `p_offset` (default 0,
clamped ≥0) and returns a `total_count` column via `count(*) over()`
(the true total match count in one query, no second round-trip).
`searchMaterialCatalog()` returns `{ items, totalCount, hasMore }`
instead of a bare array. The UI shows "Showing X of Y materials." and
a "Load more materials" button (not numbered pagination, per an
explicit product preference) that grows a `catalogLimit` query param
by 20 per click, fully server-rendered/GET-form-driven like the
existing search/category params — no Client Component fetch state.
Two indexes added in a forward migration
(`20260711100000_material_catalog_pagination.sql`):
`material_catalog_items_service_type_idx` (btree) and
`material_catalog_items_name_trgm_idx` (GIN trigram), following the
existing pg_trgm convention used for clients/opportunities/projects.

Search (name/description/brand/supplier_name), category filtering, ZIP
pricing/fallback, snapshot pricing, and proposal totals are all
unchanged — pagination only changes how many rows of an
already-computed result are returned per call.

4 pre-existing RLS tests updated (they implicitly relied on the old
unlimited default to see the full seeded catalog; now pass an explicit
`p_limit: 100`); 10 new RLS/pagination tests added
(`tests/rls/phase2b-materials.test.ts`, 45/45 passing); new desktop and
mobile E2E scenarios cover the full Load-more flow, including a
regression guard asserting mobile `scrollHeight < 15,000` (down from
the original 30,000px+ bug). No Client Portal, external APIs,
scraping, AI, PDF, Stripe, payments, or global-catalog admin UI —
out of scope for this phase. See
[docs/51](docs/51-material-catalog-pagination.md) and
[docs/42](docs/42-material-catalog-by-zip.md#pagination-phase-2d1).

### Phase 2D — Visual review & UX polish before the Client Portal

A visual/microcopy polish pass across the whole app (Dashboard, Proposals
list, every Proposal Builder step, Preview, Portfolio, mobile) — no new
backend functionality, except one real bug found and fixed along the way.

**Bug fixed:** creating a new proposal redirected to `?step=scope`
instead of `?step=measurements` — a leftover from before the
Measurements step existed, reported directly by a user testing the
flow. Fixed in `createProposalDirectAction`/
`createProposalFromOpportunityAction`; ~15 existing E2E assertions
across 7 spec files updated to match (all still pass, no coverage
lost).

**Visual/microcopy changes:** distinct icons per Dashboard stat tile
(previously all six used the same document icon); explanatory hint
text added to Measurements (Manual entry vs. Draw layout, reference-length
examples, friendlier Freehand/Rectangle mode descriptions), Labor
(Hourly vs. Fixed guidance, a "Generate labor from measurement"
explainer), and Photos (Current job vs. Previous work distinction);
three internal-phase/vendor-name leaks removed from user-facing text
("Phase 2A supports USD only" → "Only USD is supported right now",
"Phase 0 can only add someone..." → "You can only invite someone...",
"Managed by Supabase Auth ... in Phase 0" → a plain sentence); five
list pages (Members, Portfolio, Proposals, Clients, Opportunities) that
rendered a raw Postgres/Postgrest error message now show a generic
friendly one instead; the Materials empty-search message now suggests
adding a custom cost; six "Remove" buttons across the builder steps
(Scope, Labor, Materials, Measurements, Photos ×2) that were plain
unwrapped `<button>`s with no pending-state feedback now use
`SubmitButton`; the active step in the builder's stepper now carries
`aria-current="step"`.

No RLS, calculation formulas, storage policies, proposal versioning,
Client Portal, payments, PDF, AI, or scraping work touched. Verified:
typecheck/lint clean, 153/153 unit, 247/247 RLS, 70/70 E2E (+2 temporary
screenshot-capture specs, deleted after use), clean build. See
[docs/49](docs/49-phase-2d-ux-polish.md) and
[docs/50](docs/50-visual-review-notes.md) for the full writeup and
before/after screenshots (local only, gitignored).

### Phase 2C.1 — Freehand/brush drawing for the Measurements Draw layout

Replaces the Draw layout tab's rectangle-only sketching with
**freehand/brush drawing** as the default, recommended mode (rectangle
mode is kept as a secondary option): trace an irregular outline with
mouse, touch, or stylus, undo the last stroke, clear and restart, close
the shape (toggle button) to treat it as an area or leave it open to
treat it as a linear run, then enter a real-world reference length
(the drawing's bounding-box width) to scale it. Freehand traces are
simplified with Douglas-Peucker point decimation before submission and
stored internally as a polygon — no new `shape_type`, since
`sketch_polygon` was already reserved (but unused) in Phase 2C's
schema. A closed shape's area/perimeter are computed server-side via
the shoelace formula and edge-length summation; an open path computes
only `linear_length` — the server never trusts a client-computed area,
the same discipline as rectangle mode. No table migration was needed
(diagnosed first, per this phase's explicit instruction) — only one
new function, `save_measurement_polygon_shape()`, alongside the
existing rectangle-mode `save_measurement_shape()`. Material/labor
generation from a freehand-derived measurement works identically to a
manual one (same ZIP/catalog pricing, quantity calc, snapshot
pricing). Verified at 390×844 with no horizontal overflow at any step
of the freehand flow. See
[docs/47](docs/47-drawing-sketch-mode.md) (rewritten for freehand),
[docs/46](docs/46-measurement-calculation-engine.md) (polygon geometry
formulas added), [docs/45](docs/45-measurements-takeoff-builder.md),
and [docs/48](docs/48-measurement-rls-verification.md).

19 new unit tests (polygon area/perimeter/simplification/scaling), 14
new RLS/integration tests (freehand CRUD, tenant isolation, material/
labor generation, locked-version rejection), 2 new E2E scenarios
(desktop + mobile, the brief's worked example: 120 sq ft → 132 sq ft
flooring at $3.50/sq ft = $462.00, $4.00/sq ft labor = $480.00, $942.00
total); 39/39 measurements RLS + 153/153 unit + 70/70 E2E all passing,
zero regressions. Along the way, found and fixed a real bug surfaced by
the desktop E2E test (not a test artifact): `handlePointerUp` read a
mutable ref through a `setState` functional updater that React
evaluates lazily during its render phase — by which point the very
next line had already reset that same ref, silently dropping every
freehand stroke. No CAD avanzado, no multi-room connected floorplans,
no advanced node/vertex editing, no PDF blueprint import, no AI shape
detection, no external APIs, no scraping, no Client Portal, no Stripe,
no PDF export — out of scope for this phase.

### Phase 2C — Measurements / Takeoff builder

Adds a new **Measurements** step to the Proposal Builder (first tab in
the stepper, before Scope of Work): a contractor can record room/surface
dimensions manually (rectangle, direct area, or direct linear length,
with a live area/perimeter/waste preview) or by drawing a simple
rectangle on an SVG canvas and calibrating it to a real-world length —
no drawing library added, rectangles only in this phase (documented
limitation, see [docs/47](docs/47-drawing-sketch-mode.md)). A
measurement can then **generate** a catalog material (reusing the exact
ZIP-price fallback, snapshot pricing, and "never invent a price"
guarantee from Phase 2B) or a priced labor item (two new
`pricing_method` values, `area` and `linear`, added via a dedicated
function that leaves the existing hourly/fixed labor functions
untouched). Four new tables
(`proposal_measurement_groups`/`proposal_measurements`/
`proposal_measurement_shapes`/`proposal_measurement_materials`), five
new permissions (`measurements.view`/`.create`/`.update`/`.archive`/
`.generate_materials` — a dedicated set, not a reuse of
`proposals.update`, since Field Worker must be able to create
measurements despite never holding that permission), and the same
composite-FK + dedicated-trigger cross-tenant integrity pattern as
every other phase. Preview now shows measurements alongside what they
generated. See [docs/45](docs/45-measurements-takeoff-builder.md),
[docs/46](docs/46-measurement-calculation-engine.md),
[docs/47](docs/47-drawing-sketch-mode.md), and
[docs/48](docs/48-measurement-rls-verification.md).

27 new unit tests (calculation engine), 25 new RLS/integration tests, 2
new E2E specs (desktop + mobile); 233/233 RLS + 134/134 unit + 68/68 E2E
all passing. No AI measurement detection, blueprint/PDF upload parsing,
full CAD editor, external material APIs, scraping, Client Portal,
payments, PDF, Stripe, or email — out of scope for this phase.

### Phase 2B.1 — Unified ZIP + search panel, broader search, real empty-string bug fix

Merges the Materials & Costs step's ZIP field and material catalog
search/results — previously two separate cards — into a single
"Material pricing" panel, matching the actual mental flow (pick a ZIP,
then search within it). Broadens catalog text search to match
description/brand/supplier_name in addition to name, and replaces the
one generic "no materials match" message with three distinct, situation-
specific empty states (no ZIP yet / no matching materials / materials
matched but none priced for this ZIP).

Root-causes and fixes a real bug reported against the previous phase:
an empty-string category filter or search box (the literal value the
UI's "All categories" `<option>` and a cleared search input submit)
reached `search_material_catalog()` as `''`, not `null` — Phase 2B's
earlier fix only normalized this at the Next.js call site, which turned
out to be incomplete; any other caller passing `''` directly still hit
the bug. Fixed at the actual source this time: every optional filter is
normalized inside the SQL function itself
(`nullif(btrim(coalesce(…, '')), '')`), so `''` and `null` are always
equivalent regardless of caller. See
[docs/42](docs/42-material-catalog-by-zip.md#the-empty-string-bug-found-and-fixed).

8 new RLS/integration tests, 2 new E2E tests; 208/208 RLS + 107/107 unit
+ 66/66 E2E all passing. No Client Portal, email, PDF, Stripe, AI, or
scraping work; no new modules outside this scope.

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
