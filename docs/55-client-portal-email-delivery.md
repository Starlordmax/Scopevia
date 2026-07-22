# 55 — Client Portal Email Delivery (Phase 3A.1)

Status: **Implemented** — a real provider path (Resend) exists and is
unit-tested; the dev/test capture path is hardened against accidentally
running in a real production deployment. See "Known limitations" for what
manual verification (a real Resend send) was **not** executed this phase.

> **Phase 3D.1 adds a startup-time check** (`src/instrumentation.ts` +
> `src/lib/env-validation.ts`) that refuses to boot a production/staging
> server at all if `EMAIL_PROVIDER=resend` is missing `RESEND_API_KEY`/
> `EMAIL_FROM`, or if `EMAIL_PROVIDER=dev` is left on without the
> production override — enforcing this doc's own rules one step earlier
> (at boot, not just at send-time) — see
> [docs/64-render-staging-deployment.md](64-render-staging-deployment.md).
>
> **Phase 3D reuses `resolveEmailProvider()`/`validateResendConfig()`
> unchanged** for a second, generic sender
> (`src/lib/email/send.ts`, deliberately separate from
> `sendPortalCodeEmail()` below — the OTP path here is completely
> untouched) powering Client Portal event notifications — see
> [docs/62-proposal-email-notifications.md](62-proposal-email-notifications.md).

## Why this phase exists

Phase 3A shipped the Client Portal's full flow — link, OTP, session,
view — but `sendPortalCodeEmail()` had exactly one implementation: log the
code server-side and write it to a local file. That's fine for tests, but
it meant no real client could ever actually receive a code. This phase
replaces that single hard-coded path with a provider abstraction: `dev`
(unchanged behavior, now one option among several) and `resend` (a real
HTTP-based send), plus two recognized-but-not-implemented placeholders
(`sendgrid`, `smtp`) that fail loudly and specifically rather than silently
doing nothing.

## Architecture

```text
sendPortalCodeEmail(input)              <- the ONLY public entry point,
  │                                        unchanged signature, unchanged
  │                                        callers (src/actions/portal-visitor.ts)
  ▼
resolveEmailProvider(env)               <- PURE, unit-tested directly
  │                                        (src/lib/email/provider-selection.ts)
  ├─ "dev"     → sendViaDevCapture()    <- src/lib/email/providers/dev.ts
  ├─ "resend"  → sendViaResend()        <- src/lib/email/providers/resend.ts
  ├─ "sendgrid"│smtp → throws "not implemented yet"
  └─ unknown   → throws "Unknown EMAIL_PROVIDER"
```

`renderPortalCodeEmail()` (`src/lib/email/templates/portal-code.ts`) is
shared by every real provider (currently just `resend`) — one template,
tested once (`tests/unit/email-template.test.ts`), reused everywhere a
provider actually sends. `dev` mode doesn't render it at all — it only
ever needs the raw code for its local capture file, never a formatted
email.

**Why `resolveEmailProvider()` and `validateResendConfig()` are separate,
plain functions, not methods on the provider modules themselves:**
`sendPortalCodeEmail()` and every provider's actual `send*()` function have
`import "server-only"`, which throws unconditionally if imported outside a
bundler that aliases it away (see docs/53's discussion of this same
constraint for `src/lib/portal/tokens.ts`) — so none of them can be
imported directly into a plain Vitest unit test. Both of these specific,
security-relevant decisions (which provider, and is `resend` fully
configured) are instead pure functions that take their inputs explicitly
(`env: {...}`) rather than reading `process.env` themselves, so they're
directly unit-tested without needing `server-only` at all — see
`tests/unit/email-provider-selection.test.ts`.

## Environment variables

See `.env.example` for the authoritative list with full comments. Names
only, documented here — never a real value:

| Variable | Required when | Purpose |
|---|---|---|
| `EMAIL_PROVIDER` | Never (defaults to `dev`) | `dev` \| `resend` \| `sendgrid` (not implemented) \| `smtp` (not implemented) |
| `RESEND_API_KEY` | `EMAIL_PROVIDER=resend` | Resend API key — never logged, never in the browser bundle |
| `EMAIL_FROM` | `EMAIL_PROVIDER=resend` | The verified sending address configured in Resend |
| `EMAIL_REPLY_TO` | Optional, `resend` only | Reply-to address shown to the client |
| `EMAIL_ALLOW_DEV_PROVIDER_IN_PRODUCTION` | Only in a gitignored `.env.local`/CI secret, never a real deployment | The dangerous, explicit override described below |

## Dev/test mode

