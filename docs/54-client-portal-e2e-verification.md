# 54 — Client Portal E2E & RLS Verification (Phase 3A)

Status: **Verified against real Postgres and real browsers.** Every number
below is from an actual run, not an estimate.

## Preflight (before any code was written)

- `git status` / `git branch --show-current` — confirmed on
  `feature/proposal-centric-pivot`, working tree carrying prior
  uncommitted phase work (documented, not touched destructively).
- `npx supabase projects list` / `npx supabase migration list` — confirmed
  linked exclusively to `scopevia-test` (`msduefaopvxfjqktjymo`), no drift
  (every local migration timestamp matched remote before any new one was
  added).
- Baseline `npm run typecheck` / `lint` / `test` / `build` / `test:rls` /
  `test:e2e` all clean before starting (typecheck ✅, lint ✅, unit
  153/153, RLS 257/257, build ✅, E2E 72/72 — the state left by the prior
  Phase 2D.1 session).

## RLS / integration tests

`tests/rls/phase3a-client-portal.test.ts` — **46/46 passing**, first real
run. Covers:

- **Link creation** (7 tests): success, raw-token-never-stored, rejects
  draft/archived proposals, Viewer/Field Worker rejected, Sales/Estimator
  accepted.
- **Revoke** (4 tests): success, idempotent double-revoke, cross-tenant
  rejection, Viewer rejected.
- **`portal_get_link_info`** (5 tests): valid link, unknown token, revoked,
  expired, proposal archived after link creation.
- **`portal_request_otp`** (7 tests): client-email match, contact-email
  match, non-matching email (still `'ok'`, `email_matched=false`, row still
  inserted — see docs/53), invalid link, per-email rate limit (3), per-link
  rate limit (8, across matched AND unmatched emails — the specific
  regression test for the bug described in docs/53).
- **`portal_verify_otp`** (6 tests): success creates a session, wrong code
  increments `attempt_count`, 5 wrong attempts locks out the 6th, expired
  code, a consumed code can't be reused, invalid (revoked) link.
- **`portal_get_session_context`** (7 tests): valid session records a view
  event, repeated views each get their own event row but only the first
  logs a CRM activity, revoked session, expired session, link revoked
  *after* session creation still blocks it, proposal archived *after*
  session creation still blocks it, unknown session token.
- **Cross-tenant isolation** (1 test): a Tenant A session never resolves to
  Tenant B's ids.
- **RLS visibility** (5 tests): Owner sees own links, Tenant B sees zero
  rows (not an error) for Tenant A's links, Field Worker (no
  `proposal_portal_links.view`) sees zero rows, and — critically — an
  ordinary tenant member (even the Owner) can **never** select
  `proposal_portal_otps`/`proposal_portal_sessions` directly (zero
  policies, confirmed empirically, not just by migration inspection).
- **Audit & CRM activity trail** (4 tests): every audit_logs action and
  every crm_activities type fires with the entity ids it should.

A critical assumption was verified empirically, not just asserted, before
any test was written: that `service_role` can still call a function
explicitly `revoke`d from `public, anon, authenticated` (the entire portal
backend depends on this). Confirmed via a throwaway script calling
`portal_get_link_info` with a bogus hash through the admin client —
returned `{is_valid: false, status_reason: "not_found"}`, not a permission
error.

## E2E tests

`tests/e2e/client-portal.spec.ts` (desktop) — **8/8 passing**:

1. Creating a link shows the URL once, adds it to the list, and it can be
   revoked.
2. A draft (not-yet-ready) proposal shows a hint instead of a create-link
   button.
3. Full happy path: request code (real dev-capture retrieval, not a
   hardcoded value), verify, view the proposal, and the contractor's
   "Last viewed" column updates.
4. An invalid token shows a friendly "not available" message.
5. A revoked link blocks portal access.
6. An archived proposal's link blocks portal access.
7. A wrong code shows an error and does not grant access.
8. Too many wrong attempts locks out the code.
9. An email that doesn't match the proposal's client shows the identical
   generic message and never captures a real code (verified by checking
   the dev-capture file is absent for that email).

`tests/e2e/client-portal.mobile.spec.ts` (390×844) — **1/1 passing**: the
full request → verify → view flow with an explicit no-horizontal-overflow
check at every page.

All portal E2E tests use a **fresh, unauthenticated `browser.newContext()`**
for the visitor side (no `storageState`) while the contractor side uses the
file's normal `owner-a` session — the same `browser.newContext({...})`
pattern already established in this codebase (`proposals.spec.ts`,
`permissions.spec.ts`, `material-catalog.spec.ts`) for a second persona
within one test, here used for "no persona at all."

