# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Phase 1.5 — Real browser E2E verification and restore coverage

Closed the two gaps flagged in
[docs/24-phase-1-manual-testing.md](docs/24-phase-1-manual-testing.md):
a real Playwright browser walkthrough of the Phase 1 UI, and dedicated
automated coverage for the five restore operations. See
[docs/25-phase-1-e2e-verification.md](docs/25-phase-1-e2e-verification.md)
for full results.

**Fixed** (all found via real browser testing, not code review)

- **Critical**: the tenant-switcher `<select onChange={...}>` was rendered
  directly inside a Server Component (`(protected)/layout.tsx`) — React
  forbids event handlers on host elements there. Any signed-in user
  belonging to 2+ tenants got a 500 on every protected page, since Phase 0.
  Extracted into `src/app/(protected)/tenant-switcher.tsx`, a Client
  Component.
- Cross-tenant data exposure: `/clients/[id]`, `/clients/[id]/edit`,
  `/opportunities/[id]`, `/projects/[id]`, `/projects/[id]/edit` fetched
  their row by id alone with no `tenant_id` filter, relying entirely on
  RLS — which checks the row's own tenant, not the caller's active tenant.
  A user in two tenants with overlapping permissions could load another
  tenant's record via a stale URL. Added the missing tenant filter to all
  five queries.
- RPC error messages (e.g. `"Missing permission: opportunities.archive"`,
  `"... uses archive_opportunity()/restore_opportunity() instead"`) were
  shown to users unsanitized, exposing internal permission-key and
  function names. Added `src/lib/errors/friendly-message.ts`, applied at
  every RPC-error-to-banner call site in the Phase 1 action files.
- Accessibility: the tenant-switcher `<select>` had no label at all —
  added `aria-label="Switch business"`.
- A flaky `tests/rls/*.test.ts` timeout under real network latency (5s
  default) — raised `testTimeout`/`hookTimeout` to 15s in
  `vitest.config.ts`.

**Added**

- `tests/e2e/` — a Playwright suite (48 tests, 9 spec files) covering
  authentication, Clients, Contacts, Opportunities, Pipeline (desktop +
  real 390×844 mobile viewport), Projects (conversion idempotency,
  address primary-switching), Notes/Activities, and permissions
  (Viewer/Sales/Field Worker/tenant switching, including a manipulated
  tenant-id rejection test) — stable at 48/48 across three consecutive
  full runs, against a production build and the real `scopevia-test`
  database.
- `tests/rls/phase1-restore.test.ts` — 27 new cases covering
  `restore_client`/`restore_client_contact`/`restore_opportunity`/
  `restore_project`/`restore_project_address`: correct-permission restore,
  safe no-op on non-archived resources, Viewer/cross-tenant/suspended-user
  rejection, audit/activity logging accuracy, and two concurrency races
  (simultaneous restores; archive-vs-restore).
- `playwright.config.ts` — desktop + mobile projects, an auth setup
  project with real UI logins reused via `storageState`, trace-on-failure,
  screenshot-on-failure, no retries (so a pass means it actually worked).

### Phase 1 — CRM & Projects

Built the CRM/pipeline module on top of the verified Phase 0 foundation:
Clients → Contacts → Opportunities → Projects → Project Addresses, plus
notes and a system-generated activity timeline. See
[docs/20-phase-1-crm-and-projects.md](docs/20-phase-1-crm-and-projects.md)
for full scope and design decisions, and
[docs/23-phase-1-rls-verification.md](docs/23-phase-1-rls-verification.md)
for real test-run evidence (68/68 combined Phase 0 + Phase 1 RLS/integration
tests passing against the `scopevia-test` Postgres project, zero
regression).

**Added**

- `clients`, `client_contacts`, `opportunities`, `projects`,
  `project_addresses`, `crm_notes`, `crm_activities` tables, each
  tenant-isolated via RLS **and** declarative composite foreign keys
  (`(child_id, tenant_id) references parent (id, tenant_id)`) — not RLS
  alone. See ADR 0007.
- 27 new permission keys and an extended per-role grant matrix, with
  deliberate asymmetries (Estimator can't originate opportunities, Sales
  can't update projects after handoff, Field Worker gets tenant-wide
  `projects.view` with no per-assignment scoping — documented as a real
  limitation, not faked).
- Opportunity and project state machines, each enforced exclusively
  inside a `SECURITY DEFINER` SQL function via an explicit transition
  table — `lost`/`cancelled` are reactivable rather than terminal;
  archiving is a separate function/permission from ordinary pipeline
  movement. See ADR 0011/0012.
- `convert_opportunity_to_project()` — atomic, idempotent conversion
  (row lock + unique index + exception-handler backstop); safe to retry,
  never duplicates. See ADR 0013.
- Concurrency-safe "exactly one primary" enforcement for client contacts
  and project addresses (`set_primary_contact()`,
  `set_primary_project_address()`), backed by partial unique indexes as
  the declarative ground truth, not just application logic.
