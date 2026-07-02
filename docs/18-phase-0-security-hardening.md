# 18 — Phase 0 Security Hardening

This document records the security review performed on the already-implemented Phase 0 (see [14-phase-0-foundations.md](14-phase-0-foundations.md)), the issues it found, and the fixes applied in `supabase/migrations/20260701121000_security_hardening.sql`. For the actual test execution results against a real Postgres instance, see [19-phase-0-verification-evidence.md](19-phase-0-verification-evidence.md).

## Issues found and fixed

| # | Issue | Severity | Fix |
|---|---|---|---|
| 1 | `protect_last_owner()` had a race condition: two concurrent transactions demoting/suspending two different owners of the same tenant could each read "another active owner remains" under READ COMMITTED before either commits, leaving zero owners. | High | Lock the tenant row (`SELECT ... FOR UPDATE`) at the start of the trigger, serializing all membership mutations for that tenant. See ADR update below and the concurrency test in `tests/rls/tenant-isolation.test.ts`. |
| 2 | `invite_member_by_email()` granted immediate `active` access to an invited user without their consent — a form of "add without consent," and a foot-gun if ever exposed with looser permission checks. | High | Invitations now create `status='invited'` (zero access, enforced by every existing RLS policy/helper function already requiring `status='active'`). Added `accept_invitation()` (self-service only) and `get_pending_invitations()`. `update_membership()` explicitly rejects an admin forcing `invited → active` on someone else's behalf. |
| 3 | **Newly found during this review**: `update_membership()` allowed granting the `owner` role to any member as long as the caller had `members.update` — meaning an **Admin could promote anyone (including themselves via a teammate) to Owner**, without `roles.manage`. | High (privilege escalation) | Granting `p_new_role_key = 'owner'` now requires `roles.manage` (Owner-only), matching the same bar already used for modifying an existing Owner's membership. |
| 4 | No DB-level guard preventing a `tenant_memberships.role_id` from pointing at a custom role belonging to a *different* tenant. Not exploitable today (no code path creates or assigns custom roles yet), but the schema already supports `roles.tenant_id`, so the gap would have been live the moment a custom-roles feature shipped. | Medium (latent) | Added `validate_membership_role_tenant()` trigger (BEFORE INSERT OR UPDATE on `tenant_memberships`): a system role may be used by any tenant; a custom role may only be used by memberships of its own tenant. |
| 5 | `prevent_self_membership_modification()` needed a narrow exception once invitations became consent-based (the invited user MUST be able to change their own `status` from `invited` to `active`). | N/A (required for fix #2) | Added a precise carve-out: only `invited → active` with the role unchanged is exempted; every other self-modification (self-promotion, self-reactivation from `suspended`, self-role-change) remains blocked. |

## Security Definer function audit

| Function | Security definer | Allowed callers | Checks performed | Mutated tables | Audit behavior | Test coverage |
|---|---|---|---|---|---|---|
| `handle_new_user()` | Yes (trigger) | Postgres only (`AFTER INSERT ON auth.users`) | None — tolerant by design (`exception when others` logs a warning, never blocks signup) | `profiles` (insert) | None (provisioning, not a user action) | Manual: signup with/without `full_name` metadata (see [19](19-phase-0-verification-evidence.md)) |
| `user_is_active_tenant_member(uuid)` | Yes | `authenticated` (EXECUTE granted) | `auth.uid()` implicit via `tenant_memberships.user_id = auth.uid()`; returns `false` (never errors) if `auth.uid()` is null | None (read-only) | N/A | Exercised indirectly by every RLS test in `tests/rls/` |
| `user_has_permission(uuid, text)` | Yes | `authenticated` | Same as above, plus permission-key match | None (read-only) | N/A | Exercised indirectly by every permission-gated test |
| `get_user_tenants()` | Yes | `authenticated` | Filters by `auth.uid()`, `status='active'`, `tenant.deleted_at is null` | None (read-only) | N/A | `Read isolation` describe block |
| `log_audit_event(...)` | Yes | `authenticated` | Rejects if `p_actor_user_id` is non-null and `<> auth.uid()` (cannot log on behalf of another user) | `audit_logs` (insert only) | Itself IS the audit mechanism; does not swallow exceptions so a failed insert rolls back the caller's whole transaction | `Audit log integrity` describe block |
| `create_tenant_with_owner(text, text)` | Yes | `authenticated` | `auth.uid() is not null`; name length; slug format; seeded owner role exists; unique-slug violation caught and re-raised as a clean error | `tenants` (insert), `tenant_memberships` (insert), `audit_logs` (2x insert) | Transactional — see ADR 0005 | `Tenant creation idempotency` describe block |
| `update_membership(uuid, text, text)` | Yes | `authenticated` | Row exists; caller ≠ target (`auth.uid()`); target is not Owner unless caller has `roles.manage`; granting `owner` requires `roles.manage`; granting any other role or changing status requires `members.update`/`members.remove`; cannot force `invited → active` | `tenant_memberships` (update), `audit_logs` (insert) | Transactional | `Write isolation`, `Owner protection`, `Suspension & removal`, `Last-owner protection under concurrency` |
| `invite_member_by_email(uuid, text, text)` | Yes | `authenticated` | Caller has `members.invite`; role ≠ `owner`; target email resolves to an existing `auth.users` row; role key is a valid system role | `tenant_memberships` (insert/upsert), `audit_logs` (insert) | Transactional | `Invitations` describe block |
| `accept_invitation(uuid)` | Yes | `authenticated` | Row exists (else "not found," not a permission error, to avoid confirming existence); `user_id = auth.uid()`; `status = 'invited'` | `tenant_memberships` (update), `audit_logs` (insert) | Transactional | `Invitations` describe block |
| `get_pending_invitations()` | Yes | `authenticated` | Filters by `auth.uid()`, `status='invited'` | None (read-only) | N/A | `Invitations` describe block |
| `protect_last_owner()` | Yes (trigger) | Postgres only (`BEFORE UPDATE ON tenant_memberships`) | Locks the tenant row; counts remaining active owners excluding the row being changed | None directly (blocks the triggering UPDATE) | N/A (a blocked mutation never reaches `log_audit_event`) | `Last-owner protection under concurrency` |
| `prevent_self_membership_modification()` | Yes (trigger) | Postgres only | `old.user_id = auth.uid()` plus the invited→active carve-out | None directly | N/A | `Write isolation`, `Suspension & removal`, `Invitations` |
| `validate_membership_role_tenant()` | Yes (trigger) | Postgres only | Role is either global (`is_system`) or belongs to `new.tenant_id` | None directly | N/A | `Cross-tenant role guard` |
| `audit_tenant_update()` / `audit_profile_update()` | Yes (trigger) | Postgres only | None beyond detecting a real change | `audit_logs` (insert) | Transactional (same statement as the tenant/profile UPDATE) | `Write isolation` (tenant rename) |
| `prevent_audit_log_mutation()` | No (plain trigger, no elevated privilege needed) | Postgres only | Unconditionally raises on UPDATE/DELETE | None (blocks the mutation) | N/A | `Audit log integrity` |

**On `search_path`, null handling, and SQL injection surface:** every `SECURITY DEFINER` function above sets `search_path = public, pg_temp` explicitly (preventing a malicious `search_path` from redirecting an unqualified identifier to an attacker-controlled object), uses only static, parameterized SQL (no `EXECUTE`/string-built SQL anywhere in Phase 0), and reads the acting identity exclusively from `auth.uid()` — no function accepts a `user_id`/`actor_id` parameter as a source of authority. A null/invalid UUID parameter (e.g. `p_membership_id` for a row that doesn't exist) is handled via `if not found then raise exception ... 'P0002'` rather than proceeding with null-derived behavior.

## Invitations — risk analysis and decision

Risks considered for `invite_member_by_email()`:

| Risk | Assessment | Mitigation |
|---|---|---|
| Adding someone without consent | Real, and the main issue fixed here | **Recommended option adopted**: membership starts as `invited` (zero access) until `accept_invitation()` |
| Email enumeration | The function reveals whether an email has a Scopevia account (distinct error for "no account" vs. other failures) | **Accepted risk, scoped**: this RPC is only reachable by an authenticated member holding `members.invite` in a specific tenant — not a public/unauthenticated surface. The blast radius of enumeration is "a trusted teammate learns whether an email has an account," not the general public. Revisit if invite is ever exposed more broadly (e.g. bulk CSV invite) |
| Adding to the wrong tenant by mistake | UX risk, not a security one — mitigated by the invited party's own review-and-accept step (they see the tenant name before accepting) | Addressed by consent flow |
| Immediate access without acceptance | Fixed by this hardening pass | `invited` grants zero access anywhere in RLS |

## Audit event classification

| Event | Classification | Rationale |
|---|---|---|
| `tenant.created` | `transactional_required` | Inside `create_tenant_with_owner()` — a failed audit insert rolls back the whole tenant creation |
| `tenant.updated` | `transactional_required` | `AFTER UPDATE` trigger on `tenants`, same transaction as the rename |
| `membership.created` | `transactional_required` | Inside `invite_member_by_email()` |
| `membership.activated` | `transactional_required` | Inside `accept_invitation()` and `update_membership()` |
| `membership.suspended` | `transactional_required` | Inside `update_membership()` |
| `membership.removed` | `transactional_required` | Inside `update_membership()` |
| `membership.role_assigned` | `transactional_required` | Inside `create_tenant_with_owner()` and `update_membership()` |
| `profile.updated` | `transactional_required` | `AFTER UPDATE` trigger on `profiles` |
| `auth.signed_in` | `best_effort` | Supabase Auth manages the session outside any transaction we control; logged from the application layer in a try/catch that never blocks sign-in (`src/lib/audit/log.ts`) |
| `auth.signed_out` | `best_effort` | Same limitation as above |
| *(none in Phase 0)* | `external_provider` | Reserved classification for future events originating outside our database entirely (e.g. a Stripe webhook) — not applicable yet |

`membership.role_removed` (listed in the original spec) does not exist as a separate event in Phase 0: a role change is always a substitution, logged once as `membership.role_assigned` with the new role — a membership always has exactly one role, so there is nothing to "remove" independently.

## Active tenant cookie audit

| Property | Status |
|---|---|
| Grants access by itself | No — every read re-validates against `get_user_tenants()` (see `pickActiveTenant()`, `src/lib/auth/pick-active-tenant.ts`, unit-tested in `tests/unit/pick-active-tenant.test.ts`) |
| Manipulating it to a foreign tenant id | No effect beyond falling back to the user's first valid tenant — proven by the unit test above at the app layer, and by RLS itself denying any actual data access regardless of what the cookie says |
| Suspended/removed membership invalidates it | Yes, on the next request — `get_user_tenants()` filters `status='active'`, so a suspended/removed tenant disappears from the authoritative list immediately; `requireActiveTenant()` then falls back or redirects. Data access is blocked even sooner, at the RLS layer, regardless of the cookie or an already-issued session JWT (see `tests/rls/tenant-isolation.test.ts`, "Suspension & removal revoke access immediately") |
| `httpOnly` | Yes |
| `secure` | `process.env.NODE_ENV === "production"` — off for local HTTP dev, on everywhere else |
| `sameSite` | `lax` |
| `path` | `/` |
| Expiration | 1 year (`maxAge`), reset on every explicit switch |
| Sensitive content | No — contains only a tenant UUID, nothing else |

## Service role / bundle leakage verification

See [19-phase-0-verification-evidence.md](19-phase-0-verification-evidence.md) for the exact commands and results. Summary: `SUPABASE_SERVICE_ROLE_KEY` is read in exactly one file (`src/lib/supabase/admin.ts`), which begins with `import "server-only"`; a production build was produced successfully (which would fail if any Client Component imported that module); a post-build grep of `.next/static` (and `.next` as a whole) for the strings `SUPABASE_SERVICE_ROLE_KEY` and `createAdminClient` returned zero matches.
