# 67 — Auth Confirmation/Reset URL Fix (Render staging)

Status: **Fixed.** Reported symptom: Supabase Auth confirmation emails
sent from the deployed Render app linked to `http://localhost:3000`
instead of `https://scopevia.onrender.com`.

> **Follow-up:** once this fix made the confirmation *link itself* correct,
> a second, distinct bug surfaced — the app's own `/auth/callback` route
> still redirected to `localhost` on the FINAL hop, after a successful
> confirmation. See
> [docs/68-auth-callback-localhost-redirect-fix.md](68-auth-callback-localhost-redirect-fix.md).

## Root cause

Two independent problems, both traced back to the same underlying gap:
**Supabase Auth's own Dashboard "Site URL"/"Redirect URLs" were never
updated away from their default `localhost` value**, which is a manual
step [docs/64](64-render-staging-deployment.md) had already flagged as
outstanding.

1. **Primary cause — Supabase Dashboard config.** `signUp()`
   (`src/actions/auth.ts`) asks Supabase to use
   `emailRedirectTo: "<site origin>/auth/callback"` for the confirmation
   link. Supabase Auth only honors that request if the URL matches an
   entry in Dashboard → Authentication → URL Configuration → **Redirect
   URLs**. If it doesn't match anything there, Supabase silently ignores
   it and falls back to **Site URL** instead. Since that project's Site
   URL had never been changed from its default (`http://localhost:3000`,
   set the day the Supabase project was created), **every confirmation
   email linked to localhost regardless of what the app requested** — a
   dashboard setting, not something any code change alone can fix. See
   "Exact Supabase Dashboard configuration" below.
2. **Contributing cause — a stale `.env.local` edit.** Someone had
   directly edited this repo's own `.env.local` — `NEXT_PUBLIC_SITE_URL`
   was set to `https://scopevia.onrender.com`. This had **zero effect on
   the actual Render deployment** (`.env.local` is gitignored and never
   reaches Render; Render only reads its own dashboard-configured env
   vars, entirely separate from this file) — but it silently broke local
   development instead, since local sign-ups would have started
   requesting a Render redirect URL. Reverted to
   `http://localhost:3000`.
3. **Secondary, code-level hardening.** `siteOrigin()` (the helper that
   builds the `emailRedirectTo`/`redirectTo` value) previously checked the
   request's `Origin` **header** before `NEXT_PUBLIC_SITE_URL`. Trusting a
   runtime header for something baked into an outbound email is less
   deterministic than an explicit, per-environment env var — exactly the
   brief's own instruction ("No hardcodear localhost en producción. Usar
   NEXT_PUBLIC_SITE_URL o helper equivalente"). Flipped so the env var
   wins whenever it's set.

## Files reviewed

- `src/actions/auth.ts` — `signUpAction()`, `forgotPasswordAction()`,
  and the `siteOrigin()` helper both use.
- `src/app/auth/callback/route.ts` — the PKCE code-exchange callback.
  Reviewed, **not changed** — it derives its own redirect target from
  `new URL(request.url).origin` (wherever the browser actually landed),
  which is correct by construction once the *email link itself* points
  to the right host.
- `src/app/(auth)/sign-up/page.tsx`, `src/lib/validation/schemas.ts`
  (`signUpSchema`) — reviewed, no issue found, unchanged.
- `.env.example`, `.env.local` — reviewed; `.env.local` had the stale
  edit described above (fixed); `.env.example`'s own comment for
  `NEXT_PUBLIC_SITE_URL` was out of date (described it as only a
  fallback-for-missing-header) and has been corrected.
- `src/lib/notifications/internal-url.ts` (Phase 3D's `APP_BASE_URL`
  helper) and `src/actions/portal-links.ts` — reviewed for the same class
  of bug. Both already prioritize their env var correctly; no change
  needed.

## Changes made

