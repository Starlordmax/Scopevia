# 24 — Phase 1 Manual Testing

**Update (2026-07-02, Phase 1.5 verification round):** the browser-automation
gap this document originally recorded is now closed — a real Playwright
E2E suite (Chromium, headless) exercises every flow marked `NOT RUN` below,
stable at 48/48 across three consecutive full runs, plus dedicated
automated coverage for all five restore operations. See
[25-phase-1-e2e-verification.md](25-phase-1-e2e-verification.md) for the
full scenario list, results, and the real bugs that browser testing found
(including one that crashed the entire app for any multi-tenant user).
This document is kept as-is below for the historical record of what was
and wasn't verified at the time Phase 1 was first delivered.

---

Honesty note, matching the discipline set in
[19-phase-0-verification-evidence.md](19-phase-0-verification-evidence.md#5-auth--profile-trigger-verification):
this session has no browser-automation tool available, so a true
click-through, form-by-form manual walkthrough in a real browser was
**not** performed and is marked `NOT RUN` below rather than claimed. What
**was** run for real: a route-level smoke test against a live `next dev`
server (confirming every new page boots and enforces auth), and the full
RLS/integration suite (`tests/rls/phase1-crm.test.ts`) exercising the
exact same server-side logic — permission checks, state machine
enforcement, cross-tenant rejection — that each manual step below would
touch, via direct RPC calls rather than clicking through forms. That
suite is real evidence the *logic* behind each step works; it is not a
substitute for confirming the *UI* renders correctly, is legible on a
small screen, and has no client-side wiring bugs (a broken `onClick`, a
misnamed form field) that a passing RPC test cannot catch.

## 1. Route-level smoke test (real, executed)

Started `npm run dev` against the real `scopevia-test`-backed
`.env.local`, then `curl`'d each new Phase 1 route unauthenticated:

| Route | Result |
|---|---|
| `/clients` | `307` → `Location: /sign-in?redirectTo=%2Fclients` |
| `/opportunities` | `307` → same pattern |
| `/pipeline` | `307` → same pattern |
| `/projects` | `307` → same pattern |
| `/sign-in` | `200` |

**PASS** — every new protected route boots without a server error and
correctly redirects an unauthenticated request to sign-in with a
`redirectTo`, consistent with Phase 0's existing `proxy.ts` route
protection. This is a real, if shallow, signal that the pages compile
and render server-side under a live database connection (`next dev`
would otherwise surface a build/runtime error, not a clean redirect).

## 2. Manual checklist (logic proven via automated tests; UI walkthrough NOT RUN)

For each step, the "Automated evidence" column names the exact
`tests/rls/phase1-crm.test.ts` case(s) that exercise the same
server-side call the UI action would make.

| Step | Automated evidence | Browser walkthrough |
|---|---|---|
| Create a client | `Permission matrix > Sales can create a client and an opportunity` (calls `create_client` RPC) | NOT RUN |
| Add a contact to the client | `Concurrency > two concurrent set_primary_contact calls...` (creates contacts via `create_client_contact`) | NOT RUN |
| Create an opportunity for the client | `Cross-tenant relationship integrity > create_opportunity rejects...` and others (calls `create_opportunity`) | NOT RUN |
| Change the opportunity's status | `Opportunity status machine` group (4 cases, calls `change_opportunity_status`) | NOT RUN |
| Schedule an inspection | `Opportunity status machine > requires inspection_scheduled_at for inspection_scheduled` | NOT RUN |
| Convert the opportunity to a project | `Concurrency > two concurrent conversions...` and `...retrying convert_opportunity_to_project...` (calls `convert_opportunity_to_project`) | NOT RUN |
| Create a project address | Covered by function-level design (ADR 0013) and the `set_primary_project_address` concurrency pattern shared with contacts; no dedicated RLS test calls `create_project_address` directly | NOT RUN |
| Create a note on the project | `Notes, activity, and audit separation > creating a note produces rows in crm_notes, crm_activities, AND audit_logs` (calls `create_note`) | NOT RUN |
| Archive and restore an entity | `Opportunity status machine > cannot archive an opportunity that is not won or lost` (calls `archive_opportunity`); `restore_*` functions are not separately exercised in the RLS suite | NOT RUN (`restore_*` also NOT RUN via automated test) |
| Use the app as Viewer | `Permission matrix > Viewer cannot create a client`, `...Viewer CAN view clients` | NOT RUN |
| Use the app as Sales | `Permission matrix > Sales can create a client and an opportunity`, `...Sales can create a project but cannot update it` | NOT RUN |
| Switch tenants | Not a Phase 1 change — reuses Phase 0's `pickActiveTenant()`/`get_user_tenants()`, covered by `tests/unit/pick-active-tenant.test.ts` and the Phase 0 RLS suite | NOT RUN |

## Gaps this leaves

- **No confirmation the Kanban board actually collapses to a vertical
  stack below 640px in a real browser** — the CSS rule
  (`@media (max-width: 640px)` in `globals.css`) was written and code-reviewed
  but never rendered and measured in an actual viewport.
- **No confirmation of `restore_client`/`restore_client_contact`/
  `restore_opportunity`/`restore_project`/`restore_project_address`
  behavior against live data** — these functions exist, are granted to
  `authenticated`, and their logic mirrors the already-tested
  archive/restore pattern from Phase 0 (`accept_invitation`-style
  idempotency), but no automated test calls them directly.
- **No confirmation of actual form submission end-to-end** (client-side
  validation error display, `useActionState` pending states, redirect
  behavior after a successful create) — the route smoke test only proves
  pages render for a GET request, not that POST-ing a form through the
  browser works.

These gaps are the concrete reason the final report's "Ready for Phase
2" answer is not an unqualified yes — see the final report for the full
readiness assessment.
