# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

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