- **`src/lib/auth/site-origin.ts`** (new) — `resolveSiteOrigin(envSiteUrl,
  originHeader)`, a pure, unit-tested function: `NEXT_PUBLIC_SITE_URL` wins
  whenever set (trimmed, trailing slash stripped); the `Origin` header is
  a fallback; a hardcoded `http://localhost:3000` is the last resort for
  zero-config local dev only.
- **`src/actions/auth.ts`** — `siteOrigin()` now calls
  `resolveSiteOrigin()` instead of inlining the (backwards) priority
  order. Both `signUpAction()` and `forgotPasswordAction()` use this
  helper — both fixed by the same change.
- **`.env.local`** — reverted `NEXT_PUBLIC_SITE_URL` back to
  `http://localhost:3000` (the stale Render-URL edit described above).
- **`.env.example`** — corrected the `NEXT_PUBLIC_SITE_URL` comment to
  describe its real, corrected behavior and explicitly warn that this
  value must be set per-environment and must also be added to Supabase's
  Redirect URLs allow-list.
- **`docs/64-render-staging-deployment.md`** — the "Supabase Auth URLs"
  section now has the exact, concrete values to enter (previously it
  could only say "once known").

## Exact Supabase Dashboard configuration

Dashboard → Authentication → URL Configuration:

```text
Site URL:
https://scopevia.onrender.com

Redirect URLs:
https://scopevia.onrender.com/**
http://localhost:3000/**
```

**This is the fix that actually matters** — the code-side changes above
are correctness/hardening, but without this dashboard change, Supabase
will keep falling back to whatever Site URL is currently set, regardless
of what the app requests.

## Which Supabase email template variable to use

Supabase's own "Confirm signup" template (Dashboard → Authentication →
Email Templates) should use **`{{ .ConfirmationURL }}`** — this is
Supabase's default and should not be changed. `{{ .ConfirmationURL }}` is
a fully-formed link that already incorporates both the verification
token *and* the `redirect_to` value the app requested (`emailRedirectTo`)
— clicking it verifies the token first, then lands the user on
`/auth/callback?code=...` (this app's PKCE flow, confirmed by
`exchangeCodeForSession(code)` in `src/app/auth/callback/route.ts`).

**Do not use `{{ .RedirectTo }}` alone as the link** — that variable is
just the raw redirect target with no verification token attached; a
template built around it would send an unverified link. The "Reset
password" template should likewise keep `{{ .ConfirmationURL }}` — the
same mechanism handles `resetPasswordForEmail()`'s `redirectTo` value.

If the current template has been manually edited away from
`{{ .ConfirmationURL }}` (e.g. to a bare `{{ .SiteURL }}` or a hand-typed
link), that would be a second, independent source of the same symptom —
worth checking directly in the dashboard alongside the URL Configuration
values above.

## How to test with a new user

1. Confirm the Supabase Dashboard values above are set.
2. Confirm Render's `NEXT_PUBLIC_SITE_URL` env var is
   `https://scopevia.onrender.com` (Render dashboard, not this repo —
   see [docs/65](65-render-environment-variables.md)).
3. On the deployed Render URL, sign up with a real, reachable email
   address you don't already have an account with.
4. Open the confirmation email — the link must start with
   `https://scopevia.onrender.com/auth/callback?code=...`, never
   `localhost`.
5. Click it — should land signed-in, redirected past `/auth/callback`
   into the app (`/select-tenant` or `/`, depending on tenant state).
6. Separately, confirm **local** dev is unaffected: run `npm run dev`,
   sign up with a different test email, and confirm that confirmation
   link starts with `http://localhost:3000/auth/callback?code=...`.

## Tests run

`npm run typecheck`, `npm run lint`, `npm test` (253/253, +6 new for
`resolveSiteOrigin()`), `npm run build`, and a targeted
`npx playwright test tests/e2e/auth.spec.ts` re-run (11/11) to confirm no
regression to sign-in/protected-route behavior. No RLS/E2E test in this
repo exercises Supabase's own signup-confirmation email (it's a
Supabase-hosted template, not app code) — verifying the actual email
content requires the manual steps above against a real deployment.