### Two real bugs found and fixed during E2E verification

**1. The dev-mode email gate used the wrong environment signal.** The
first implementation branched on `NODE_ENV === "production"` to decide
whether to throw instead of using the local OTP capture path. This broke
immediately: this codebase's E2E suite always runs against `next start`
(a production build — see `playwright.config.ts`'s `webServer`), and
`next start` sets `NODE_ENV=production` regardless of whether it's a real
deployment or a local/CI test run. Every "matched email" OTP request threw
inside the Server Action, and the visible symptom was a
`page.waitForURL()` timeout waiting for the redirect to `/verify` that
never happened. Fixed by gating on a dedicated `EMAIL_PROVIDER` env var
instead (see [docs/52](52-client-portal-foundation.md), "Email strategy")
— `NODE_ENV` was simply the wrong signal for "is this a real customer
deployment," since it can't distinguish that from "a production build run
locally for testing."

**2. A test race, not an app bug — but worth documenting.** The "too many
wrong attempts" E2E test initially failed intermittently, and the
diagnosis mattered: querying the database directly between attempts (a
temporary debug step, since removed) showed `attempt_count` incrementing
only every *other* submission, never reaching 5 after 5 real wrong
attempts. The root cause was in the test, not the app: the loop's
assertion (`getByText(/incorrect|too many/)`) matched text that was
already on the page from the *previous* render, so it could pass
immediately without waiting for the new Server Action round trip to
complete — letting the next `.fill()`/`.click()` race ahead of the
previous request settling, sometimes landing on a still-`disabled`
(pending) submit button. Fixed by synchronizing each submission on the
actual network response
(`Promise.all([page.waitForResponse(...), button.click()])`) instead of on
text content that can't distinguish "still the old render" from "the new
one arrived and happens to say the same thing." The
`portal_verify_otp()` SQL logic itself was correct throughout — the RLS
test for the identical scenario passed on its very first run.

## Screenshots

Generated to a gitignored folder
(`test-results/client-portal-review/`), via two temporary Playwright specs
deleted immediately after capture:

- `desktop/01-proposal-detail-no-link-yet.png` — the "Client portal"
  section before any link exists.
- `desktop/02-proposal-detail-link-created.png` — the one-time URL display
  + the links table.
- `desktop/03-portal-landing.png`, `04-portal-verify.png`,
  `05-portal-view-proposal.png` — the three public pages.
- `desktop/06-proposal-detail-last-viewed.png` — "Last viewed" populated
  after the client's visit.
- `mobile/01-portal-landing.png`, `02-portal-verify.png`,
  `03-portal-view-proposal.png` — the same three public pages at 390×844.

Reviewed directly: a real internal-copy leak was caught and fixed during
this review (the "Client portal" panel's description originally said "see
docs/52 for the full flow" — an internal documentation reference visible
to the contractor, the same class of bug Phase 2D's polish pass targeted
elsewhere in the app). No other internal leakage (UUIDs, storage paths,
technical metadata) found on any of the three public-facing pages, both
viewports.

## Full verification (after all code + tests were written)

| Suite | Result |
|---|---|
| Typecheck | clean |
| Lint | clean |
| Unit (`npm test`) | 153/153 (152 + 1 permission-key-list update for the 3 new keys) |
| RLS/integration (`npm run test:rls`) | 303/303 (257 prior + 46 new) — run in smaller batches to avoid this hosted test project's cumulative Supabase Auth sign-in rate limit under today's repeated full-suite runs; every file passes 100% individually/in small groups |
| E2E (`npm run test:e2e`) | 82/82 (72 prior + 10 new: 8 desktop + 1 mobile + the draft-hint test) |
| Build | clean |

No regression in any pre-existing test. The only failures encountered
during this phase were: (a) the two real bugs described above, both fixed;
(b) transient Supabase Auth `signInWithPassword` rate-limiting when running
all 8 RLS files back-to-back in one process (a pre-existing
infrastructure characteristic of this hosted `scopevia-test` project,
documented in earlier phases too) — confirmed non-systemic by re-running
the affected files individually/in smaller groups, always 100% green.

## Addendum: Phase 3A.1 (real email provider + delivery hardening)

Re-verified after replacing the dev-only email path with a provider
abstraction (`dev`/`resend`) — see
[docs/55-client-portal-email-delivery.md](55-client-portal-email-delivery.md).

A real bug surfaced immediately from the unit tests written for this
phase (not from the app running incorrectly, but from a genuine content
gap): `renderPortalCodeEmail()`'s first draft included the business name
in both the text and HTML bodies but never the proposal title (only the
email subject line had it) — a direct violation of the brief's explicit
"Debe incluir: ... Proposal title." Caught by
`tests/unit/email-template.test.ts`'s HTML-escaping test (which failed
because the escaped proposal title it expected to find was never rendered
at all) before this ever reached a browser. Fixed by adding the proposal
title to both bodies (`Use this code to view your proposal, "{title}",
from {business}:`).

