# 25 — Phase 1 E2E Verification

Status: **Closes the two blockers identified in
[docs/24-phase-1-manual-testing.md](24-phase-1-manual-testing.md)** — a real
browser walkthrough of the Phase 1 UI, and automated coverage for the five
restore operations. Both are now real, executed, and green — not inferred
from code review. Verification date: 2026-07-02.

## Environment

| | |
|---|---|
| Browser | Chromium 149.0.7827.55 (Playwright-managed, headless) |
| Test runner | `@playwright/test` ^1.61.1 |
| Viewports | Desktop Chrome default (~1280×720); Mobile 390×844 (per the brief — close to an iPhone 12/13/14) |
| App server | A **production build** (`next build && next start`), not `next dev` — see "Why not `next dev`" below |
| Database | The same dedicated `scopevia-test` Supabase project (ref `msduefaopvxfjqktjymo`) used throughout Phase 0/1 — never production |
| Logical users | Owner A (also a Tenant B viewer), Sales A, Viewer A, Field Worker A, Owner B — all created fresh per run with an `e2e-<timestamp>-<random>-` email prefix |

### Why not `next dev`

The first attempts at this suite ran against `next dev` and produced
repeated, non-deterministic `page.goto` timeouts — not from any application
bug, but from Next's on-demand route compilation serializing badly under
concurrent browser-driven requests. Switching the suite's `webServer`
command to a production build (`next build && next start`) eliminated that
entire class of failure outright, since a prebuilt server has no
compile-time contention at all. This is a test-infrastructure decision, not
a claim that the app behaves differently in dev vs. prod — Phase 0/1's own
`npm run dev` continues to be the normal local development workflow.

## Test data isolation

- Two tenants (`E2E Tenant A <run>`, `E2E Tenant B <run>`) and 5 users are
  created fresh per run via `tests/e2e/global-setup.ts`, using the app's own
  RPCs (`create_tenant_with_owner`, `invite_member_by_email`,
  `accept_invitation`) signed in with the **anon key** — never a direct
  table write.
- The **service role key** is used in exactly one place
  (`tests/e2e/fixtures/provision.ts`, `adminClient()`) to create/delete the
  throwaway auth users — it never enters a browser page, is never logged,
  and is never used to perform any of the actions under test (those always
  run through the UI with the real signed-in persona's own session).
- `tests/e2e/global-teardown.ts` deletes **only** the users/tenants recorded
  in the current run's manifest (`playwright/.auth/manifest.json`, itself
  gitignored) — never a prefix-based bulk delete against the live table, so
  a run can never touch data it didn't create even if two runs overlap.
- Owner A deliberately belongs to **two** tenants (owner of A, viewer of B)
  so the tenant-switching spec has a real user who genuinely spans tenants,
  rather than simulating it.
- `playwright/.auth/`, `playwright-report/`, and `test-results/` are all
  gitignored and excluded from ESLint; scanned for JWT-shaped strings and
  the literal E2E password before every commit — none found (see Security
  Verification, section 9 of the final report).

## E2E scenarios

See the final report (section 3) for the full scenario-by-scenario table.
In summary: **48 Playwright tests across 9 spec files, covering
authentication, Clients, Contacts, Opportunities, Pipeline (desktop +
mobile), Projects (including conversion idempotency and address primary
switching), Notes/Activities, and Permissions (Viewer/Sales/Field
Worker/tenant switching) — stable at 48/48 across three consecutive full
runs.**

Not automated: full sign-up/email-confirmation/password-recovery flows
(depend on a real inbox — out of scope for this pass, same as Phase 0/0.5)
and the never-built opportunity-edit UI (an existing, pre-Phase-1.5 gap —
`updateOpportunityAction` exists but no page renders `OpportunityForm` in
edit mode for opportunities; not something this pass was asked to add).

## Restore coverage

