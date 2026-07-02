# Scopevia

**Smart Estimates for Contractors.**

Scopevia is a mobile-first SaaS platform that helps contractors manage leads, calculate costs, produce Good/Better/Best proposals, and get paid — starting with painting contractors.

This repository is currently at **Phase 0: Foundations** — authentication, multi-tenancy, roles/permissions and Row Level Security. No product features (CRM, estimating, proposals, payments) exist yet. See [docs/](docs/) for the full product and architecture design, and [docs/14-phase-0-foundations.md](docs/14-phase-0-foundations.md) for what this phase specifically implements.

## Stack

- [Next.js](https://nextjs.org/) 16 (App Router) + TypeScript + React 19
- [Supabase](https://supabase.com/) (Postgres, Auth, Row Level Security)
- [Zod](https://zod.dev/) for runtime validation
- [Vitest](https://vitest.dev/) for testing
- Plain CSS (mobile-first) — no UI framework in Phase 0

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
| [docs/adr/](docs/adr/) | Architecture Decision Records |

## Project structure

```text
src/
  app/            Next.js App Router routes
  actions/        Server Actions (auth, tenant, membership, profile)
  components/     Shared UI components
  lib/
    supabase/     Client separation: browser, server, middleware, admin
    auth/         Session, tenant resolution, permissions
    audit/        Application-layer audit logging
    validation/   Zod schemas
  proxy.ts        Route protection (Next.js 16's successor to middleware.ts)
supabase/
  migrations/     Versioned SQL — schema, functions, triggers, RLS, seeds
tests/
  unit/           Pure function tests
  rls/            Tenant isolation integration tests (requires Docker)
types/
  database.ts     Hand-written Supabase types (replace with `npm run db:types` once a project exists)
docs/             Product design + architecture documentation
```

## Commands

See [docs/15-local-development.md](docs/15-local-development.md#comandos-disponibles) for the full list (`dev`, `build`, `lint`, `typecheck`, `test`, `test:rls`, `db:*`).

## Security model

Defense in depth: every table with a `tenant_id` has Row Level Security enabled and deny-by-default; sensitive mutations go through `SECURITY DEFINER` Postgres functions, never direct client writes; the server independently re-validates membership and permissions on every request regardless of what the client claims. See [docs/06-security-and-rls.md](docs/06-security-and-rls.md) and [docs/17-rls-verification.md](docs/17-rls-verification.md).
