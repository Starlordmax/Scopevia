# Scopevia

**Smart Estimates for Contractors.**

Scopevia is a mobile-first SaaS platform that helps contractors manage leads, calculate costs, produce Good/Better/Best proposals, and get paid — starting with painting contractors.

This repository is currently at **Phase 1: CRM & Projects**, built on top of **Phase 0: Foundations** — authentication, multi-tenancy, roles/permissions and Row Level Security, since hardened and verified against a real Postgres instance. Phase 1 adds Clients, Contacts, Opportunities, Projects, Project Addresses, Notes, and an activity timeline. Estimating, proposals, and payments do not exist yet. See [docs/](docs/) for the full product and architecture design, [docs/14-phase-0-foundations.md](docs/14-phase-0-foundations.md) / [docs/20-phase-1-crm-and-projects.md](docs/20-phase-1-crm-and-projects.md) for what each phase implements, [docs/18-phase-0-security-hardening.md](docs/18-phase-0-security-hardening.md) / [docs/23-phase-1-rls-verification.md](docs/23-phase-1-rls-verification.md) for the security reviews, and [docs/19-phase-0-verification-evidence.md](docs/19-phase-0-verification-evidence.md) for real test-run evidence.

## Stack

- [Next.js](https://nextjs.org/) 16 (App Router) + TypeScript + React 19
- [Supabase](https://supabase.com/) (Postgres, Auth, Row Level Security)
- [Zod](https://zod.dev/) for runtime validation
- [Vitest](https://vitest.dev/) for testing
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
| [docs/00-13](docs/) | Product vision, MVP scope, architecture, data model, security, estimating engine, roadmap, risks — the full pre-implementation design |
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
| [docs/24-phase-1-manual-testing.md](docs/24-phase-1-manual-testing.md) | Manual testing checklist — what's proven by automated tests vs. genuinely NOT RUN (no browser tool in this session) |
| [docs/adr/](docs/adr/) | Architecture Decision Records |

## Project structure

```text
src/
  app/            Next.js App Router routes (clients/opportunities/pipeline/projects added in Phase 1)
  actions/        Server Actions (auth, tenant, membership, profile, clients, opportunities, projects, notes)
  components/     Shared UI components
  lib/
    supabase/     Client separation: browser, server, middleware, admin
    auth/         Session, tenant resolution, permissions
    audit/        Application-layer audit logging
    validation/   Zod schemas (schemas.ts: Phase 0, crm.ts: Phase 1)
    crm/          Phase 1: state transition maps, activity labels, list-page data helpers
    search.ts     Phase 1: safe ILIKE/PostgREST filter escaping for list-page search
  proxy.ts        Route protection (Next.js 16's successor to middleware.ts)
supabase/
  migrations/     Versioned SQL — schema, functions, triggers, RLS, seeds
tests/
  unit/           Pure function tests
  rls/            Tenant isolation + Phase 1 CRM integration tests (requires a real Postgres project)
types/
  database.ts     Supabase types, regenerated via `npm run db:types` (one hand-patch documented inline — see file header)
  enums.ts        Hand-maintained literal unions for text+CHECK "enums" not captured by codegen
docs/             Product design + architecture documentation
```

## Commands

See [docs/15-local-development.md](docs/15-local-development.md#comandos-disponibles) for the full list (`dev`, `build`, `lint`, `typecheck`, `test`, `test:rls`, `db:*`).

## Security model

Defense in depth: every table with a `tenant_id` has Row Level Security enabled and deny-by-default; sensitive mutations go through `SECURITY DEFINER` Postgres functions, never direct client writes; the server independently re-validates membership and permissions on every request regardless of what the client claims. See [docs/06-security-and-rls.md](docs/06-security-and-rls.md) and [docs/17-rls-verification.md](docs/17-rls-verification.md).