`tests/rls/phase1-restore.test.ts` — 27 new cases (25 per-function + 2
concurrency), run against real Postgres, stable across two consecutive
runs. Covers, for **each** of `restore_client`, `restore_client_contact`,
`restore_opportunity`, `restore_project`, `restore_project_address`:
successful restore with correct permission; safe no-op on an already-active
resource; Viewer rejected; cross-tenant rejected; a suspended user's
already-issued session immediately rejected; `archived_at`/`archived_by`
cleared to `null`; an `audit_logs` row written; a `crm_activities` row
written **only** where the underlying function actually calls
`log_crm_activity()` for that action (verified against migration source,
not assumed uniform — clients and projects do; contacts, opportunities, and
project addresses' archive/restore pair do not). Plus two concurrency
cases: two simultaneous restores of the same client never error and
converge to one consistent state; an archive and a restore racing on the
same opportunity never leave a corrupted mix of `status`/
`pre_archive_status`/`archived_at` — exactly one self-consistent state
survives.

## Bugs found and fixed (real, demonstrated by tests — not review-only)

| # | Bug | Severity | How found | Fix |
|---|---|---|---|---|
| 1 | **App-crashing**: the tenant-switcher `<select onChange={...}>` was rendered directly inside `(protected)/layout.tsx`, a Server Component — React forbids passing an event handler to a plain host element from a Server Component. Any signed-in user belonging to 2+ tenants got a 500 on **every** protected page. Pre-existing since Phase 0; invisible to Phase 0/1's RLS-level tests because none of them render a real page for a multi-tenant user through a browser. | Critical | Reproduced directly with a throwaway dual-tenant user via a real Playwright browser session; confirmed via the raw React error in server logs | Extracted the switcher into `src/app/(protected)/tenant-switcher.tsx`, a small Client Component (`"use client"`), preserving identical markup/behavior |
| 2 | **Cross-tenant data exposure**: `/clients/[id]`, `/clients/[id]/edit`, `/opportunities/[id]`, `/projects/[id]`, `/projects/[id]/edit` fetched their row by `id` alone, with no `tenant_id` filter — relying entirely on RLS. RLS checks the row's *own* tenant, not the caller's *active* tenant, so a user belonging to two tenants with overlapping permissions (e.g. Owner A) could load a Tenant A record's detail page while "in" Tenant B, via a stale URL. | High | Reasoned from the query shape while implementing the tenant-switching spec, then written as a deliberate test before fixing | Added `.eq("tenant_id", tenant.tenant_id)` to all 5 queries; a stale cross-tenant URL now correctly renders Next's `notFound()` (chosen over a 403 to avoid confirming the record's existence, consistent with Phase 0's `accept_invitation` pattern) |
| 3 | **Information leakage**: RPC error messages were passed straight through to the UI unsanitized in `clients.ts`/`opportunities.ts`/`projects.ts`/`notes.ts` — e.g. `"Missing permission: opportunities.archive"` (exposes internal permission-key naming) and `"Invalid transition: new -> won (... uses archive_opportunity()/restore_opportunity() instead)"` (exposes internal function names). | Medium | Demonstrated by the opportunity/project "tampered request" E2E tests | Added `src/lib/errors/friendly-message.ts`, a narrow sanitizer applied at every RPC-error-to-banner call site in the four Phase 1 action files (Phase 0's action files were left untouched — out of this pass's scope) |
| 4 | Accessibility: the tenant-switcher `<select>` had no `label`/`aria-label` at all. | Low | Manual accessibility check while building the E2E suite (section 15 of the brief) | Added `aria-label="Switch business"` |

No RLS, permission-matrix, or state-machine defect was found — every
security/business-logic case the E2E suite exercised (tampered transitions,
manipulated tenant IDs, direct URL access, permission boundaries) was
already correctly enforced server-side; the bugs above are all
UI-layer/wiring issues that only a real rendered page could catch.

## Corrections made to the test suite itself

Several early E2E test failures were investigated and confirmed to be test
bugs, not application bugs, before being fixed (same "verify before
reclassifying" discipline as Phase 0.5):

- `getByLabel("Phone")` / `getByText("Primary")` / `getByText("Edit")`
  matched more than one element by case-insensitive substring (`"Phone"`
  also matches `"Secondary phone"`; `"Primary"` also matches the **"Make
  primary"** button; `"Edit"` also matches the word **"edited"**) — fixed
  with `{ exact: true }` or a more specific role/tag scope.
- `.locator(".card")` matched both a note's own card and its ancestor
  wrapper card (also styled `.card`) — fixed by scoping to `<li>`, which
  only individual notes use.
- The primary-contact/address create forms are uncontrolled and stay
  mounted (with stale field values, including a previously-checked "make
  primary" checkbox) after a successful submit, rather than resetting —
  tests were adjusted to reuse the already-open form and explicitly clear
  fields, instead of assuming a toggle button reappears.
- A native `<details>` disclosure never auto-closes after a nested form
  submits — a second "click Edit to reopen" was actually toggling it
  *closed*; fixed by checking current state first.
- `waitForURL("/")` immediately after already being at `"/"` resolves
  instantly without waiting for the tenant-switch's server round trip —
  replaced with waiting for proof the switch happened (the heading showing
  the new tenant's name).
- The tenant-switching spec's initial "client appears in the list" check
  assumed page 1 of an unfiltered list — but this suite shares one Tenant A
  across every spec file, which by full-suite run time holds far more than
  one page's worth of clients (20/page, sorted alphabetically, not by
  creation time). Fixed by searching for the specific client instead of
  browsing the plain list.

## Known limitations

- Fresh sign-up, email confirmation, and password recovery are not
  automated (require a real inbox) — same as Phase 0/0.5.
- No opportunity-edit UI exists to test (a pre-existing gap, not introduced
  or fixed here — `updateOpportunityAction` has no reachable page).
- The E2E suite occasionally shows unrelated transient network errors
  against the remote Supabase project (`ECONNRESET`, connect timeouts) —
  mitigated with a short connection-pool warm-up in global setup, but not
  eliminated outright, since it is genuine network variance to a remote
  service rather than anything under this suite's control.
- This is a headless-Chromium-only suite; no cross-browser (Firefox/Safari)
  or real-device coverage was requested or performed.

## Reproducible commands

```bash
# Full E2E suite (spins up a production build automatically)
npm run test:e2e

# Interactive UI mode
npm run test:e2e:ui

# Restore-specific RLS/integration coverage
npx vitest run tests/rls/phase1-restore.test.ts

# Full combined RLS suite (Phase 0 + Phase 1 CRM + Phase 1 restore)
npm run test:rls
```

No secrets are required beyond the same `.env.local` entries already used
by `tests/rls/*.test.ts` (`SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`,
`SUPABASE_TEST_SERVICE_ROLE_KEY`) plus the existing
`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` (already pointed
at `scopevia-test` for local development).