- `crm_notes` (human-authored, mutable, archivable) and `crm_activities`
  (system-generated, append-only, trigger-enforced) as two distinct
  tables using an "exclusive arc" pattern (nullable, individually
  composite-FK'd `client_id`/`opportunity_id`/`project_id` columns)
  rather than per-entity table duplication or an unsafe
  `entity_type`/`entity_id` polymorphic pair. Kept explicitly separate
  from the Phase 0 `audit_logs` security trail. See ADR 0008.
- Mobile-first pipeline Kanban board (`/pipeline`) that collapses to a
  vertical stack below 640px, with an explicit tap-based status-advance
  control — no drag-and-drop dependency.
- Dashboard metrics and a recent-activity feed on the protected home page.
- `src/lib/search.ts` — two-layer escaping (SQL `ILIKE` wildcards, then
  PostgREST `.or()` filter syntax) before any user search input reaches a
  Supabase query.
- `types/enums.ts` — hand-maintained literal unions for the text+CHECK
  "enums" that `supabase gen types` cannot capture.
- Regenerated `types/database.ts` from the real linked `scopevia-test`
  project via `npm run db:types`.
- `tests/rls/phase1-crm.test.ts` (28 cases: tenant isolation, cross-tenant
  FK rejection via a raw `service_role` insert, the full permission
  matrix, concurrency races, state machine guards, notes/activity/audit
  separation) and `tests/unit/crm-validation.test.ts` (34 cases: Zod
  schemas, both transition maps).
- Migration `20260702131200_crm_update_functions_nullable_defaults.sql` —
  a forward-fix (never edited the already-applied originals) adding
  `default null` to several `update_*` functions' optional parameters,
  needed for correct nullable-vs-required typing after regenerating
  Supabase types.
- `docs/20` through `docs/24`, and ADRs 0007–0013.

### Phase 0.5 — Security hardening & verification

Reviewed the Phase 0 implementation before allowing it to proceed to Phase 1: audited every `SECURITY DEFINER` function, verified the actual RLS/permission/concurrency behavior against a real Postgres instance (not just manual SQL review), and fixed everything the review found. See [docs/18-phase-0-security-hardening.md](docs/18-phase-0-security-hardening.md) and [docs/19-phase-0-verification-evidence.md](docs/19-phase-0-verification-evidence.md).

**Fixed**

- `protect_last_owner()`: closed a race condition where two concurrent transactions demoting/suspending two different owners could both succeed, leaving a tenant with zero owners. Now locks the tenant row first, serializing membership mutations per tenant.
- `update_membership()`: closed a privilege-escalation path found during this review — an Admin (holding only `members.update`) could promote any member straight to Owner. Granting the `owner` role now requires `roles.manage` (Owner-only).
- `invite_member_by_email()`: no longer grants immediate `active` access. Memberships are created as `invited` (zero access under every existing RLS policy) until the invited user calls the new `accept_invitation()` themselves.

**Added**

- `accept_invitation()`, `get_pending_invitations()` — self-service invitation acceptance; "Pending invitations" section on `/select-tenant`.
- `validate_membership_role_tenant()` trigger — guarantees a membership's role is either a global system role or belongs to its own tenant, ahead of the (not yet built) custom-roles feature.
- `pickActiveTenant()` extracted as a pure, unit-tested function proving cookie manipulation can never grant access to a foreign tenant.
- Expanded `tests/rls/tenant-isolation.test.ts` from 10 to 40 cases: invitation consent, suspension/removal revoking an already-issued session immediately, cross-tenant role guards, tenant-creation concurrency, and the last-owner concurrency race specifically.
- Migration `20260701121000_security_hardening.sql`.
- `docs/18-phase-0-security-hardening.md`, `docs/19-phase-0-verification-evidence.md`.
- Git version control initialized; base commit created after a secret scan of all staged files.

### Phase 0 — Foundations

Initial implementation: project scaffolding, Supabase integration, authentication, multi-tenancy, roles/permissions, Row Level Security, onboarding, and the protected application shell. No product features (CRM, estimating, proposals, payments) yet — see [docs/14-phase-0-foundations.md](docs/14-phase-0-foundations.md) for full scope and design decisions.

**Added**

- Next.js 16 (App Router) + TypeScript + React 19 project scaffold, mobile-first plain CSS.
- Supabase client separation: browser, server, middleware, admin (`src/lib/supabase/`).
- Email/password authentication: sign up, sign in, sign out, forgot/reset password, email confirmation callback.
- `profiles` table auto-provisioned from `auth.users` via trigger.
- Multi-tenancy: `tenants`, `tenant_memberships`, with a cookie-hinted, server-revalidated active tenant.
- RBAC: `roles`, `permissions`, `role_permissions`, seeded with 6 system roles and 9 permissions.
- Row Level Security on every table, deny-by-default; mutations routed through `SECURITY DEFINER` functions (`create_tenant_with_owner`, `update_membership`, `invite_member_by_email`, `log_audit_event`).
- Defense-in-depth triggers: last-owner protection, self-modification prevention, append-only audit log enforcement.
- Append-only audit trail (`audit_logs`) covering tenant/membership/profile lifecycle events.
- Onboarding flow (create business), tenant selector, protected app shell with a Phase 0 verification panel, profile page, members page (view/invite/update role/suspend/remove, permission-gated).
- Route protection via `proxy.ts` (Next.js 16's successor to `middleware.ts`).
- Versioned SQL migrations, runnable from an empty database (`supabase/migrations/`).
- Unit tests (validation schemas, permission keys) and an integration test suite proving tenant isolation (`tests/rls/`, requires local Supabase via Docker).
- Documentation: `docs/14` through `docs/17`, and ADRs 0001–0006.
