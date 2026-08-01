# 65 — Render Environment Variables Reference (Phase 3D.1)

Status: **Reference document.** Every variable name here was confirmed by
searching the actual source (`grep -rhoE "process\.env\.[A-Z_]+" src/`),
not guessed. No real values appear anywhere in this document, `render.yaml`,
or any file in this repo — every secret is entered directly in the Render
dashboard, once, by whoever runs the manual setup.

## Public (client-side) variables

Safe to expose to the browser bundle — Next.js inlines any `NEXT_PUBLIC_*`
variable into client-side JavaScript at build time. None of these are
secrets, but they're still only correct when set to the right values for
the environment being deployed.

| Variable | Purpose | Used in |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | The Supabase project's API URL | Every Supabase client (browser, server, admin) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The Supabase project's anonymous/public API key (RLS-gated, safe to expose by design) | Every Supabase client |
| `NEXT_PUBLIC_SITE_URL` | Base URL for Supabase Auth redirect flows (email confirmation, password reset) when a request's Origin header is unavailable | `src/actions/auth.ts`, `src/actions/portal-links.ts` |
| `NEXT_PUBLIC_APP_ENV` | Purely descriptive label shown on `/api/health` (`development`/`staging`/`production`) — never used for a security decision | `src/app/api/health/route.ts` |
| `NEXT_PUBLIC_ADDRESS_AUTOCOMPLETE_PROVIDER` | Optional. Address autocomplete provider name (only `google_places` is recognized today). Unset or unrecognized → address autocomplete is off; the Street address field is a plain text input — never required, never blocks client creation | `src/lib/address/autocomplete-provider.ts`, `src/components/address-fields.tsx` |
| `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` | Optional. Only takes effect when `NEXT_PUBLIC_ADDRESS_AUTOCOMPLETE_PROVIDER=google_places` is also set. **Not currently read by any actual autocomplete widget** — no Google Places SDK is loaded in this phase (see [docs/73](73-client-address-and-material-zip-defaults.md)); this var only flips the resolved provider from `"none"` to `"google_places"` for a future integration. If a real key is ever set here, it must be a **public, browser-restricted** key (HTTP referrer restriction in the Google Cloud Console) — never a server/unrestricted key, since `NEXT_PUBLIC_*` vars are bundled into client-side JavaScript | `src/lib/address/autocomplete-provider.ts` |

## Server-only secrets

**Never** prefix any of these with `NEXT_PUBLIC_`. All are read only in
server-side code (`import "server-only"` modules, Server Actions, route
handlers) and never bundled for the browser.

| Variable | Purpose | Used in |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS entirely — the admin client used for portal-visitor flows (no Supabase Auth session) | `src/lib/supabase/admin.ts` |
| `APP_BASE_URL` | Base URL for the "Open in Scopevia" link inside notification emails; if unset, emails still send, just without that link | `src/lib/notifications/internal-url.ts` |
| `EMAIL_PROVIDER` | `dev` (local capture, default) or `resend` (real send) — `sendgrid`/`smtp` are recognized names that fail loudly, not silently | `src/lib/email/provider-selection.ts` |
| `RESEND_API_KEY` | Resend API key — required when `EMAIL_PROVIDER=resend` | `src/lib/email/providers/resend.ts`, `resend-generic.ts` |
| `EMAIL_FROM` | Verified sender address in Resend — required when `EMAIL_PROVIDER=resend` | Same as above |
| `EMAIL_REPLY_TO` | Optional reply-to address for outgoing email | Same as above |
| `EMAIL_ALLOW_DEV_PROVIDER_IN_PRODUCTION` | Dangerous override allowing `EMAIL_PROVIDER=dev` under `NODE_ENV=production` — **must never be set on a public Render deployment**; exists only for local/CI E2E runs | `src/lib/email/provider-selection.ts` |

## Rules (unchanged from every prior phase, restated here for this deployment)

- Never give `SUPABASE_SERVICE_ROLE_KEY` a `NEXT_PUBLIC_` prefix, ever.
- Never give `RESEND_API_KEY` a `NEXT_PUBLIC_` prefix, ever.
- Never commit `.env.local` — it's gitignored (verified:
  `git check-ignore -v .env.local`).
- Render receives every secret from its dashboard (or, via the
  `render.yaml` Blueprint's `sync: false` fields, a one-time manual
  entry prompt) — never from a file in this repository.
- For a **public staging deployment with real testers**, `EMAIL_PROVIDER`
  must be `resend`, not `dev` — see
  [docs/62](62-proposal-email-notifications.md). `instrumentation.ts`
  refuses to start the server at all if this rule (or the required
  Resend config) is violated — see
  [docs/64](64-render-staging-deployment.md), "Fail fast, not fail
  quiet."

## Where to get each value (no values reproduced here)

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → the target project (`scopevia-test`, or a dedicated staging project — see docs/64) → Project Settings → API |
| `NEXT_PUBLIC_SITE_URL` / `APP_BASE_URL` | The Render service's own URL, once assigned (e.g. `https://scopevia-staging.onrender.com`) — both should match |
| `RESEND_API_KEY` | Resend Dashboard → API Keys |
| `EMAIL_FROM` | Resend Dashboard → a verified sending domain/address |
| `EMAIL_REPLY_TO` | Whatever inbox should receive tester replies (a real, monitored address) |
| `NEXT_PUBLIC_APP_ENV` | Not fetched from anywhere — just type `staging` |
| `EMAIL_PROVIDER` | Not fetched from anywhere — just type `resend` |
| `NEXT_PUBLIC_ADDRESS_AUTOCOMPLETE_PROVIDER` / `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` | Optional — leave unset for this phase. Address autocomplete works fine with plain manual entry with neither set; see [docs/73](73-client-address-and-material-zip-defaults.md) |
