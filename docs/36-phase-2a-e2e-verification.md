# 36 — Phase 2A E2E Verification

Status: **Real Playwright browser tests against a production build and the
real `scopevia-test` database**, same infrastructure as
[25](25-phase-1-e2e-verification.md). **55/55 passing**, confirmed on a
full clean run plus a separate stability check (the new full-flow test
repeated twice in isolation, 0 failures) — see "A note on environment
stability" for a real instability encountered mid-verification and how it
was resolved (not papered over).

A second, independent full-suite run was performed at final delivery time
(post-commit, as a pre-report sanity check) and is recorded in full in "A
second environment-stability episode at final delivery" below: it hit a
severe network outage (7 failures, all infra-attributable) that was
diagnosed and confirmed external before being retried; the retry passed
**55/55 clean** in 5.2 minutes with zero network-error noise, reconfirming
this document's numbers were not stale.

> **Nota de estado (2026-07-07):** Phase 2A.1 (the `update_proposal_scope`
> fix + navigation simplification, see [docs/37](37-proposal-scope-rpc-fix.md)/
> [docs/38](38-navigation-simplification.md)) re-verified this entire
> suite plus 2 new Job Summary tests and updated versions of
> `pipeline`/`pipeline.mobile`/`projects`/`notes-activities`/`permissions`
> — **58/58 PASS**. See "Phase 2A.1 E2E re-verification" below for the
> full account, including a genuine environment issue (browser/server
> memory contention in this specific sandbox, unrelated to the code) and
> two real bugs this pass found and fixed.

> **Nota de estado (2026-07-08):** Phase 2A.2 (fixed labor pricing +
> Pricing Summary investigation + photo upload/gallery UI, see
> [docs/39](39-fixed-labor-pricing.md)/[docs/40](40-proposal-total-refresh-fix.md)/
> [docs/41](41-photo-gallery-ui-fix.md)) added 5 new E2E cases (2 desktop
> "Labor pricing method" tests, extended Portfolio-photo and mobile
> assertions) and re-ran the full suite — see "Phase 2A.2 E2E
> re-verification" below for final numbers.

