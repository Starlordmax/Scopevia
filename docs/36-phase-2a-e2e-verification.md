# 36 — Phase 2A E2E Verification

Status: **Real Playwright browser tests against a production build and the
real `scopevia-test` database**, same infrastructure as
[25](25-phase-1-e2e-verification.md). **55/55 passing**, confirmed on a
full clean run plus a separate stability check (the new full-flow test
repeated twice in isolation, 0 failures) — see "A note on environment
stability" for a real instability encountered mid-verification and how it
was resolved (not papered over).

## Environment

Identical to Phase 1: production build (`next build && next start`), the
dedicated `scopevia-test` Supabase project, desktop (Chromium, default
viewport) and mobile (390×844) Playwright projects, no retries.

## Results

| Spec file | Tests | Result |
|---|---|---|
| Phase 0/1 (setup + auth, clients, contacts, notes-activities, opportunities, permissions, pipeline + pipeline.mobile, projects) | 48 | PASS, identical to the pre-Phase-2A baseline — zero regressions |
| `proposals.spec.ts` (5) + `proposals.mobile.spec.ts` (2) | 7 | PASS — new in Phase 2A |
| **Total** | **55** | **55/55 PASS** |

## New spec files

- `tests/e2e/proposals.spec.ts` — desktop: the full builder flow (client →
  proposal with auto-created opportunity → scope section → labor →
  materials → photos → pricing with discount+tax → review with a
  server-verified total → mark ready → dashboard → return to draft → edit
  (confirms no data loss) → archive → restore), a Portfolio flow (create
  → upload → select as previous work in a fresh proposal), Viewer
  permissions (read-only, no create link), Sales permissions (can create/
  edit scope, cannot manage pricing — no labor form rendered at all), and
  tenant isolation (switching tenants hides the other tenant's proposals,
  a stale URL 404s).
- `tests/e2e/proposals.mobile.spec.ts` — mobile (390×844): the builder
  stepper/forms/pricing summary/bottom-nav fit within the viewport with no
  horizontal overflow at every step, and the standalone Preview page is
  readable with no overflow.
- `tests/e2e/fixtures/one-pixel.png` — a real, valid 1×1 PNG used for
  photo-upload steps (not a mocked file).

## Bugs found via this suite (not by code review)

