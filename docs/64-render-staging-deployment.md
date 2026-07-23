# 64 — Render Staging Deployment (Phase 3D.1)

Status: **Code and docs ready for a manual Render deployment.** This phase
does not (and cannot) deploy anything itself — see docs/64's "Render manual
setup steps" in the final report and the note below. 26 new unit tests, 2
new E2E smoke tests (`tests/e2e/health.spec.ts`).

> No product features were added this phase. Everything here is
> deployment/infrastructure preparation for a **Scopevia Staging** Render
> service, meant for beta testers — not a final production deployment.

## Render deployment strategy

**Web Service, not Static Site.** Scopevia cannot run as a static export:

- Next.js server-side rendering (every proposal/client/portal page is
  server-rendered per request, not pre-built HTML).
- Server Actions (every mutation in this app — creating a proposal,
  accepting/declining, revisions — is a Server Action, which requires a
  running Node process).
- httpOnly portal session cookies, set server-side
  (`src/lib/portal/tokens.ts`).
- Supabase server-side auth (`src/lib/supabase/server.ts`,
  `src/lib/supabase/middleware.ts`) and the service-role admin client
  (`src/lib/supabase/admin.ts`) — both require a Node runtime, never
  something a CDN/static host can execute.
- Signed Storage URLs generated server-side, fresh per request.
- The email provider (Resend) is called server-side only.

| Setting | Value |
|---|---|
| Service type | Web Service |
| Runtime | Node |
| Build command | `npm install && npm run build` |
| Start command | `npm start` (already `next start` — see `package.json`, unmodified) |
| Health check path | `/api/health` |

`package.json`'s existing `build`/`start`/`typecheck`/`lint`/`test`
scripts were inspected first (per this phase's own instruction not to
invent commands) — all four already exist and do exactly what's needed;
nothing was renamed or restructured. Added: `predeploy:staging` (runs
typecheck + lint + unit tests + build — deliberately **not** RLS/E2E,
which need live Supabase/browser infrastructure and are too slow for a
quick pre-push sanity check) and `engines.node: ">=20.9.0"` (Next's own
documented minimum for this major version line; comfortably covers the
verified local dev Node version, v22.18.0).

## Code changes

1. **`/api/health`** (`src/app/api/health/route.ts`) — a route handler
   Render's health checker polls. Deliberately shallow: confirms the Node
   process is up and answering, nothing more. No Supabase call, no env var
   dump, no service-role check, no user/tenant data. Added to
   `proxy.ts`'s `ALWAYS_ALLOWED_PATHS` — Render's health checker never
   holds a session cookie, so without this it would be redirected to
   `/sign-in` and the health check would always "fail."
2. **`src/instrumentation.ts`** + **`src/lib/env-validation.ts`** — see
   "Fail fast, not fail quiet" below.
3. **`render.yaml`** — a Blueprint describing the service above, with
   every secret marked `sync: false` (Render prompts for it in the
   dashboard instead of storing it in the file) — see
   [docs/65](65-render-environment-variables.md).

## Fail fast, not fail quiet

Before this phase, a misconfigured production deployment (e.g.
`EMAIL_PROVIDER=resend` with no `RESEND_API_KEY`) would deploy
"successfully" — the server would start fine — and only reveal the problem
the first time a real beta tester tried to request an OTP code. For a
public staging environment with real testers, that's a bad first
impression and a hard bug to notice quickly.

`src/lib/env-validation.ts`'s `validateStagingEnv()` is a pure function
(no server-only dependency, directly unit-tested) that checks the required
production configuration is present. `src/instrumentation.ts` — Next.js's
official startup hook, `register()`, which runs once before the server
accepts any traffic — calls it and **throws** if anything's missing. This
was verified directly, live, against a real `next start` process (which
always runs with `NODE_ENV=production`, exactly like Render):

```text
Scopevia refused to start: missing/invalid environment configuration.
  - RESEND_API_KEY is required when EMAIL_PROVIDER=resend.
  - EMAIL_FROM is required when EMAIL_PROVIDER=resend.
```

