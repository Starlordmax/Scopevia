# Scopevia

**Smart Estimates for Contractors.**

Scopevia is a mobile-first SaaS platform that helps contractors manage leads, calculate costs, produce Good/Better/Best proposals, and get paid — starting with painting contractors.

This repository is currently at **Phase 3D.2: Business Logo Upload for Portal and PDF Branding**, built on top of **Phase 3D.1: Render Staging Deployment Prep**, built on top of **Phase 3D: Email Notifications for Client Portal Events**, **Phase 3C: Proposal PDF / Print Export**, **Phase 3B.1: Proposal Revision / New Version Flow**, **Phase 3B: Client Portal Accept/Decline**, **Phase 3A.1: Real email provider + Client Portal delivery hardening**, **Phase 3A: Client Portal with email + OTP access**, **Phase 2D.1: Material catalog pagination**, **Phase 2D: Visual review & UX polish**, **Phase 2C.1: Freehand/brush drawing**, **Phase 2C: Measurements / Takeoff builder**, **Phase 2B: Material catalog by ZIP code + proposal delete/archive**, **Phase 2A: Proposal-centric pivot**, **Phase 1: CRM & Projects**, and **Phase 0: Foundations**. The primary workflow is Client → Opportunity → **Proposal → Client Portal → Accepted/Declined** → Project — a Project is no longer required before pricing a job. A contractor can build a professional proposal with a **Measurements step** (manual entry, or drawn on-screen — freehand for irregular spaces or a simple rectangle, both calibrated to real-world units — see [docs/45](docs/45-measurements-takeoff-builder.md) and [docs/47](docs/47-drawing-sketch-mode.md)) that can generate priced materials and labor directly from a room's computed area/perimeter, a labor calculator, a **paginated**, ZIP-priced material catalog (with price snapshotting so a later catalog price change never retroactively changes an existing proposal — see [docs/42](docs/42-material-catalog-by-zip.md) and [docs/51](docs/51-material-catalog-pagination.md)), current-job and previous-work (Portfolio) photos, discounts/tax, a live preview, and a reversible "delete" (soft archive/restore — see [docs/43](docs/43-proposal-delete-archive.md)), all server-computed and tenant-isolated. Phase 2D polished the visual/microcopy layer across the whole app — see [docs/49](docs/49-phase-2d-ux-polish.md) and [docs/50](docs/50-visual-review-notes.md). A **ready** proposal can be shared with its client via a secure, revocable **Client Portal** link: the client verifies their own email with a one-time code (no Supabase Auth account, no password), delivered through a pluggable email provider abstraction (`dev` capture for local/test, a real Resend HTTP send when configured — see [docs/55](docs/55-client-portal-email-delivery.md)), then views a read-only version of the proposal and can **accept or decline** it right there — the response locks the proposal's version (an immutable historical record), updates its status, and the contractor sees the decision (who, when, and any decline reason) immediately on the proposal detail page — see [docs/52](docs/52-client-portal-foundation.md), [docs/53](docs/53-client-portal-security.md), [docs/56](docs/56-client-portal-accept-decline.md), [docs/57](docs/57-client-response-security.md). If a client declines (or accepts, with a strong confirmation), the contractor can now create a **revised version** — the old, responded-to version and its response stay locked and untouched forever, a brand-new editable draft is seeded from it, and old portal links keep showing exactly what the client saw — see [docs/58](docs/58-proposal-revision-flow.md) and [docs/59](docs/59-proposal-version-history.md). Any version of a proposal — current or historical — can be exported as a clean, professional, printable document from the contractor app or the Client Portal via "Print / Save as PDF" (print-to-PDF, no server-generated PDF file), always tied to the exact version it's bound to (an old portal link always exports the old content, a new one the new content) — see [docs/60](docs/60-proposal-pdf-print-export.md) and [docs/61](docs/61-export-version-safety.md). The contractor's team also gets a real email — not just an in-app trail — the moment a client views, accepts, or declines a proposal (deduplicated by a hard database constraint, never spammed by a page reload, a delivery failure never blocks the client's own flow), with a short confirmation sent to the client on accept/decline too — see [docs/62](docs/62-proposal-email-notifications.md) and [docs/63](docs/63-notification-delivery-security.md). The app is now ready to deploy as a **Render Web Service** for a closed beta — a public health check, a "fail fast" startup config check, and a `render.yaml` Blueprint exist for this, with no real secrets anywhere in the repo — see [docs/64](docs/64-render-staging-deployment.md), [docs/65](docs/65-render-environment-variables.md), and [docs/66](docs/66-staging-smoke-test-checklist.md). An Owner or Admin can upload a **business logo** (from Profile → Business branding — it belongs to the tenant, never a personal user profile) that appears on the internal proposal preview, the Client Portal, and every print/export route, stored privately (never public, never base64, never a permanent URL) with a 10 MB PNG/JPEG/WEBP-only limit, uploaded via a dedicated Route Handler rather than a Server Action so any file size gets a clean response instead of a possible crash — see [docs/69](docs/69-business-branding-logo-upload.md), [docs/70](docs/70-logo-storage-security.md), and [docs/71](docs/71-logo-upload-crash-fix.md). A missing client no longer has to interrupt building a proposal — **"+ New client"** on the New Proposal form's Client selector opens a quick-create modal, auto-selects the result, and never loses any proposal text already typed — see [docs/72](docs/72-quick-create-client.md). The New Client form (and the Quick Create Client modal) now capture a real **street address** — Street address, Apt/Suite/Unit, City, State, ZIP code, Country — in place of the old free-text Website field (still stored, just no longer collected on create), and a client's saved ZIP automatically becomes the default pricing ZIP for any new proposal built for that client, pre-filled in Materials & Costs with the catalog search already using it; a manual ZIP change there is never overwritten again. Address autocomplete is structurally supported but not wired up in this phase — see [docs/73](docs/73-client-address-and-material-zip-defaults.md). Selecting **Custom** as a proposal's service type now requires (and shows everywhere) a real name instead of the bare word "custom," Draw layout's Freehand mode correctly supports **multiple separate strokes** (a real bug fix — lifting the pen between strokes no longer draws a phantom connecting line), and the Measurements step's forms gained inline, per-field red-state validation — see [docs/74](docs/74-custom-service-name-and-multistroke-drawing.md). That same inline, per-field red-state validation (red border, message under the field, `aria-invalid`, focus moved to the first invalid field) now covers **every** form in the app with a required or validatable field — Sign in/up, Forgot/Reset password, Profile, Members, Clients, Quick Create Client, Opportunities, Proposal creation, every Proposal Builder step, the Client Portal, business logo upload, Portfolio, and Notes — instead of the browser's native `required` popup or a single generic error banner — see [docs/75](docs/75-global-field-validation.md). PDF generation (as a server-generated file), electronic signature, payments (Stripe/deposits), questions/comments, real external pricing data (scraping/APIs), and AI-assisted measurement/blueprint parsing do not exist yet. See [docs/](docs/) for the full product and architecture design, [docs/29-proposal-centric-product-pivot.md](docs/29-proposal-centric-product-pivot.md) for the pivot itself, [docs/14-phase-0-foundations.md](docs/14-phase-0-foundations.md) / [docs/20-phase-1-crm-and-projects.md](docs/20-phase-1-crm-and-projects.md) for the earlier phases, and [docs/35](docs/35-phase-2a-rls-verification.md) / [docs/36](docs/36-phase-2a-e2e-verification.md) / [docs/44](docs/44-material-catalog-rls-verification.md) / [docs/48](docs/48-measurement-rls-verification.md) / [docs/54](docs/54-client-portal-e2e-verification.md) for real test-run evidence.

## Stack

- [Next.js](https://nextjs.org/) 16 (App Router) + TypeScript + React 19
- [Supabase](https://supabase.com/) (Postgres, Auth, Row Level Security)
- [Zod](https://zod.dev/) for runtime validation
- [Vitest](https://vitest.dev/) for unit and RLS/integration testing
- [Playwright](https://playwright.dev/) for real-browser end-to-end testing
- Plain CSS (mobile-first) — no UI framework

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in your local Supabase credentials
npm run db:start             # requires Docker — starts local Supabase
npm run db:reset             # applies all migrations + seeds
npm run dev
```

Open http://localhost:3000 — you'll land on the sign-in page.

Full walkthrough (installing, running migrations, creating a test user, verifying RLS): see [docs/15-local-development.md](docs/15-local-development.md).

## Documentation

| Doc | Covers |
|---|---|
| [docs/00-13](docs/) | Product vision, MVP scope, architecture, data model, security, estimating engine, roadmap, risks — the full pre-implementation design (see status notes at the top of docs/00, 01, 03, 05, 08, 12 for what's superseded by Phase 2A) |
| [docs/29-proposal-centric-product-pivot.md](docs/29-proposal-centric-product-pivot.md) | The Phase 2A pivot: new flow, new value proposition, terminology, what's in/out of scope |
| [docs/30-phase-2a-proposal-data-model.md](docs/30-phase-2a-proposal-data-model.md) | The 10 Phase 2A tables and the functions that mutate them |
| [docs/31-proposal-state-machines.md](docs/31-proposal-state-machines.md) | The extended Opportunity pipeline and the new Proposal lifecycle |
| [docs/32-proposal-calculation-engine.md](docs/32-proposal-calculation-engine.md) | Labor/line-item/discount/tax formulas, manipulation resistance, test coverage |
| [docs/33-media-and-storage-security.md](docs/33-media-and-storage-security.md) | The private Storage bucket, RLS-equivalent policies, media model |
| [docs/34-proposal-builder-ux.md](docs/34-proposal-builder-ux.md) | The 7-step builder, preview, dashboard, navigation |
| [docs/35-phase-2a-rls-verification.md](docs/35-phase-2a-rls-verification.md) | Real PASS/FAIL results for Phase 2A against Postgres + Storage |
| [docs/36-phase-2a-e2e-verification.md](docs/36-phase-2a-e2e-verification.md) | Real Playwright browser test results for the proposal flow |
| [docs/37-proposal-scope-rpc-fix.md](docs/37-proposal-scope-rpc-fix.md) | Root cause and fix for the `update_proposal_scope` "schema cache" bug |
| [docs/38-navigation-simplification.md](docs/38-navigation-simplification.md) | Pipeline and Projects removed as visible UI modules; what changed, what didn't, known limitations |
| [docs/39-fixed-labor-pricing.md](docs/39-fixed-labor-pricing.md) | The Labor step's second pricing mode (fixed price alongside hourly) |
| [docs/40-proposal-total-refresh-fix.md](docs/40-proposal-total-refresh-fix.md) | A reported "Pricing Summary shows $0.00" bug: full investigation, not reproduced, documented honestly |
| [docs/41-photo-gallery-ui-fix.md](docs/41-photo-gallery-ui-fix.md) | Green upload button, thumbnail photo grid (replacing full-size images) |
| [docs/42-material-catalog-by-zip.md](docs/42-material-catalog-by-zip.md) | Phase 2B: the material catalog data model, ZIP price fallback, snapshot pricing, permissions, seed data, known limitations |
| [docs/43-proposal-delete-archive.md](docs/43-proposal-delete-archive.md) | Phase 2B: "Delete proposal" is always a soft archive, confirmation copy, Danger zone placement, Active/Archived/All filter |
| [docs/44-material-catalog-rls-verification.md](docs/44-material-catalog-rls-verification.md) | Real PASS/FAIL results for Phase 2B against Postgres, including a real cross-tenant security bug found and fixed by the test suite |
| [docs/45-measurements-takeoff-builder.md](docs/45-measurements-takeoff-builder.md) | Phase 2C: the Measurements step, data model, permissions, generating materials/labor from a measurement, known limitations |
| [docs/46-measurement-calculation-engine.md](docs/46-measurement-calculation-engine.md) | Phase 2C: area/perimeter/wall-area/waste/material-quantity/labor formulas, rounding table, units |
| [docs/47-drawing-sketch-mode.md](docs/47-drawing-sketch-mode.md) | Phase 2C/2C.1: freehand (primary) and rectangle (secondary) drawing modes, polygon geometry, why no CAD library was added, known limitations |
| [docs/48-measurement-rls-verification.md](docs/48-measurement-rls-verification.md) | Real PASS/FAIL results for Phase 2C against Postgres |
| [docs/49-phase-2d-ux-polish.md](docs/49-phase-2d-ux-polish.md) | Phase 2D: the visual/microcopy polish pass, the real redirect bug found and fixed, every UI change made |
| [docs/50-visual-review-notes.md](docs/50-visual-review-notes.md) | Phase 2D: baseline vs. after screenshot inventory, per-page UX findings, known limitations carried forward |
| [docs/51-material-catalog-pagination.md](docs/51-material-catalog-pagination.md) | Phase 2D.1: server-side pagination for the material catalog, root cause of the mobile giant-scroll bug, "Load more" design |
| [docs/52-client-portal-foundation.md](docs/52-client-portal-foundation.md) | Phase 3A: the Client Portal architecture (link/OTP/session), data model, contractor + client-facing UX, audit/activity, known limitations |
| [docs/53-client-portal-security.md](docs/53-client-portal-security.md) | Phase 3A: token/OTP/session hashing, rate limiting, why the service-role admin client is used, RLS for the four new tables |
| [docs/54-client-portal-e2e-verification.md](docs/54-client-portal-e2e-verification.md) | Phase 3A: real RLS + Playwright test results, two real bugs found and fixed during verification |
| [docs/55-client-portal-email-delivery.md](docs/55-client-portal-email-delivery.md) | Phase 3A.1: the email provider abstraction (dev/Resend), env vars, the production/dev-provider guard, security review, known limitations |
| [docs/56-client-portal-accept-decline.md](docs/56-client-portal-accept-decline.md) | Phase 3B: the accept/decline data model, state transitions, portal + contractor UX, audit/activity, a real post-response access bug found and fixed |
| [docs/57-client-response-security.md](docs/57-client-response-security.md) | Phase 3B: duplicate-response prevention, version locking, the post-response access fix's security implications |
| [docs/58-proposal-revision-flow.md](docs/58-proposal-revision-flow.md) | Phase 3B.1: `create_proposal_revision()`, what's copied vs. not, state transitions, why `superseded` needed the same immutability fix as `locked` |
| [docs/59-proposal-version-history.md](docs/59-proposal-version-history.md) | Phase 3B.1: the Version History panel, and the portal-link access fix that keeps old links working after a revision |
| [docs/60-proposal-pdf-print-export.md](docs/60-proposal-pdf-print-export.md) | Phase 3C: print-to-PDF vs. server PDF decision, the two export routes, document layout, image handling, print stylesheet |
| [docs/61-export-version-safety.md](docs/61-export-version-safety.md) | Phase 3C: why export needed zero new SQL, the `getFullProposal()` version-id guard, the full security model |
| [docs/62-proposal-email-notifications.md](docs/62-proposal-email-notifications.md) | Phase 3D: events, recipients, the generic email sender, dev/test capture, `APP_BASE_URL`, delivery safety |
| [docs/63-notification-delivery-security.md](docs/63-notification-delivery-security.md) | Phase 3D: RLS on the new delivery-log table, the dedupe constraint as the real guard, error-code sanitization |
| [docs/64-render-staging-deployment.md](docs/64-render-staging-deployment.md) | Phase 3D.1: Render Web Service setup, build/start commands, the fail-fast startup check, cookies/images review |
| [docs/65-render-environment-variables.md](docs/65-render-environment-variables.md) | Phase 3D.1: every env var Render needs, public vs. secret, where to get each one (no values) |
| [docs/66-staging-smoke-test-checklist.md](docs/66-staging-smoke-test-checklist.md) | Phase 3D.1: manual post-deploy checklist — internal, portal, and revision flows against real Resend email |
| [docs/67-auth-confirmation-url-fix.md](docs/67-auth-confirmation-url-fix.md) | Fix: signup/reset confirmation emails linking to localhost from Render — root cause, code fix, exact Supabase Dashboard config |
| [docs/68-auth-callback-localhost-redirect-fix.md](docs/68-auth-callback-localhost-redirect-fix.md) | Fix: `/auth/callback`'s own final redirect landing on localhost after a successful confirmation — canonical-URL + open-redirect guard |
| [docs/69-business-branding-logo-upload.md](docs/69-business-branding-logo-upload.md) | Phase 3D.2: business (tenant, not user) logo upload, data model, Profile UX, rendering across proposal/portal/print |
| [docs/70-logo-storage-security.md](docs/70-logo-storage-security.md) | Phase 3D.2: the `tenant-branding` bucket, RLS policies, why SVG is blocked, the portal signed-URL threat model |
| [docs/71-logo-upload-crash-fix.md](docs/71-logo-upload-crash-fix.md) | Fix: logo upload crashing the Profile page for any file over the Server Action body limit — resolved by moving upload to a dedicated Route Handler; logo limit raised to 10 MB |
| [docs/72-quick-create-client.md](docs/72-quick-create-client.md) | Feature: "+ New client" modal on the New Proposal form — create and auto-select a client without losing in-progress proposal data |
| [docs/73-client-address-and-material-zip-defaults.md](docs/73-client-address-and-material-zip-defaults.md) | Feature: client street address (replacing the Website field on create) + a client's ZIP auto-filling as the default Materials & Costs pricing ZIP, with manual overrides never re-clobbered |
| [docs/74-custom-service-name-and-multistroke-drawing.md](docs/74-custom-service-name-and-multistroke-drawing.md) | Fix: custom service name required/shown everywhere for Service type = Custom; Freehand drawing's multi-stroke bug (strokes no longer auto-connect); inline per-field validation on the Measurements step's forms |
| [docs/75-global-field-validation.md](docs/75-global-field-validation.md) | Fix: app-wide required-field red-state validation (red border, inline message, `aria-invalid`, focus-on-error) — extends docs/74's Measurements pattern to Auth, Profile, Members, Clients, Opportunities, the whole Proposal Builder, Client Portal, Portfolio, and Notes; removes `required` everywhere it's replaced |
| [docs/14-phase-0-foundations.md](docs/14-phase-0-foundations.md) | What Phase 0 implements and why, including deviations from the original design |
| [docs/15-local-development.md](docs/15-local-development.md) | Local setup, commands, troubleshooting |
| [docs/16-environments-and-deployment.md](docs/16-environments-and-deployment.md) | Dev/staging/production separation, migrations, secrets |
| [docs/17-rls-verification.md](docs/17-rls-verification.md) | How to verify tenant isolation, and the checklist for adding new tables safely |
| [docs/18-phase-0-security-hardening.md](docs/18-phase-0-security-hardening.md) | Security review: issues found (including a real privilege-escalation path), fixes applied, SECURITY DEFINER function audit |
| [docs/19-phase-0-verification-evidence.md](docs/19-phase-0-verification-evidence.md) | Real command output and PASS/FAIL results from verifying against Postgres (Phase 0) |
| [docs/20-phase-1-crm-and-projects.md](docs/20-phase-1-crm-and-projects.md) | What Phase 1 implements: permission matrix, notes/activity/audit separation, cross-tenant integrity, concurrency, known limitations |
| [docs/21-phase-1-data-model.md](docs/21-phase-1-data-model.md) | The 7 Phase 1 tables and the functions that mutate them |
| [docs/22-phase-1-state-machines.md](docs/22-phase-1-state-machines.md) | The opportunity and project pipelines, and why they diverge from the original design sketch |
| [docs/23-phase-1-rls-verification.md](docs/23-phase-1-rls-verification.md) | Real PASS/FAIL results for Phase 1 against Postgres, RLS policy coverage, checklist for adding a new tenant-scoped table |
| [docs/24-phase-1-manual-testing.md](docs/24-phase-1-manual-testing.md) | Original manual testing checklist (historical) — superseded by docs/25 |
| [docs/25-phase-1-e2e-verification.md](docs/25-phase-1-e2e-verification.md) | Real Playwright browser test results (48/48, 3 stable runs), restore operation coverage, real bugs found and fixed via browser testing |
| [docs/adr/](docs/adr/) | Architecture Decision Records |

## Project structure

```text
src/
  app/            Next.js App Router routes (clients/opportunities: Phase 1, still a visible
                  module; pipeline/projects: Phase 1, now legacy redirect-only stubs — see
                  docs/38; proposals/portfolio/settings/proposals: Phase 2A, the primary flow)
  actions/        Server Actions (auth, tenant, membership, profile, clients, opportunities,
                  projects, notes, proposals, media, portfolio, proposal-settings,
                  measurements: Phase 2C)
  components/     Shared UI components
  lib/
    supabase/     Client separation: browser, server, middleware, admin
    auth/         Session, tenant resolution, permissions
    audit/        Application-layer audit logging
    validation/   Zod schemas (schemas.ts: Phase 0, crm.ts: Phase 1, proposals.ts: Phase 2A/2B/2C)
    crm/          State transition maps, activity labels, list-page data helpers, status badges
    proposals/    Phase 2A: calculation engine (mirror, not authority), data fetchers, formatting;
                  materials.ts: Phase 2B, material catalog search;
                  measurements.ts: Phase 2C, measurement calculation engine (mirror, not authority)
    storage/      Phase 2A: private Storage upload + signed URL helpers
    search.ts     Safe ILIKE/PostgREST filter escaping for list-page search
  proxy.ts        Route protection (Next.js 16's successor to middleware.ts)
supabase/
  migrations/     Versioned SQL — schema, functions, triggers, RLS, seeds, Storage bucket/policies
tests/
  unit/           Pure function tests, including the proposal calculation engine
  rls/            Tenant isolation + CRM/restore/proposal/Storage integration tests (requires a real Postgres project)
  e2e/            Playwright browser tests (requires a real Postgres project; spins up a production build)
playwright.config.ts  Playwright config — desktop + mobile (390x844) projects
types/
  database.ts     Supabase types, regenerated via `npm run db:types` (points at the linked project)
  enums.ts        Hand-maintained literal unions for text+CHECK "enums" not captured by codegen
docs/             Product design + architecture documentation
```

## Commands

See [docs/15-local-development.md](docs/15-local-development.md#comandos-disponibles) for the full list (`dev`, `build`, `lint`, `typecheck`, `test`, `test:rls`, `test:e2e`, `test:e2e:ui`, `db:*`).

## Security model

Defense in depth: every table with a `tenant_id` has Row Level Security enabled and deny-by-default; sensitive mutations go through `SECURITY DEFINER` Postgres functions, never direct client writes; the server independently re-validates membership and permissions on every request regardless of what the client claims. See [docs/06-security-and-rls.md](docs/06-security-and-rls.md) and [docs/17-rls-verification.md](docs/17-rls-verification.md). The Client Portal (Phase 3A) is a deliberate exception to "every user is a Supabase Auth session" — a portal visitor has none at all, so its link/OTP/session tokens are validated by hash against dedicated tables via the service-role admin client, never via `user_has_permission()`; see [docs/53-client-portal-security.md](docs/53-client-portal-security.md).
