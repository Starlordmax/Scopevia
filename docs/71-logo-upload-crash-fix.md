# 71 — Logo Upload Crash Fix

Status: **Fixed** (in two rounds — see "Update" below for the second,
final fix; the original section below is left intact as a historical
record of the first attempt, which was a real, verified improvement but
did not fully close the bug class). Reported symptom: uploading a logo
from Profile → Business branding crashed the whole page with Next.js's
generic `"This page couldn't load. A server error occurred. Reload to try
again."`

## Update — the first fix (raising `bodySizeLimit`) was necessary but not sufficient

The first round (original sections below) raised
`experimental.serverActions.bodySizeLimit` from Next.js's 1 MB default to
`"10mb"`. That genuinely fixed the reported crash for the file sizes
tested at the time (1.5–1.8 MB) — verified then, and still true now.

**But it could never have been a complete fix, for a structural reason**:
a Server Action's `bodySizeLimit` is a hard ceiling enforced by Next.js's
own request parser, and *anything over that ceiling* is rejected the exact
same way — an uncaught exception, before any application code runs, no
matter what the ceiling is set to. Raising it from 1 MB to 10 MB only
moved the crash threshold; it could not make a file *over* the new
ceiling fail gracefully. Confirmed by direct reproduction: a 12 MB upload
(now above the 10 MB ceiling) crashed with the exact same
`"This page couldn't load"` / `POST /profile → 500` / `Error: Body
exceeded 1 MB limit` (Next.js's own message, unchanged text, just firing
at the new 10 MB threshold) — the acceptance criteria explicitly requires
a *friendly* message for anything over the limit, which a Server Action's
`bodySizeLimit` mechanism cannot provide by construction.

### Real fix: move upload off Server Actions entirely, onto a Route Handler

**`POST /api/business-branding/logo`** (`src/app/api/business-branding/logo/route.ts`,
new) replaces `uploadBusinessLogoAction()`, which has been deleted. A
Route Handler has no framework-enforced body size ceiling — it receives
the raw `Request` and validates it with ordinary application code, so
*any* size, from empty to gigabytes, always gets a clean, typed JSON
response instead of a framework-level crash:

- A cheap `Content-Length` header pre-check rejects grossly oversized
  requests (over ~11 MB) with a `413` before the body is ever buffered
  into memory — defense against someone deliberately posting a huge
  payload, now that there's no Next.js-provided ceiling to lean on at all.
- The real size/MIME validation (`validateLogoFile()`, unchanged pure
  logic) then gives the precise, friendly `"Please upload a PNG, JPG, or
  WEBP image under 10 MB."` for anything between roughly 10 MB and 11 MB
  that slips past the cheap pre-check due to multipart overhead.
- Everything else — auth check, tenant/permission validation (still
  enforced authoritatively by `update_tenant_branding()`'s own
  `tenant.update` check, unchanged), Storage upload, DB update, old-file
  cleanup, `revalidatePath("/profile")` — is the same logic
  `uploadBusinessLogoAction()` had, just returning `NextResponse.json(...)`
  instead of an `ActionResult`.

`src/app/(protected)/profile/business-branding-card.tsx` now submits the
upload form via a plain `onSubmit` handler calling `fetch("/api/business-branding/logo",
{ method: "POST", body: formData })`, manages its own
pending/error/success state with `useState` (since `useFormStatus`/
`useActionState` only work with a real Server Action reference), and calls
`router.refresh()` on success so the newly-revalidated server data
(the new `logoUrl`) re-renders. **`removeBusinessLogoAction()` is
unchanged and stays a Server Action** — removal has no file body, so it
was never subject to this bug class, and moving it would have been an
unrelated, unrequested change.

### The logo limit itself is now 10 MB, not 2 MB (explicit ask)

Raised at every layer that previously enforced 2 MB — migration
`20260724100600_tenant_branding_10mb_limit.sql`:

- `src/lib/branding/logo-validation.ts`'s `MAX_LOGO_SIZE_BYTES`.
- The `tenant-branding` Storage bucket's `file_size_limit`.
- `tenants.logo_size_bytes`'s CHECK constraint.
- `update_tenant_branding()`'s own re-validation of `p_logo_size_bytes`.

10 MB was chosen to match this app's other already-shipped upload limit
(`src/lib/storage/media.ts`'s job/portfolio photos), not as a new,
unrelated ceiling — see [docs/69](69-business-branding-logo-upload.md)
and [docs/70](70-logo-storage-security.md), both updated throughout.

### A side-finding directly relevant to the brief's own `proxy.ts` hypothesis

The brief specifically asked whether `proxy.ts` needed
`proxyClientMaxBodySize`-style configuration. `proxy.ts` never reads the
request body (`updateSession()` only touches cookies), so it doesn't
itself impose a limit — but reproduction surfaced a related, previously
unknown Next.js 16 behavior: requests to any route matched by the app's
middleware (which includes `/api/*` routes, per `proxy.ts`'s own matcher)
trigger a *separate*, framework-level notice —
`middlewareClientMaxBodySize` (also defaulting to 10 MB) — logged as
`"Request body exceeded 10MB for /api/business-branding/logo. Only the
first 10MB will be available unless configured."` for a 15 MB test
upload. **This is informational, not a crash** — it silently truncates
rather than throwing — and harmless here specifically because the route
handler's own `Content-Length` pre-check already rejects anything that
large before the (possibly-truncated) body would ever be parsed. No
config change was needed for this; documented for completeness since it
was the brief's own explicit hypothesis.

### Tests (second round)

- `tests/rls/phase3d2-branding.test.ts`: bucket-limit assertion and
  oversized-file test updated to 10 MB; 20/20 passing.
- `tests/unit/logo-validation.test.ts`: size-boundary tests updated to
  `MAX_LOGO_SIZE_BYTES` (now 10 MB) and now assert the exact new friendly
  message; still pure/unit-level, no mocking needed.
- `tests/e2e/business-branding.spec.ts`: the prior 1.5 MB regression test
  replaced with two — a 9 MB upload (near the real limit, succeeds
  cleanly) and an 11 MB upload (over the limit, friendly rejection,
  explicitly asserting `"This page couldn't load"` never appears). Manual
  reproduction additionally confirmed a 15 MB request (well past both the
  app's 10 MB limit and the `Content-Length` pre-check threshold) is
  rejected cleanly with no crash.
- Full regression pass: `auth.spec.ts`, `proposals.spec.ts` (exercises the
  still-Server-Action-based portfolio photo upload, confirming that path
  is unaffected by moving *only* the logo upload to a Route Handler),
  `business-branding-portal.spec.ts`, `business-branding.mobile.spec.ts`
  — all passing.

### Files changed (second round)

Created: `src/app/api/business-branding/logo/route.ts`,
`supabase/migrations/20260724100600_tenant_branding_10mb_limit.sql`.
Modified: `src/actions/branding.ts` (removed `uploadBusinessLogoAction`),
`src/app/(protected)/profile/business-branding-card.tsx`,
`src/lib/branding/logo-validation.ts`, `tests/rls/phase3d2-branding.test.ts`,
`tests/unit/logo-validation.test.ts`, `tests/e2e/business-branding.spec.ts`,
`docs/69-business-branding-logo-upload.md`,
`docs/70-logo-storage-security.md`, `CHANGELOG.md`, `README.md`.

---

## Original fix (first round, kept for history)

## Root cause

**Next.js's own default Server Action body size limit (1 MB) rejected the
request before `uploadBusinessLogoAction()` ever ran.** `next.config.ts`
never configured `experimental.serverActions.bodySizeLimit`, so any file
over 1 MB — a completely normal real-world logo size, well under this
app's own advertised 2 MB limit — was rejected by Next.js's request parser
itself, as an uncaught `413` at the framework layer:

```
⨯ Error: Body exceeded 1 MB limit.
To configure the body size limit for Server Actions, see: https://nextjs.org/docs/app/api-reference/next-config-js/serverActions#bodysizelimit
    statusCode: 413,
    digest: '3632640574@E394'
```

This happens **before** the Server Action's function body begins
executing — no `try/catch` inside `uploadBusinessLogoAction()` could ever
have caught it. The generic Next.js error boundary (production mode only —
this is why the crash reproduced with `npm run build && npm start` but
would show a full stack-trace overlay in `npm run dev` instead) took over,
producing exactly the reported "This page couldn't load" message with a
digest and no other detail.

Confirmed by direct reproduction: a real Playwright-driven upload of a
1.5 MB file crashed with `POST /profile → 500` before the fix, and
succeeded (`POST /profile → 200`, "Logo uploaded successfully.", preview
shown) after it — see "Files modified" below.

**This same gap already existed for every other file upload in the app.**
`src/lib/storage/media.ts` already advertises support for photos up to
10 MB (current-job and portfolio photos), so those Server Actions had the
identical latent bug — simply never hit, because no test or manual upload
had used a file over 1 MB before this report.

## Files reviewed

Per the brief's own checklist — confirmed NOT the cause:

- `tenant-branding` Storage bucket: exists, private, correct 2 MB /
  PNG-JPEG-WEBP limits (`supabase/migrations/20260723100100_tenant_branding_storage.sql`,
  verified applied via `npx supabase migration list` — no drift).
- Storage/RLS policies: correct, tenant-scoped, verified by
  `tests/rls/phase3d2-branding.test.ts` (20/20 passing before and after
  this fix).
- `uploadBusinessLogoAction()` / `removeBusinessLogoAction()`
  (`src/actions/branding.ts`): use the caller's own session client (never
  service role) for the RPC calls — correct, matches every other action in
  the app.
- Permission check (`tenant.update`, reused from Phase 0): working
  correctly — verified via RLS tests and the "You don't have permission…"
  message path.
- `FormData`/input `name` (`file`) match between the client form
  (`business-branding-card.tsx`) and the action: correct.
- File size/MIME validation (`src/lib/branding/logo-validation.ts`):
  correct, and — once the Next.js limit was raised — confirmed to still
  correctly reject an over-2MB file with a friendly message rather than
  crash.
- Signed URL generation (`getSignedBrandingUrl()`,
  `src/lib/storage/branding.ts`) and its `null`-safe fallback
  (`getBusinessBranding()`, `src/lib/branding/data.ts`): already correct
  from Phase 3D.2 — a missing/failed signed URL already degraded to
  "no logo" (business-name fallback) rather than rendering `null`/`undefined`.
- Render staging env vars: not implicated — this is a build-time
  application config, not an environment variable, so it applies
  identically in every environment once shipped.

## Changes made

### 1. `next.config.ts` — the actual fix

```ts
experimental: {
  serverActions: {
    bodySizeLimit: "10mb",
  },
},
```

Set to the app's own already-largest advertised file-upload limit
(`media.ts`'s 10 MB), not a new/arbitrary allowance — this single global
setting also fixes the identical latent bug for current-job and portfolio
photo uploads, which were equally exposed before this fix.

### 2. `src/actions/branding.ts` — defense in depth

The Next.js config change is the fix for the *reported* crash. The brief
additionally asked for the action itself to never let an unexpected
exception escape to Next.js's error boundary, regardless of cause — added:

- The bulk of each action (everything after cheap synchronous validation)
  is now wrapped in `try/catch`. Any unexpected exception (a Storage
  network error, a database outage, anything not already returned as a
  handled `{error}` value) is caught, logged server-side
  (`console.error("Business logo upload failed:", error)`), and turned
  into a friendly `{error: "We couldn't upload the logo right now. Please
  try again."}` — never left to propagate uncaught.
- `requireUser()` is deliberately kept **outside** the `try/catch` — it
  signals an unauthenticated visitor via Next.js's own `redirect()`, which
  throws a special, framework-recognized value that must never be caught
  and swallowed.
- RPC permission errors (`error.code === "42501"`) now map to a
  branding-specific message, `"You don't have permission to update
  business branding."`, ahead of the generic `friendlyRpcErrorMessage()`
  fallback.
- Both actions now return `{ message: "Logo uploaded successfully." }` /
  `{ message: "Logo removed." }` on success, instead of an empty `{}`.

### 3. `src/actions/auth.ts` — shared type

`ActionResult` gained an optional `message?: string` field (alongside the
existing `error?: string`) so any action — not just branding — can report
a success message the same way. Purely additive; no other action's
behavior changes.

### 4. `src/app/(protected)/profile/business-branding-card.tsx` — UI

Renders `uploadState.message` / `removeState.message` in a new
`.success-banner` (`src/app/globals.css`, mirrors the existing
`.error-banner` with the app's success color tokens) whenever present.

## Storage/DB verification

No migration was needed — this bug was entirely an application/framework
configuration gap, not a database issue. Confirmed via
`npx supabase migration list`: no drift before or after this fix. Bucket,
policies, and RLS were already correct (Phase 3D.2) and remain unchanged.

## UI behavior

| Scenario | Message shown |
|---|---|
| Valid upload | "Logo uploaded successfully." + preview image |
| Valid removal | "Logo removed." + fallback business-name text |
| Wrong file type | "Only PNG, JPG, or WEBP images are supported." |
| Oversized file (client-caught) | "Logo files must be 2 MB or smaller." |
| No permission | "You don't have permission to update business branding." |
| Unexpected Storage/DB error | "We couldn't upload the logo right now. Please try again." |

Never shown: SQL, RPC names, stack traces, storage paths, bucket
internals, UUIDs, or "This page couldn't load."

## Security review

Unchanged from [docs/70](70-logo-storage-security.md) — no security
boundary was touched by this fix. Re-verified: `tests/rls/phase3d2-branding.test.ts`
(20/20 passing) still confirms tenant isolation, the full Owner/Admin
vs. everyone-else permission matrix, private bucket enforcement, and
storage-path tenant-scoping, all unaffected by the config/error-handling
changes.

## Tests

- `npm run typecheck`, `npm run lint`, `npm run build`: all clean.
- `npm test`: 277/277 unit tests passing (unchanged — no new pure-logic
  extraction was needed; the root cause was a framework config, not
  application logic).
- `tests/rls/phase3d2-branding.test.ts`: 20/20 passing.
- `tests/e2e/business-branding.spec.ts`: **new regression test added** —
  "a realistic-size logo (1.5 MB) uploads successfully without crashing
  the page." The existing tests all used a 67-byte fixture image
  (`fixtures/one-pixel.png`), which could never have caught this class of
  bug — real file sizes were required to reproduce and to guard against
  regression. 11/11 branding E2E tests passing (desktop + portal +
  mobile), plus a full regression pass of `auth.spec.ts`,
  `auth-callback.spec.ts`, and `proposals.spec.ts` (which exercises the
  portfolio photo upload flow that shares this same fix) — all passing.
- Manual reproduction (outside the permanent suite, before/after):
  confirmed the exact crash with a 1.5 MB file pre-fix (`POST /profile →
  500`, server log showing `Error: Body exceeded 1 MB limit.`), and
  confirmed the fix with the same file post-fix (`POST /profile → 200`).

## Files modified

- `next.config.ts`
- `src/actions/branding.ts`
- `src/actions/auth.ts`
- `src/app/(protected)/profile/business-branding-card.tsx`
- `src/app/globals.css`
- `tests/e2e/business-branding.spec.ts`

## Files created

- `docs/71-logo-upload-crash-fix.md` (this file)

## Staging notes

No new environment variables, no new migration, nothing to configure in
the Supabase dashboard. The fix is purely in the deployed application
build (`next.config.ts`) — it takes effect automatically on the next
Render deploy. Recommended manual check after deploying: upload a real,
normal-size logo photo (typically several hundred KB to a couple of MB)
from Profile → Business branding and confirm the success message and
preview appear, with no "This page couldn't load."