Every subsequent request (including Render's own health check) then
receives a 500 until the configuration is fixed and the service restarted
— so Render's health check correctly reports the deploy as unhealthy
rather than silently routing beta-tester traffic to a broken instance.
Checked: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `APP_BASE_URL`, and (conditionally)
`RESEND_API_KEY`/`EMAIL_FROM` when `EMAIL_PROVIDER=resend` — plus an
explicit rejection of `EMAIL_PROVIDER=dev` in production without
`EMAIL_ALLOW_DEV_PROVIDER_IN_PRODUCTION="true"` (the same rule
`resolveEmailProvider()` has enforced at send-time since Phase 3A.1 — this
is the same rule, enforced earlier, at boot). **A no-op outside
production** — `npm run dev` (and any test that doesn't run `next start`)
is unaffected; the existing E2E suite's own `next start` run already sets
`EMAIL_ALLOW_DEV_PROVIDER_IN_PRODUCTION=true` and every other required var
in `.env.local`, so it continues to satisfy this check without any change.

## Pre-deploy hardening reviewed

- **No hardcoded `localhost` in any code path.** Verified by direct
  search — the only mentions of `localhost` in `src/` are comments
  explaining that `buildInternalProposalUrl()` deliberately does *not*
  fall back to it (Phase 3D). `NEXT_PUBLIC_SITE_URL`'s existing
  `?? "http://localhost:3000"` fallback (`src/actions/portal-links.ts`,
  `src/actions/auth.ts`, both pre-existing since Phase 3A/0) only ever
  triggers if that var is unset — `validateStagingEnv()` doesn't
  currently enforce `NEXT_PUBLIC_SITE_URL` itself (only `APP_BASE_URL`,
  which powers the notification links) because a missing
  `NEXT_PUBLIC_SITE_URL` degrades gracefully to a wrong-but-harmless
  portal-link host rather than a broken/insecure state; **it must still
  be set correctly in Render** — see [docs/65](65-render-environment-variables.md).
- **No dev email provider dependency on Render.** `.portal-otp-dev/` and
  `.notification-emails-dev/` (both gitignored, filesystem-based) are
  never read when `EMAIL_PROVIDER=resend` — confirmed by code path (only
  `sendViaDevCapture*()` touch those directories, and neither is called
  when the resolved provider is `resend`). Render's filesystem is
  ephemeral per deploy anyway, so nothing here ever assumes persistence.
- **No secrets in logs.** Every error message this codebase's email code
  produces was already audited in Phase 3D
  ([docs/63](63-notification-delivery-security.md), "What `error_code` is
  (and is not)") — none of them include an API key, a raw provider
  response body, or a portal secret. `validateStagingEnv()`'s own error
  messages name only which variable is *missing*, never any value (unit
  tested: "never includes a secret value in its own error messages").
- **No raw stack traces or SQL/RPC errors reach a user.** Unchanged from
  every prior phase's `friendlyRpcErrorMessage()` /
  `friendlyResponseError()` discipline — this phase didn't touch any
  user-facing error path.
- **`next.config.ts` needs no image-domain configuration.** Verified by
  direct search: `next/image` is never imported anywhere in this
  codebase — every photo (current-job, previous-work, proposal exports)
  is a plain `<img src={signedUrl}>` with an already-resolved, short-lived
  signed URL (see [docs/33](33-media-and-storage-security.md)). There is
  no `images.remotePatterns` to add, and adding one unused would be scope
  the brief explicitly warns against ("no abrir dominios... si no hace
  falta").

## Cookies (verified, not changed)

Both cookie-setting call sites already do the right thing —
**nothing was weakened to "make it work" on Render**:

```ts
// src/lib/portal/tokens.ts — portalSessionCookieOptions()
// src/lib/auth/tenant.ts — activeTenantCookieOptions()
{ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", ... }
```

`next start` (what `npm start` runs, and what Render's Node runtime
executes) always sets `NODE_ENV=production` — so `secure: true` applies
automatically on Render, and Render's `*.onrender.com` domains are HTTPS
by default, so secure cookies work without any extra configuration. The
portal session cookie's `path` stays scoped to `/p/<token>` (unchanged
since Phase 3A) — no broadening was needed or made.

## Supabase staging strategy

**Option A (this phase's recommendation): deploy Render against the
existing `scopevia-test` project.** Acceptable for a first closed beta —
it already has RLS fully verified across every phase's test suite, the
service role is already server-side-only, and no production project
exists yet to conflict with. **Requirements before inviting real
testers**: only demo/controlled client data (never anything sensitive),
limited access (invite-only — see "Tester access plan"), and this project
must **never** be treated as the final production database once real
customer data matters — see [docs/65](65-render-environment-variables.md)
for exactly which Supabase values Render needs and where to find them.

**Option B (documented for later, not built this phase): a dedicated
Supabase staging project**, cleanly separated from local development.
Would require: applying every migration (`supabase db push` against the
new project — the exact same migration files already in
`supabase/migrations/`, no changes needed), seeding demo data, configuring
Auth URLs and Storage on the new project, and pointing Render at its
credentials instead. **This phase does not create that project** — no
`supabase db reset` or other destructive command was run against
anything, and `scopevia-test` itself was never modified.

## Supabase Auth URLs

**Now that the Render URL is known (`https://scopevia.onrender.com`), set
this exactly** — Dashboard → Authentication → URL Configuration:

```text
Site URL:
https://scopevia.onrender.com

Redirect URLs:
https://scopevia.onrender.com/**
http://localhost:3000/**
```

This is a **Supabase dashboard setting** — nothing in this repo can
configure it. It's the single most important step for email confirmation/
password-reset links to work correctly: Supabase validates whatever
`emailRedirectTo`/`redirectTo` the app requests (see
`src/actions/auth.ts`) against this **Redirect URLs** allow-list; if the
requested URL isn't on the list, Supabase silently falls back to **Site
URL** instead. A Site URL still set to `http://localhost:3000` (the
default on every new Supabase project, never updated until now) is
exactly why confirmation emails from the deployed app were linking to
localhost — see [docs/67-auth-confirmation-url-fix.md](67-auth-confirmation-url-fix.md)
for the full root-cause writeup and the code-side fix that shipped
alongside this dashboard change.

## Known limitations

- **This phase cannot actually deploy to Render** — no access to a Render
  account. Everything here is code/config/documentation preparation; the
  actual "create the service" step is manual (see the final report's
  step-by-step).
- **No dedicated Supabase staging project** — Option A (`scopevia-test`)
  is what's documented and ready; Option B is documented but not built.
- **`NEXT_PUBLIC_SITE_URL` is not enforced by `validateStagingEnv()`** —
  see "Pre-deploy hardening reviewed" above for why, and why it must
  still be set correctly by hand.
- **No CI pipeline** — `predeploy:staging` is a local/manual script, not
  wired into a GitHub Action or Render's own pre-deploy hook.