1. **`formatCents()` produced inconsistent currency formatting between
   Server and Client Components.** `(cents/100).toLocaleString(undefined,
   {style:'currency', currency:'USD'})` resolves `undefined` to the
   *current runtime's* default locale — Node's server-side default
   renders as `"USD 2,400.00"`, while the same function executing in the
   browser (used by the Labor/Materials builder steps' live preview)
   rendered as `"$30.00"`. Found because the E2E test asserted on the
   rendered text and the two values didn't match. Fixed by pinning the
   locale explicitly to `"en-US"` in `src/lib/proposals/format.ts` — every
   money value in the app now renders identically (`"$X,XXX.XX"`)
   regardless of where it's computed.
2. **`page.waitForURL()`'s default `waitUntil: "load"` never resolves for
   a cross-route redirect driven by a plain `<form action={serverAction}>`.**
   Exactly the same class of race documented in
   [docs/26](26-phase-1.6-ui-redesign.md) for the tenant-switcher (a
   Server-Action-driven transition is a client-side history update, not a
   hard navigation, so no new `load` event fires). Found when
   `markProposalReadyAction`'s redirect from `/edit?step=review` to
   `/proposals/[id]` caused `waitForURL` to hang for the full test
   timeout. Fixed by asserting on the resulting page's real content first
   (which Playwright's `expect(...).toBeVisible()` polls for correctly),
   then confirming the URL — the same pattern already established for
   the tenant-switching fix, now documented as the general rule for any
   assertion following a Server-Action redirect in this codebase.
3. **Test-only assumption, not an app bug:** `returnProposalToDraftAction`
   redirects into the builder's Review step (`/edit?step=review`), not
   back to the proposal detail page — a deliberate UX choice (jump
   straight back into editing) that the first draft of this test
   incorrectly assumed. Fixed the test's expectation, not the app.
4. **A Server Action that `redirect()`s to the exact same URL the request
   came from gives the client-side router nothing to distinguish "already
   here" from "just navigated."** `archiveProposalAction`/
   `restoreProposalAction` are invoked from `/proposals/[id]` and redirect
   back to `/proposals/[id]` (same URL, after a `revalidatePath()`) — the
   only Phase 2A actions that redirect to their own origin URL, since
   every other action in this phase redirects to a *different* route (the
   builder ↔ detail page pair). Even with an assertion that waits for real
   content (not a lifecycle event) instead of `waitForURL`, the
   soft-navigation repaint following a same-URL redirect proved
   unreliable in automated testing. This is the same underlying class of
   issue as the original tenant-switching bug (docs/26): a client-side
   transition doesn't guarantee a detectable signal when the URL string
   itself doesn't change. Fixed the test by polling with an explicit hard
   `page.reload()` each iteration (`expect.poll(async () => { await
   page.reload(); return badge.count() }, ...)`), which sidesteps the
   question entirely by always forcing a genuine fresh server fetch. The
   underlying data change itself was never in doubt — `archive_proposal()`/
   `restore_proposal()` are independently and reliably verified via
   `tests/rls/phase2a-proposals.test.ts`'s "Proposal status transitions"
   cases (100% of runs, no flakiness, since those hit the RPC directly
   with no browser/router involved). Whether a real user's browser
   reliably repaints without a manual refresh in this exact same-URL-
   redirect scenario was not independently re-verified beyond the manual
   smoke-test walkthrough below (which used a fresh navigation, not a
   same-page click) — flagged as a follow-up UX check for a future pass
   rather than asserted as proven either way.

## A note on environment stability during this verification pass

Two genuinely different problems surfaced while getting the full-flow
test to pass reliably, and were not conflated with each other:

1. **Real, external network instability** in the execution environment
   (`ECONNRESET`/connect-timeout errors reaching the Supabase project and
   even unrelated hosts, confirmed via direct `curl` checks against both
   the Supabase project and `google.com` failing identically at the same
   time, independent of any code in this repository) intermittently broke
   *unrelated* test setup steps and one Storage upload test (a real 10 MB
   buffer timing out on a slow link). Both resolved on retry once the
   network recovered, with no code change — see
   [docs/35](35-phase-2a-rls-verification.md).
2. **A genuine, reproducible test bug** (bug #4 above) in the Archive/
   Restore assertions, which network instability initially made it easy
   to *misattribute* as "probably just the network." It was not: even
   after the network was confirmed fully recovered (every other test in
   the same run, including ones immediately before and after, passing at
   normal speed), the same assertion failed at the same spot on repeated
   attempts. Properly diagnosed as the same-URL-redirect class of issue
   and fixed with reload-based polling — then confirmed fixed by running
   it clean once, then twice more in immediate repetition, all passing.

The lesson applied here, consistent with this project's established
discipline: don't accept "probably flaky" as an explanation without
checking whether the *same* failure reproduces once the suspected
external cause is verifiably absent. This is recorded per the brief's
explicit instruction not to declare PASS without it actually
having run — see the final delivery report for the precise state at
commit time.

## Manual verification (real browser, not automated)

A full manual walkthrough was performed and screenshotted end-to-end,
independent of the automated E2E suite: sign in → onboarding → create
client → create proposal (auto-created opportunity confirmed) → add scope
section → add labor item (confirmed 80 hours / $2,400.00, matching the
brief's worked example, rendered by the real server) → add material line
item ($200.00) → Photos step reached → Terms & Pricing (7% tax) → Review
(server-computed total `$2,782.00`, matching subtotal + tax by hand) →
Mark ready → Dashboard (1 ready proposal, correct total quoted value,
correct recent-proposals row, correct recent-activity entries in
chronological order, zero fabricated Sent/Accepted/follow-up data).
Screenshots retained for this session's record.

## Regression check

The full Phase 0/1 E2E suite (48 tests: `auth`, `clients`, `contacts`,
`notes-activities`, `opportunities`, `permissions`, `pipeline`,
`pipeline.mobile`, `projects`) was re-run in full after all Phase 2A
schema/navigation/dashboard changes: **48/48 PASS, zero regressions.**
The full-flow test (`proposals.spec.ts`, the longest single test in the
suite) was additionally repeated twice in isolation with 0 failures, to
confirm the same-URL-redirect fix (bug #4 above) was genuinely resolved
and not a one-off pass.