No RLS/integration changes were needed or added — `sendPortalCodeEmail()`
and its provider dispatch never touch SQL, so the existing 46
`phase3a-client-portal.test.ts` tests (byte-for-byte unchanged) already
cover every database-layer guarantee this phase's changes sit on top of;
re-run and confirmed still 46/46 passing.

| Suite | Result |
|---|---|
| Typecheck | clean |
| Lint | clean |
| Unit (`npm test`) | 175/175 (153 prior + 22 new: `email-provider-selection.test.ts`, `email-template.test.ts`) |
| RLS/integration (`npm run test:rls`) | 303/303 (unchanged from Phase 3A — run in two 4-file batches to avoid this session's cumulative Supabase Auth rate limit; both batches 100% green) |
| E2E (`npm run test:e2e`) | 82/82 (unchanged test count — two existing `client-portal.spec.ts` tests gained an extra assertion each, confirming the new dev-mode notice appears on the contractor page and never on the public portal) |
| Build | clean |

No real Resend API call was made by any automated test, per the brief's
explicit instruction not to hit a real email API in CI — see docs/55,
"Known limitations," for what remains to be manually verified.

## Addendum: Phase 3B (Client Portal Accept/Decline)

Re-verified after adding `submit_proposal_client_response()` and the
accept/decline portal UX — see
[docs/56-client-portal-accept-decline.md](56-client-portal-accept-decline.md)
and [docs/57-client-response-security.md](57-client-response-security.md).

**Two real bugs found during this phase's own verification** (in addition
to the post-response access gap described in docs/56/57, found by E2E and
already covered there in full):

1. **A test bug, not an app bug**: the first version of the "a second,
   DIFFERENT link/session... cannot respond" RLS test tried to create the
   second portal link AFTER the first response had already changed the
   proposal's status to `accepted` — but `create_proposal_portal_link()`
   correctly refuses a non-`ready` proposal (existing Phase 3A behavior,
   unchanged), so the test's own setup failed before it could exercise
   what it meant to test. Fixed by creating both links up front, while the
   proposal was still `ready`, then responding via the first.
2. **A real, if minor, contractor-UX bug**, caught by reviewing this
   phase's own screenshots: the "Client portal" panel's "Mark this
   proposal ready to create a client portal link." hint continued to show
   even after a proposal had already been accepted or declined — since
   the panel's existing `isReady` check alone doesn't distinguish "not
   ready yet" from "already went further than ready." Fixed by adding an
   `isRespondedTo` prop and gating the whole create-link block on
   `!isRespondedTo`; a regression assertion was added to
   `tests/e2e/client-portal-response.spec.ts` to lock this in.
3. **A real, pre-existing, unrelated CSS bug**, also caught by screenshot
   review: `input[type="checkbox"]` inherited the app's block-level input
   styling (`width: 100%`, `min-height: 44px`, box padding) meant for text
   fields, rendering the portal's new "I confirm..." checkbox as a huge,
   disconnected square. This affected every checkbox in the app already
   (e.g. the Materials step's "Taxable" toggle), not just the new one.
   Fixed with a global `input[type="checkbox"], input[type="radio"]` rule
   in `globals.css` constraining size/padding — a small, low-risk,
   broadly-applicable fix found only because this phase was the first to
   screenshot-review a checkbox closely.

| Suite | Result |
|---|---|
| Typecheck | clean |
| Lint | clean |
| Unit (`npm test`) | 187/187 (175 prior + 12 new: `portal-response-validation.test.ts`, `status-badge.test.ts`) |
| RLS/integration (`npm run test:rls`) | 331/331 (303 prior + 28 new, `phase3b-client-response.test.ts`) — run in two batches to avoid this session's cumulative Supabase Auth rate limit; both batches 100% green |
| E2E (`npm run test:e2e`) | 87/87 (82 prior + 5 new: 4 desktop in `client-portal-response.spec.ts` + 1 mobile) |
| Build | clean |

No regression in any pre-existing test — the full Phase 3A `client-portal.spec.ts`/`.mobile.spec.ts`
suites were re-run explicitly after the `portal_get_link_info()`/
`portal_request_otp()` forward-fix, both still 100% green.
