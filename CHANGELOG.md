# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

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