> **Nota de estado (2026-07-08, ronda 2):** Phase 2A.3 found the actual
> root cause of the "$0.00" report (a UX ambiguity, not a data defect —
> see [docs/40](40-proposal-total-refresh-fix.md#round-2-definitive-db-proof-and-the-actual-ux-fix))
> and fixed it. **61/61 PASS.** See "Phase 2A.3 E2E re-verification"
> below.

> **Nota de estado (2026-07-09, Phase 2B):** Adds two new spec files —
> `tests/e2e/material-catalog.spec.ts` (desktop, 2 tests: the brief's
> full worked ZIP-catalog scenario including delete/restore, and a
> Sales-persona no-price-available case) and
> `tests/e2e/material-catalog.mobile.spec.ts` (mobile, 1 test) — plus
> updates to the existing "full builder flow" test's archive/restore
> section (now "Delete proposal"/"Restore proposal" inside a collapsed
> "Danger zone," with a real `window.confirm()` dialog handler and an
> Active/Archived-list visibility check). **Full suite: 64/64 PASS**
> (5 setup + desktop + mobile projects combined, confirmed by a full
> clean `npx playwright test` run — see
> [docs/44](44-material-catalog-rls-verification.md)).
>
> Fixing these specs surfaced two real bugs, both fixed before this
> phase shipped: (1) the catalog category `<select>`'s "All categories"
> option submits `catalogCategory=` (empty string), which `?? null`
> does not normalize to null — the SQL side then filtered
> `category = ''` (never true), silently returning zero results for
> every unfiltered-category search; fixed by normalizing empty string
> to null in `searchMaterialCatalog()` for all three filters. (2) the
> per-row catalog Add form's quantity input was given an inline
> `flexWrap: "nowrap"` style, which forced horizontal overflow on the
> mobile viewport; removed, relying on `.tenant-form`'s existing
> `flex-wrap: wrap`. Neither bug was reachable by any pre-existing test
> — both were found by writing and running the new E2E coverage this
> phase's brief required, not by code review.

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

## A second environment-stability episode at final delivery

After the commit covering all Phase 2A work, one more full 55-test run
was performed as a final pre-report sanity check. It hit a severe,
genuine network outage: 7 tests failed (6 Phase 0/1 tests spanning
`opportunities`, `permissions`, plus 1 new `proposals.spec.ts` Sales-
permissions test), every one with an infrastructure-level error signature
— `net::ERR_NETWORK_IO_SUSPENDED`, `getaddrinfo ENOTFOUND
msduefaopvxfjqktjymo.supabase.co`, `ECONNRESET`, and `Invalid Refresh
Token: Already Used` (a symptom of the auth client silently retrying
across the outage). The run's total wall-clock time was **12.8 hours**
for a suite that normally completes in under 10 minutes — evidence the
machine's network was suspended for an extended stretch (most likely an
overnight sleep/suspend), not a brief blip. None of the 7 failures shared
any signature with an application-logic problem, and the one Phase 2A
test among them (`proposals.spec.ts` Sales permissions) failed at the
exact same `page.goto`/`fill` infrastructure layer as the five Phase 0/1
failures, not inside any proposal-specific assertion.

This was verified, not assumed: a direct `curl` connectivity check
immediately afterward showed both the Supabase project and an unrelated
control host (`google.com`) fully unreachable, confirming the outage was
external and not code-related. (A follow-up curl check briefly appeared
to still show failure via `CRYPT_E_NO_REVOCATION_CHECK` — a Windows
Schannel certificate-revocation-check quirk specific to `curl.exe` on
this machine, unrelated to Node/Playwright's own TLS stack; retrying with
`--ssl-no-revoke` confirmed the network had in fact already recovered.
This is noted so the false-negative isn't mistaken for a second real
outage.)

Once connectivity was independently confirmed healthy (`curl` to both
Supabase and the control host returning normal HTTP responses), the full
55-test suite was re-run from a cold build: **55/55 PASS, 5.2 minutes,
zero network-error log noise** — a clean result, not merely a retry that
happened to pass. `typecheck`, `lint`, the 87-test unit suite, and the
143-test RLS+Storage suite were also re-run at this point and all passed
clean, reconfirming every number in this report and in
[docs/35](35-phase-2a-rls-verification.md) was current at final delivery
time, not stale from an earlier pass.

## Phase 2A.1 E2E re-verification

Phase 2A.1 (docs/37, docs/38) touched navigation, four detail/list pages,
and the Job Summary form, so the full suite was re-run rather than just
the new tests. **Final result: 58/58 PASS.**

### A genuine environment issue: browser/server memory contention, not a code bug

The first full-suite run (default `workers: 2`) failed dramatically: 7
tests passed, then every subsequent test across completely unrelated spec
files (`clients`, `contacts`, `notes-activities`, `opportunities`,
`permissions`, `pipeline`) failed with a blank white page and a
`toBeVisible` timeout. This was investigated, not assumed to be another
network blip:

1. A blank-page screenshot ruled out a normal application error (which
   renders Next.js's own error page, not a blank one).
2. `curl` confirmed both the app server and Supabase were healthy and
   fast — ruling out the network-outage class of problem from the
   previous verification pass.
3. A one-off diagnostic spec, run directly, showed the *auth setup*
   tests themselves — a plain sign-in against a static page, unrelated
   to any change in this fix — timing out for 2 of 5 parallel workers
   while the other 3 completed in 2-4 seconds each.
4. `tasklist` showed 6 stray `node.exe` processes left over from an
   earlier interrupted run; killing them and re-running still showed the
   same pattern.
5. Direct measurement (`Get-CimInstance Win32_OperatingSystem`) showed
   only **2.02 GB of 15.31 GB RAM free** on this machine at the time —
   severe memory pressure. Re-running the Playwright auth setup alone
   with `--workers=1` passed all 5 cases reliably in under 3 seconds
   each; `--workers=2` (running two Chromium instances plus the Next.js
   server concurrently) was intermittently exceeding what this specific
   sandbox's available memory could sustain without swapping.

This is an environment condition local to this session's sandbox, not a
regression introduced by this fix or a defect in the test suite's design
(the checked-in `playwright.config.ts` `workers: 2` is unchanged — this
was worked around via a one-off `--workers=1` CLI flag for this
verification run, not a permanent config edit). It is recorded here in
the interest of not silently discarding a large batch of red test results
without explaining why they don't count.

### Two real bugs found and fixed by this pass

With `--workers=1` isolating genuine failures from environment noise, two
real, code-level bugs surfaced (not network, not memory):

1. **`tests/e2e/notes-activities.spec.ts`** — "a note on the project does
   not appear on the client" still called `/projects/new`, which (as of
   this fix) unconditionally redirects to `/proposals` — the form it
   expected never renders. This test was missed by the initial
   Pipeline/Projects survey because that survey was scoped to the files
   explicitly named in the brief and to a grep for `/pipeline`/`/projects`
   *links and headings*, not to every test file that happened to use
   `/projects/new` as a means to an unrelated end (testing note
   scoping, not testing Projects itself). Fixed by replacing the
   project-vs-client scoping pairing with a client-vs-client pairing
   (still real, still meaningful resource-scoping coverage, using only
   UI that still exists) — see docs/38's "Tests updated" for the full
   reasoning.
2. **`tests/e2e/permissions.spec.ts`** — "can view clients/opportunities/proposals"
   failed with a Playwright strict-mode violation:
   `getByRole("heading", { name: "Proposals" })` matched *two* elements
   (the page's `<h1>Proposals</h1>` and an empty-state `<h3>No proposals
   yet</h3>`, both containing "Proposals" as a substring). This was a bug
   in this fix's own test edit, not a pre-existing one — introduced when
   adapting the test from Projects to Proposals — fixed with
   `{ name: "Proposals", exact: true }`.

Both were verified fixed by re-running the affected files in isolation
(17/17 passed), then confirmed by a full clean single-worker run
(58/58 passed, 9.2 minutes).

### Updated/new spec files in this pass

- `tests/e2e/pipeline.spec.ts` / `pipeline.mobile.spec.ts` — rewritten
  from kanban-UI tests to redirect + absence tests (3 + 2 cases).
- `tests/e2e/projects.spec.ts` — rewritten from Projects-CRUD-UI tests to
  redirect + absence + Client/Opportunity-detail-no-longer-shows-Projects
  tests (7 cases).
- `tests/e2e/permissions.spec.ts` — Viewer/Sales/Field-Worker cases
  adapted per docs/38 (net: -1 case, the Sales/Projects test removed as
  superseded by existing Proposals coverage).
- `tests/e2e/notes-activities.spec.ts` — one case adapted (see bug #1
  above); test count unchanged.
- `tests/e2e/proposals.spec.ts` — 2 new cases for
  `update_proposal_scope` (see docs/37).

Net change from the Phase 2A baseline (55): -1 (old projects.spec.ts had
6 cases, new has 7, net +1) +2 (pipeline.spec.ts) +1 (pipeline.mobile) -1
(permissions.spec.ts) +2 (Job Summary) = **58**.

## Phase 2A.2 E2E re-verification

Added fixed labor pricing (docs/39), investigated the reported "$0.00
Pricing Summary" bug (docs/40, not reproduced), and reworked photo
upload/gallery UI (docs/41). **Final result: 60/60 PASS**, 8.6 minutes,
single-worker (this sandbox's available memory still cannot reliably
sustain 2 concurrent Chromium instances — see docs/36's "Phase 2A.1"
section above; unrelated to this pass's changes).

### A real bug — in this pass's own new test, not the product

The first run of the extended `proposals.mobile.spec.ts` test failed
with a Playwright strict-mode violation: `locator(".photo-thumb")`
resolved to 3 elements instead of 1. Root cause: `.photo-thumb` is
used in three places on the Proposal Builder's Photos step —
current-job photos, previous-work photos, and (new in this pass) the
"Select from Portfolio" picker — and Portfolio projects/media are
genuinely tenant-wide, persisting across every test that shares Tenant A
within the same suite run. An earlier-run test's Portfolio photos were
present (inside the picker's collapsed `<details>`) at the same time the
new mobile test uploaded its own current-job photo, so an unscoped
`page.locator(".photo-thumb")` was ambiguous — not a bug in the app
(the picker correctly showed real, distinct portfolio photos; the
current-job section correctly showed its own upload), but a real gap in
the new test's locator scoping. Fixed by scoping the locator to the
"Current job photos" section's own container (`page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Current job photos" }) })`)
rather than the whole page. Confirmed fixed by re-running the file in
isolation (7/7 passed) before the final full-suite confirmation.

### New/extended spec files in this pass

- `tests/e2e/proposals.spec.ts` — new "Labor pricing method" describe
  block (2 cases: fixed-price + materials combined total, persisted on
  reload; the hourly worked example); the existing "Portfolio" test
  extended with green-button, thumbnail-count, and thumbnail-size
  assertions (no new test count, same test).
- `tests/e2e/proposals.mobile.spec.ts` — the existing "stepper, forms,
  and pricing summary" test extended with photo-upload-button and
  thumbnail-sizing assertions on a 390px viewport, plus an explicit
  check that the Pricing Summary never shows a stale `$0.00` after
  adding hourly labor (no new test count, same test).

Net change from the Phase 2A.1 baseline (58): +2 ("Labor pricing method"
— fixed-price and hourly worked-example cases), taking 58 → **60**. The
Portfolio and mobile test extensions added assertions to existing tests
rather than new test cases.

## Phase 2A.3 E2E re-verification

Found and fixed the actual root cause of the reported "$0.00" issue (a
UX ambiguity, not a data defect — see
[docs/40](40-proposal-total-refresh-fix.md#round-2-definitive-db-proof-and-the-actual-ux-fix))
and restructured the Labor/Materials steps' preview-vs-saved UI. Added 1
new E2E case ("the exact reported scenario") that fills the hourly form,
asserts the unsaved preview ($280.00) and the still-correctly-$0.00
saved total are both visible and distinguishable *before* saving, saves
it, repeats for a $50 material, asserts the combined $330.00 total, and
confirms it survives a hard reload. Updated existing assertions for the
renamed button text (`+ Add item` → `+ Add cost item`) and hint text
(`Labor total:` → `Saved labor total:`).

**Final result: 61/61 PASS**, 9.7 minutes, single-worker (unchanged
environment constraint, unrelated to this pass). Net change from the
Phase 2A.2 baseline (60): +1, taking 60 → **61**.
