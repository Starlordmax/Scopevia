# 23 — Phase 1 RLS Verification

Real command output and PASS/FAIL results for Phase 1, verified against
the same dedicated Supabase test project used for Phase 0
(`scopevia-test`, ref `msduefaopvxfjqktjymo`, dashboard name "SCOPEVIA").
Never production, never a `db reset` run remotely. States used below:
`PASS`, `FAIL`, `NOT RUN`, `BLOCKED` — no result is marked `PASS` unless
it actually ran in this session against real infrastructure. Verification
date: 2026-07-02.

## 1. Static verification

| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | PASS — 0 errors |
| Lint | `npm run lint` | PASS — 0 errors, 0 warnings |
| Unit tests | `npm test` | PASS — 4 files, 60 tests (26 Phase 0 + 34 new Phase 1: `crm-validation.test.ts` covering Zod schemas and both transition maps) |
| Production build | `npm run build` | PASS — compiles, typechecks, prerenders static routes; all new Phase 1 routes correctly marked dynamic (`ƒ`) |

## 2. Migration verification against the linked remote

| Check | Command | Result |
|---|---|---|
| Confirm no drift between local and remote | `npx supabase migration list` | PASS — all 23 migrations (11 Phase 0 + 12 Phase 1, including the forward-fix `20260702131200`) show identical `local`/`remote` timestamps |
| Migration discipline | Manual review | PASS — no already-applied migration file was edited after being pushed; one required fix (`update_*` functions needing `default null` for nullable-optional params, discovered via `npm run typecheck` after `supabase gen types`) was shipped as a new forward-fix migration, `20260702131200_crm_update_functions_nullable_defaults.sql`, per the phase's explicit "no edites migraciones ya aplicadas" rule |

## 3. RLS / integration suite results

`npm run test:rls` against the real `scopevia-test` database, combining
the existing Phase 0 suite and the new Phase 1 suite in the same run.

**Result: 68/68 passed, 0 failed, 0 skipped, 0 flaky across the run.**
Per-test durations ranged 180ms–1.3s (network round trips to a real
Postgres instance, not mocked) — full verbose output captured
2026-07-02.

### Phase 0 regression (`tests/rls/tenant-isolation.test.ts`) — 40/40 PASS

No changes were made to any Phase 0 migration or function in this phase
(the one migration file touched, `20260701120400_roles_and_permissions.sql`,
was untouched — only Phase 1 seed data was added in a new migration). All
40 Phase 0 cases re-ran and passed with no regression: invitations,
read/write isolation, owner protection, cross-tenant role guard, tenant
creation idempotency/concurrency, audit log integrity, suspension &
removal, and the last-owner concurrency race. See
[19-phase-0-verification-evidence.md](19-phase-0-verification-evidence.md)
for the original per-case table.

### Phase 1 (`tests/rls/phase1-crm.test.ts`) — 28/28 PASS

| Group | Case | Result |
|---|---|---|
| Tenant isolation | User A cannot read Tenant B's client | PASS |
| Tenant isolation | User A cannot update Tenant B's client via the RPC | PASS |
| Tenant isolation | User A cannot archive Tenant B's client | PASS |
| Tenant isolation | no global enumeration: unfiltered clients query never includes Tenant B rows | PASS |
| Tenant isolation | anon cannot read clients, opportunities, or projects | PASS |
| Cross-tenant relationship integrity | `create_opportunity` rejects a client from a different tenant (application check) | PASS |
| Cross-tenant relationship integrity | a direct `service_role` INSERT bypassing the function is rejected by the composite FK (`23503`) | PASS |
| Cross-tenant relationship integrity | an assignee from a different tenant is rejected | PASS |
| Permission matrix | Viewer cannot create a client | PASS |
| Permission matrix | Viewer CAN view clients | PASS |
| Permission matrix | Sales can create a client and an opportunity | PASS |
| Permission matrix | Sales can create a project but cannot update it (no `projects.update`) | PASS |
| Permission matrix | Field Worker cannot view clients or opportunities, but CAN view projects (broad, non-assignment-scoped) | PASS |
| Permission matrix | Field Worker cannot archive a client | PASS |
| Permission matrix | Field Worker CAN create a note on a project | PASS |
| Permission matrix | no permission can be escalated via a manipulated payload | PASS |
| Concurrency | two concurrent `set_primary_contact` calls leave exactly one primary contact | PASS |
| Concurrency | two concurrent `convert_opportunity_to_project` calls produce exactly one project, same id returned to both | PASS |
| Concurrency | retrying `convert_opportunity_to_project` after success returns the same project | PASS |
| Opportunity status machine | rejects an invalid transition (`new → won`) | PASS |
| Opportunity status machine | requires `lost_reason` when marking as lost | PASS |
| Opportunity status machine | requires `inspection_scheduled_at` for `inspection_scheduled` | PASS |
| Opportunity status machine | cannot archive an opportunity that is not won or lost | PASS |
| Notes/activity/audit separation | creating a note produces rows in `crm_notes`, `crm_activities`, AND `audit_logs` | PASS |
| Notes/activity/audit separation | no client can insert into `crm_activities` directly | PASS |
| Notes/activity/audit separation | `crm_activities` cannot be updated or deleted, even via `service_role` | PASS |
| Notes/activity/audit separation | `crm_activities.metadata` never contains password/token/secret-shaped values | PASS |
| Suspension | suspending Sales immediately blocks their EXISTING session from reading clients | PASS |

