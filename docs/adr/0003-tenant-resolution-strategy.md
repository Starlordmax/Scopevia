---
status: Accepted
date: 2026-07-01
supersedes: none
---

# ADR 0003 — Active tenant resolution

## Context

A user can belong to multiple tenants. The application needs to know which
one is "active" for the current request, without that mechanism becoming a
second, weaker authorization system that could be tricked by editing a
cookie or query param.

## Decision

- The active tenant id is stored in an `httpOnly`, `secure` (in production),
  `sameSite=lax` cookie (`scopevia_active_tenant`).
- The cookie is **only a hint**. Every read of "what is my active tenant"
  (`resolveActiveTenant()` / `requireActiveTenant()` in
  `src/lib/auth/tenant.ts`) re-fetches the authoritative list of tenants the
  session's user currently belongs to via `get_user_tenants()` (a
  `SECURITY DEFINER` function scoped by `auth.uid()`), and only accepts the
  cookie's tenant id if it appears in that list.
- If the cookie is missing, stale, or points at a tenant the user is no
  longer an active member of, the code falls back to the user's first valid
  tenant, or redirects to `/select-tenant` (multiple valid tenants, none
  currently "chosen") or `/onboarding` (zero tenants).
- Switching tenants (`switchTenantAction`) re-validates the requested tenant
  id against `get_user_tenants()` server-side before writing the cookie —
  the server never trusts a posted tenant id at face value, even from the
  app's own `<form>`.

## Consequences

- Manually editing the cookie to an arbitrary tenant id has no effect beyond
  causing a fallback to a valid tenant or the selector — it cannot grant
  access to data, because every actual data query is separately gated by
  RLS and `user_has_permission()`, not by the cookie.
- No React/client-side state is the source of truth for the active tenant;
  every protected Server Component re-derives it via
  `requireActiveTenant()`. This avoids a class of bugs where a stale client
  cache shows tenant A's UI while a stale server session is scoped to
  tenant B.
- Cost: one extra `get_user_tenants()` RPC call per protected page render
  (in the layout). Acceptable at Phase 0 scale; revisit with caching if it
  becomes a measured bottleneck.