Unchanged in behavior from Phase 3A, now formally one branch of the
provider dispatch instead of the only path: the code is logged
server-side (`console.log`, never sent to the browser, never persisted in
the database in plaintext — only its hash is) and written to a gitignored,
per-email capture file (`.portal-otp-dev/<sha256(email)>.json`) that
`tests/e2e/fixtures/portal.ts`'s `getCapturedPortalOtpCode()` reads back
for Playwright.

## Production behavior when provider config is missing or wrong

- **`EMAIL_PROVIDER` unset or `dev`, and `NODE_ENV=production`, and
  `EMAIL_ALLOW_DEV_PROVIDER_IN_PRODUCTION` is not exactly `"true"`**:
  `sendPortalCodeEmail()` throws before attempting anything. This is the
  brief's explicit ask — "en producción, no permitir dev provider salvo
  que exista una variable explícita de override muy clara y peligrosa" —
  and is the one deliberately strict rule in this whole module.
- **`EMAIL_PROVIDER=resend` without `RESEND_API_KEY`/`EMAIL_FROM`**: throws
  immediately, naming exactly which variable(s) are missing (never their
  values) — regardless of environment, since choosing `resend` explicitly
  means you're claiming it's configured.
- **`EMAIL_PROVIDER=sendgrid` or `smtp`**: throws "not implemented yet" —
  recognized as valid provider *names* (so `.env.example` can mention them
  without a typo-detection false negative) but deliberately not wired up,
  to avoid the false confidence of a provider that looks configured but
  silently no-ops.
- **An unrecognized `EMAIL_PROVIDER` value**: throws "Unknown
  EMAIL_PROVIDER" — never silently falls back to `dev`.

### Why not just `NODE_ENV` — again