No test failures were encountered on the first run of the Phase 1 suite
— unlike Phase 0.5, there were no test-assertion bugs to investigate and
reclassify this time. The suite was run twice (once standalone during
development, once combined with the full Phase 0 suite for this
document) with identical results both times, giving basic confidence the
concurrency assertions aren't flaky.

## 4. RLS policy coverage

Every one of the 7 new tables has RLS enabled with a single `SELECT`
policy scoped `to authenticated`, and **no** INSERT/UPDATE/DELETE grant
for `authenticated` on any of them — every mutation goes exclusively
through a `SECURITY DEFINER` function, identical to the Phase 0
discipline.

| Table | SELECT policy condition |
|---|---|
| `clients` | `user_has_permission(tenant_id, 'clients.view')` |
| `client_contacts` | `user_has_permission(tenant_id, 'contacts.view')` |
| `opportunities` | `user_has_permission(tenant_id, 'opportunities.view')` |
| `projects` | `user_has_permission(tenant_id, 'projects.view')` |
| `project_addresses` | `user_has_permission(tenant_id, 'projects.view')` |
| `crm_notes` | `notes.view` **AND** the relevant parent permission (`clients.view`/`opportunities.view`/`projects.view`, based on which of `client_id`/`opportunity_id`/`project_id` is set) |
| `crm_activities` | `activities.view` **AND** the relevant parent permission, same shape as `crm_notes` |

The `crm_notes`/`crm_activities` "AND the parent permission" clause is
not incidental — it closes a real gap found during self-review before
any live testing: without it, a role with `notes.view` +
`projects.view` but not `clients.view`/`opportunities.view` (i.e.
Field Worker) could read a client- or opportunity-attached note directly
by querying `crm_notes`, bypassing the fact that they cannot otherwise
see that client/opportunity at all. This is recorded here rather than
silently fixed, following the same "don't hide a caught security issue"
discipline as `docs/18-phase-0-security-hardening.md`. It never reached
any pushed migration in its unpatched form — corrected during
implementation, before the first `db push` of this migration.

## 5. Checklist for adding a new tenant-scoped table (extended for Phase 1)

Carried over from
[17-rls-verification.md](17-rls-verification.md) and extended with what
Phase 1 actually required in practice:

1. `unique (id, tenant_id)` on the parent, composite FK on every child
   (ADR 0007) — not just a plain `tenant_id` column.
2. RLS enabled, `SELECT` policy scoped `to authenticated`, no
   `anon` policy, no INSERT/UPDATE/DELETE grant for `authenticated`.
3. If the table can attach to more than one kind of parent (like
   `crm_notes`/`crm_activities`), the `SELECT` policy must check **both**
   the table's own view permission **and** the caller's permission on
   whichever specific parent the row belongs to — a blanket "can view
   this table" permission is not sufficient on its own.
4. Every mutation via a `SECURITY DEFINER` function: revoke `PUBLIC`,
   grant `authenticated`, validate the target exists in the caller's
   tenant, check the specific permission key, derive the actor from
   `auth.uid()` only.
5. If the table needs "exactly one of N per parent" (a primary contact,
   a primary address) or "at most one child per specific parent row"
   (opportunity → project), add the partial/unique index as the
   declarative backstop and lock the shared parent row before the
   read-decide-write sequence (ADR 0013) — don't rely on application
   logic alone.
6. Write a cross-tenant test that bypasses the function entirely (direct
   `service_role` insert) to prove the composite FK itself rejects it,
   not just the application-level pre-check.
