# Scopevia

**Smart Estimates for Contractors.**

Scopevia is a mobile-first SaaS platform that helps contractors manage leads, calculate costs, produce Good/Better/Best proposals, and get paid — starting with painting contractors.

This repository is currently at **Phase 2B: Material catalog by ZIP code + proposal delete/archive**, built on top of **Phase 2A: Proposal-centric pivot**, **Phase 1: CRM & Projects**, and **Phase 0: Foundations**. The primary workflow is Client → Opportunity → **Proposal** → *(future Sent/Viewed/Accepted)* → Project — a Project is no longer required before pricing a job. A contractor can build a professional proposal with a labor calculator, a ZIP-priced material catalog (with price snapshotting so a later catalog price change never retroactively changes an existing proposal — see [docs/42](docs/42-material-catalog-by-zip.md)), current-job and previous-work (Portfolio) photos, discounts/tax, a live preview, and a reversible "delete" (soft archive/restore — see [docs/43](docs/43-proposal-delete-archive.md)), all server-computed and tenant-isolated. Email delivery, the Client Portal, PDF generation, payments, and real external pricing data (scraping/APIs) do not exist yet. See [docs/](docs/) for the full product and architecture design, [docs/29-proposal-centric-product-pivot.md](docs/29-proposal-centric-product-pivot.md) for the pivot itself, [docs/14-phase-0-foundations.md](docs/14-phase-0-foundations.md) / [docs/20-phase-1-crm-and-projects.md](docs/20-phase-1-crm-and-projects.md) for the earlier phases, and [docs/35-phase-2a-rls-verification.md](docs/35-phase-2a-rls-verification.md) / [docs/36-phase-2a-e2e-verification.md](docs/36-phase-2a-e2e-verification.md) / [docs/44-material-catalog-rls-verification.md](docs/44-material-catalog-rls-verification.md) for real test-run evidence.

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
                  projects, notes, proposals, media, portfolio, proposal-settings)
  components/     Shared UI components
  lib/
    supabase/     Client separation: browser, server, middleware, admin
    auth/         Session, tenant resolution, permissions
    audit/        Application-layer audit logging
    validation/   Zod schemas (schemas.ts: Phase 0, crm.ts: Phase 1, proposals.ts: Phase 2A/2B)
    crm/          State transition maps, activity labels, list-page data helpers, status badges
    proposals/    Phase 2A: calculation engine (mirror, not authority), data fetchers, formatting;
                  materials.ts: Phase 2B, material catalog search
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

Defense in depth: every table with a `tenant_id` has Row Level Security enabled and deny-by-default; sensitive mutations go through `SECURITY DEFINER` Postgres functions, never direct client writes; the server independently re-validates membership and permissions on every request regardless of what the client claims. See [docs/06-security-and-rls.md](docs/06-security-and-rls.md) and [docs/17-rls-verification.md](docs/17-rls-verification.md).