Phase 3A's first attempt at exactly this kind of guard used `NODE_ENV`
alone and broke the entire E2E suite, because this repo's Playwright
config always runs a production build (`next start` — see
`playwright.config.ts`'s `webServer`), and `next start` sets
`NODE_ENV=production` regardless of whether that's a real deployment or a
local/CI test run (see docs/54's writeup of that bug). This phase's guard
is stricter than Phase 3A's original ask (the brief now explicitly wants
production to refuse `dev`), so simply reverting to "gate on
`EMAIL_PROVIDER` only" wasn't an option — the fix instead adds a SECOND,
independent condition: `NODE_ENV=production` **AND** no explicit override.
`EMAIL_ALLOW_DEV_PROVIDER_IN_PRODUCTION=true` lives only in this repo's own
gitignored `.env.local` (loaded by `next start` the same way it's loaded
by `next dev`), which is definitionally never a real deployment's
environment — so the override is both the correct security signal (a real
deployment operator would never knowingly set anything with this name) and
the fix for local/CI testing, at the same time, not a workaround bolted on
to make tests pass.

## Security review

- **Email enumeration**: unchanged from Phase 3A — `portal_request_otp()`
  always returns the same outcome to the browser regardless of whether the
  submitted email matched (see docs/53). This phase adds one more
  guarantee on top: a **provider send failure for a matched/authorized
  email is swallowed silently** (logged server-side only,
  `src/actions/portal-visitor.ts`) rather than surfaced as a distinct
  error — an attacker must never be able to infer "this email IS
  authorized, but the send failed" as a signal different from "not
  authorized, nothing happened," which a naive try/catch that surfaced the
  error message would have leaked.
- **Rate limiting**: untouched — the per-link/per-link+email limits (see
  docs/53) apply before any email-provider code ever runs, so a burst of
  requests is throttled at the database layer regardless of which provider
  is configured or how it behaves.
- **Secrets**: `RESEND_API_KEY` is read only inside
  `src/lib/email/providers/resend.ts` (`import "server-only"`, so any
  accidental Client Component import fails the build), sent only in the
  `Authorization` header of the outbound Resend request, and never
  included in any thrown error message, console log, or the browser
  response — confirmed by a dedicated unit test
  (`tests/unit/email-provider-selection.test.ts`, "never echoes the actual
  api key value into the error message").
- **Provider errors are sanitized**: `sendViaResend()` never reads or logs
  the raw HTTP response body (which could echo request details back) —
  only the numeric status code reaches its thrown `Error`. That error, in
  turn, is caught in `requestPortalOtpAction()` and never reaches the
  browser at all (see "Email enumeration" above) — the visitor only ever
  sees the generic "check your email" experience or, for a failure
  unrelated to any specific email (the RPC call itself erroring), the
  brief's suggested copy: "We couldn't send the access code right now.
  Please try again in a moment."
- **HTML injection in the email itself**: `businessName` (a tenant's own
  name) and `proposalTitle` (contractor-entered) are both HTML-escaped
  before interpolation into the HTML email body — verified directly
  (`tests/unit/email-template.test.ts`, "HTML-escapes a business name /
  proposal title containing markup").
- **Token/OTP/session hashing, revoked/expired links, archived proposals,
  signed URLs, the portal session cookie**: none of this phase's changes
  touch any of it — see docs/53 for the unchanged model, reconfirmed by
  the full pre-existing RLS suite passing unmodified.

## UX changes

**Contractor** (`/proposals/[proposalId]`, "Client portal" section):
intro copy now reads "Send this link to your client. They'll enter their
email and receive a secure access code before viewing this proposal." A
new, discreet, italicized notice — "Email provider is in development
mode. Codes are captured locally for testing." — appears directly under
that copy whenever `isUsingDevEmailProvider()` (a small exported check
alongside `sendPortalCodeEmail()`) is true, computed server-side and
passed down as a plain boolean prop; never computed or shown anywhere on
the public `/p/[token]/**` routes.

**Public portal**: `/p/[token]`'s email field hint now reads "Enter the
email address where you received this proposal." (previously "Enter your
email to receive a secure access code."); `/p/[token]/verify`'s code field
hint now reads "Enter the 6-digit code we sent to your email." (previously
"Check your email for a 6-digit code."). The post-request confirmation
text ("If `{email}` is authorized, we'll send an access code.") is
unchanged from Phase 3A — it already satisfied the brief's "no revelar si
el email existe" requirement.

## Tests

No RLS/integration test changes were needed this phase — `sendPortalCodeEmail()`
and its provider dispatch are entirely TypeScript/application-layer code,
never called from SQL, so the 46 existing `tests/rls/phase3a-client-portal.test.ts`
tests (unchanged, still 46/46 passing) already fully cover everything at
the database layer this phase didn't touch: OTP expiry, wrong-code
rejection, revoked-link/archived-proposal blocking, and — specifically —
the per-link rate limit applying to unauthorized attempts (already
verified in Phase 3A, see docs/53, "A rate-limit gap found and fixed
during test-writing"). "Provider failure does not create usable session"
is true by construction, not by a new test: a session is only ever created
by `portal_verify_otp()` matching a `code_hash`, and a failed send simply
means the intended recipient never learns that code to submit it — no
code path exists where a send failure could produce a session.

22 new unit tests: `tests/unit/email-provider-selection.test.ts` (provider
resolution including the production/dev-override matrix, Resend config
validation, secret non-leakage) and `tests/unit/email-template.test.ts`
(template content completeness, HTML escaping, no internal-id leakage).

**A real bug caught by these tests before it ever ran**: the template's
first draft rendered the business name but never the proposal title in
either the text or HTML body (only the subject line had it) — a direct
gap against the brief's explicit "Debe incluir: ... Proposal title."
Caught immediately by the HTML-escaping test failing for the wrong
reason (the expected escaped title was simply absent), fixed by adding
the title to both bodies before any other code was written against the
template. See docs/54's Phase 3A.1 addendum.

E2E: all Phase 3A scenarios re-verified with the new copy (8 desktop + 1
mobile, unchanged pass count); two new assertions added to the existing
"creating a link..." and "full happy path..." tests confirming the
dev-mode notice appears on the contractor's page and never on the public
portal.

## Known limitations

- **No real Resend send was executed during this phase.** `sendViaResend()`
  is implemented and unit-tested (config validation, error sanitization,
  template rendering) against a mocked/absent-config scenario, but no
  automated test calls the real `https://api.resend.com/emails` endpoint
  — per the brief's explicit instruction ("Do not call a real email API
  during automated tests unless explicitly configured in a separate manual
  environment"). **Before enabling the Client Portal for real customers,
  someone must manually verify a real Resend send** (a real API key, a
  real `EMAIL_FROM`, and visually confirming the received email renders
  correctly in at least one real inbox) — this has not been done.
- **`sendgrid` and `smtp` remain unimplemented.** Recognized provider
  names, clear "not implemented yet" errors, no actual code.
- **No email delivery status tracking** (bounces, opens, spam
  complaints) — Resend's webhook events are not wired up. Out of scope for
  this phase; would matter for a future phase focused on delivery
  reliability at scale.
- **No retry/backoff on a transient provider failure** — a single failed
  `fetch` call is treated as a final failure for that request; the client
  can always use "Resend code" to try again, which is judged sufficient
  for this phase's scale.
