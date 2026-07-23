# 68 — Auth Callback Localhost Redirect Fix (post-confirmation landing page)

Status: **Fixed.** Follow-up to [docs/67](67-auth-confirmation-url-fix.md).
Reported symptom: Supabase's confirmation email correctly carried
`redirect_to=https://scopevia.onrender.com/auth/callback` (docs/67's fix
was working), but after clicking it and confirming, the app's *own* final
redirect still landed the user on `localhost`.

## Root cause

**`src/app/auth/callback/route.ts`** built its final redirect from
`new URL(request.url).origin` — the origin of the incoming request *as
this Node route handler saw it*, not necessarily the public host the
browser actually used. Behind Render's proxy, a plain (non-Edge) Next.js
route handler's `request.url` is not guaranteed to reflect the
internet-facing hostname — it can resolve to an internal address. So even
though:

1. Supabase correctly sent the user to
   `https://scopevia.onrender.com/auth/callback?code=...` (confirmed
   correct by docs/67's fix — Site URL / Redirect URLs were the real
   blocker there, and that part was working), and
2. `exchangeCodeForSession(code)` succeeded and set a real session cookie,

...the *final* `NextResponse.redirect(`${origin}${next}`)` call used an
`origin` derived from the request's internal view of itself, which could
be `localhost` (or some other non-public address) rather than
`https://scopevia.onrender.com`. This is a distinct bug from docs/67's —
docs/67 was about what URL Supabase Auth is *allowed* to send the user to
in the first place; this one is about what URL *this app's own code*
redirects to *after* that.

## Exact file that caused localhost

**`src/app/auth/callback/route.ts`**, line 9 (before this fix):

```ts
const { searchParams, origin } = new URL(request.url);
// ...
return NextResponse.redirect(`${origin}${next}`);
```

## Changes made

- **`src/lib/auth/safe-redirect.ts`** (new) — `sanitizeNextPath(rawNext)`,
  a pure, unit-tested open-redirect guard. Only a same-origin relative
  path (starts with a single `/`, never `//`, never contains `://`) is
  accepted; anything else — missing, malformed, or an attempted external
  URL — falls back to `/sign-in`.
- **`src/app/auth/callback/route.ts`** — rewritten to never use
  `request.url`'s origin for the final redirect. Now:
  1. Reads `code` and `next` from `request.url`'s search params only
     (still fine — reading query params doesn't depend on host
     resolution).
  2. Sanitizes `next` via `sanitizeNextPath()`.
  3. Resolves the canonical app origin via `resolveSiteOrigin()`
     ([docs/67](67-auth-confirmation-url-fix.md)'s helper, reused
     as-is) — `NEXT_PUBLIC_SITE_URL` first, `APP_BASE_URL` second, the
     request's `Origin` header third, `http://localhost:3000` last.
  4. Exchanges the code for a session, then redirects to
     `new URL(safeNext, canonicalOrigin)` on success, or
     `new URL("/sign-in?error=auth_callback_failed", canonicalOrigin)` on
     failure — **never** built from `request.url`'s own origin.
- **`src/actions/auth.ts`**:
  - `signUpAction()`'s `emailRedirectTo` now includes `?next=/sign-in`
    explicitly (`${origin}/auth/callback?next=/sign-in`) — a confirmed
    signup lands the user on the sign-in page, per this fix's acceptance
    criteria, not silently defaulted.
  - `siteOrigin()` (used by both `signUpAction()` and
    `forgotPasswordAction()`) now also falls back to `APP_BASE_URL`
    before the `Origin` header — the same priority chain as the callback
    route, so both halves of the round trip (the link Supabase sends, and
    the page this app redirects to afterward) always agree on the same
    canonical host.
- **`forgotPasswordAction()`** — unchanged in intent: still requests
  `next=/reset-password` (a real, deliberate destination, not this fix's
  concern) — verified it still passes `sanitizeNextPath()` unchanged.

**`src/proxy.ts`** was reviewed (it also does a couple of
`request.url`-based redirects, for the signed-out → `/sign-in` case) and
deliberately **left unchanged** — those run in the middleware/Edge
runtime, where `NextRequest`'s URL resolution is handled differently by
Next.js than a plain Node route handler's `request.url`, and this bug was
never reported there. Out of scope for this fix; flagged here for
completeness per the "review the whole repo" instruction.

## Variables required on Render

Unchanged from [docs/65](65-render-environment-variables.md) — this fix
didn't add a new variable, it fixed how two existing ones
(`NEXT_PUBLIC_SITE_URL`, `APP_BASE_URL`) are actually used:

```text
NEXT_PUBLIC_SITE_URL=https://scopevia.onrender.com
APP_BASE_URL=https://scopevia.onrender.com
```

Both should be set to the same value in this app. `NEXT_PUBLIC_SITE_URL`
is checked first; `APP_BASE_URL` only matters as a fallback if the former
is ever missing — setting both removes any ambiguity.

## Exact Supabase Dashboard configuration

Unchanged from [docs/67](67-auth-confirmation-url-fix.md) — already
confirmed working for the `redirect_to` half of this flow:

```text
Site URL:
https://scopevia.onrender.com

Redirect URLs:
https://scopevia.onrender.com/**
http://localhost:3000/**
```

## How to test with a new user

1. Confirm the Render env vars and Supabase Dashboard values above.
2. Sign up on the deployed Render URL with a real, reachable email.
3. Confirm the email link still starts with
   `https://scopevia.onrender.com/auth/callback?code=...&next=/sign-in`
   (docs/67's fix).
4. Click it — the FINAL page you land on, after the redirect completes,
   must be `https://scopevia.onrender.com/sign-in` — never
   `localhost` at any point, even momentarily in the browser's address
   bar during the redirect.
5. Separately, confirm password reset still lands on
   `https://scopevia.onrender.com/reset-password` (its own intended
   `next`, unaffected by this fix).
6. Locally (`npm run dev`), repeat signup with a different test email —
   confirm the final landing page is `http://localhost:3000/sign-in`.

## Tests run

`npm run typecheck`, `npm run lint`, `npm test` (260/260, +7 new for
`sanitizeNextPath()`), `npm run build`, and
`npx playwright test tests/e2e/auth-callback.spec.ts tests/e2e/auth.spec.ts`
(14/14 — 3 new smoke tests for the callback route's no-code and
open-redirect-attempt paths, plus the existing sign-in/redirect suite
confirming no regression). A real `code` requires a genuine Supabase PKCE
round trip (an actual confirmation/reset email) and isn't reproducible in
an automated test — the manual steps above are the only way to verify the
success-path redirect against a real deployment.
