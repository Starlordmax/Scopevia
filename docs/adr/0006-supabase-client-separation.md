---
status: Accepted
date: 2026-07-01
supersedes: none
---

# ADR 0006 — Supabase client separation

## Context

A Next.js app touches Supabase from at least four different execution
contexts (browser, Server Component/Action, Route Handler, Middleware), each
with different cookie-handling APIs, and there is a service-role key that
must never reach the browser bundle.

## Decision

Four distinct, single-purpose modules under `src/lib/supabase/`:

| File | Uses | Privilege |
|---|---|---|
| `client.ts` | Client Components | anon key only |
| `server.ts` | Server Components, Server Actions, Route Handlers | anon key + caller's session cookie (still subject to RLS as that user) |
| `middleware.ts` | `src/middleware.ts` | anon key; refreshes the session cookie only, makes no authorization decisions |
| `admin.ts` | Reserved for future server-only integrations | service role key — bypasses RLS entirely |

`admin.ts` and every module that must never reach the browser (`server.ts`,
`tenant.ts`, `permissions.ts`, `audit/log.ts`) start with `import
"server-only"`, so an accidental import from a Client Component fails the
build instead of silently leaking a secret into the client bundle.

Phase 0's application code never actually calls `admin.ts` — every mutation
is expressed as a `SECURITY DEFINER` function invoked with the caller's own
session (see ADR 0004), which is a narrower, audit-friendly privilege
escalation than handing the whole service role to application code. The
admin client exists for future integrations (Stripe webhooks, background
jobs) that have no authenticated user in context at all.

## Consequences

- `SUPABASE_SERVICE_ROLE_KEY` has exactly one file that is allowed to read
  it. A code reviewer only needs to grep for that env var name to audit
  every place with RLS-bypassing power.
- Adding a new server-only helper that needs a Supabase client should
  import `server.ts`, not reimplement client construction — keeping cookie
  handling in one place is what makes the "middleware refreshes, server
  reads" split actually work across Next.js's caching boundaries.
