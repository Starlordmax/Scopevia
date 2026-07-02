# 19 — Phase 0 Verification Evidence

Environment used, exact commands run, and their real results. States used below: `PASS`, `FAIL`, `NOT RUN`, `BLOCKED`. No result is marked `PASS` unless it was actually executed in this session against real infrastructure.

## Environment

- **Local machine**: Windows, no Docker/WSL available (verified: `docker --version` → not found; `wsl --status` → "Subsistema de Windows para Linux no está instalado"; no `podman`/`colima`).
- **Database**: Supabase remote project, ref `msduefaopvxfjqktjymo` (dashboard name **"SCOPEVIA"**), created by the user on 2026-07-02 specifically for Scopevia testing, referred to throughout this project as `scopevia-test`. Linked via `npx supabase login` + `npx supabase link --project-ref <ref>`, run by the user in their own terminal — no token, password, or key was ever entered into or read from this session. Confirmed via `npx supabase projects list`: this is the only project with `"linked":true`; the org's other project ("Starlordmax's Project", created 2026-05-29) was untouched throughout. **Never** staging or production.
- **Verification date**: 2026-07-02.

## 1. Static verification (no database required)

| Check | Command | Result |
|---|---|---|
| Dependency install | `npm install` | PASS — 406 packages, 0 errors |
| Type check | `npm run typecheck` | PASS — 0 errors |
| Lint | `npm run lint` | PASS — 0 errors, 0 warnings |
| Unit tests | `npm test` | PASS — 3 files, 26 tests |
| Production build | `npm run build` | PASS — compiles, typechecks, prerenders all static routes; session-dependent routes correctly marked dynamic (`ƒ`) |
| RLS suite without credentials | `npm run test:rls` (before `.env.local` was fully configured) | PASS (correctly skipped) — 40 tests reported as skipped, not failed |

## 2. Service role / bundle leakage verification

```bash
grep -rl "SUPABASE_SERVICE_ROLE_KEY" .next/static   # 0 matches
grep -rl "SUPABASE_SERVICE_ROLE_KEY" .next          # 0 matches (whole build output)
grep -rl "createAdminClient" .next/static           # 0 matches
```

Result: **PASS**. No secret value was read or printed at any point — only the env var *name* and the admin-client function *name* were searched for. `.env.local` confirmed `git check-ignore`d before any credentials were written to it.

## 3. Migration verification (from-scratch apply)

| Check | Command | Result |
|---|---|---|
| Confirm linked project | `npx supabase projects list` | PASS — exactly one project `linked:true`, matching the user's description |
| Confirm remote is empty before push | `npx supabase migration list` | PASS — all 11 local migrations showed `"remote":""`, confirming a genuine from-scratch target |
| Push all 11 migrations | `npx supabase db push --include-seed` | PASS — all 11 applied with no errors (one benign `NOTICE: extension "pgcrypto" already exists, skipping`); `supabase/seed.sql` applied (no-op, comment-only file) |
| Push idempotency (re-run with nothing new) | `npx supabase db push` | PASS — `"Remote database is up to date."` |
| Seed idempotency (re-apply the exact seed rows) | Ad hoc script: `upsert` the same 9 `permissions` rows via `onConflict: 'key'` | PASS — row counts identical before/after (`permissions=9, systemRoles=6, rolePermissions=21`) |

`db reset` was never run against the remote project, per instruction.

## 4. RLS / security suite results

`npm run test:rls` against the real `scopevia-test` database. **First run: 37/40 passed, 3 failed.** All 3 failures were investigated and confirmed to be **test-assertion bugs, not application security bugs** (see "Issues found during verification" below) — fixed, then the suite was run **twice more** to check for flakiness in the concurrency test. **Both re-runs: 40/40 passed.**

| Group | Case | Result |
|---|---|---|
| Invitations | an invited (not yet accepted) membership grants ZERO access | PASS |
| Invitations | get_pending_invitations() shows the invite to the invited user only | PASS |
| Invitations | a user cannot accept someone else's invitation | PASS |
| Invitations | an admin/owner cannot force-activate a pending invitation on the invited user's behalf | PASS |
| Invitations | the invited user accepts their own invitation and immediately gains access | PASS |
| Invitations | owner can cancel a still-pending invitation | PASS |
| Read isolation | User A can read Tenant A | PASS |
| Read isolation | User A cannot read Tenant B | PASS |
| Read isolation | User B cannot read Tenant A | PASS |
| Read isolation | Viewer (C) is an active member but CANNOT list tenant members (no members.view) | PASS |
| Read isolation | Admin (D) CAN list tenant members (has members.view) | PASS |
| Read isolation | no global membership enumeration | PASS |
| Read isolation | no global profile enumeration | PASS |
| Read isolation | anon cannot read any tenant | PASS |
| Write isolation | User A cannot update Tenant B | PASS |
| Write isolation | Viewer (C) cannot update Tenant A | PASS |
| Write isolation | Admin (D) CAN update Tenant A | PASS |
| Write isolation | no client can insert audit_logs directly | PASS |
| Write isolation | no client can insert tenant_memberships directly | PASS |
| Write isolation | no client can modify system roles | PASS *(fixed — see below)* |
| Write isolation | no client can insert into role_permissions | PASS |
| Write isolation | no user can grant themselves the owner role | PASS |
| Owner protection | Admin (D) cannot modify Owner (A)'s membership | PASS |
| Owner protection | granting owner role requires roles.manage | PASS |
| Owner protection | Viewer (C) cannot modify any membership | PASS |
| Cross-tenant role guard | duplicate SYSTEM role key rejected | PASS |
| Cross-tenant role guard | two tenants share a custom role key without conflict | PASS |
| Cross-tenant role guard | Tenant A custom role cannot be assigned to a Tenant B membership | PASS *(fixed — see below)* |
| Tenant creation idempotency | duplicate slug rejected, no orphan tenant | PASS |
| Tenant creation idempotency | concurrent creation, same slug: exactly one winner | PASS |
| Audit log integrity | audit_logs cannot be updated, even via service_role | PASS |
| Audit log integrity | audit_logs cannot be deleted, even via service_role | PASS |
| Audit log integrity | Tenant A user cannot read Tenant B's audit logs | PASS |
| Audit log integrity | sensitive actions logged transactionally | PASS |
| Audit log integrity | audit metadata contains no secrets | PASS |
| Suspension & removal | suspending Viewer (C) immediately blocks their EXISTING session | PASS |
| Suspension & removal | a suspended user cannot reactivate their own membership | PASS |
| Suspension & removal | removing Admin (D) immediately blocks their EXISTING session | PASS |
| Last-owner concurrency | exactly one of two concurrent demotions is rejected | PASS *(fixed — see below)* |
| Last-owner concurrency | direct service_role UPDATE also cannot remove the last owner | PASS |

## Issues found during verification, and their resolution

Three test failures on the first real run — each investigated to determine whether it indicated an actual security defect or a flawed test expectation, per the rule "no test is marked PASS without having actually run":

| # | Test | What happened | Root cause | Verdict | Fix |
|---|---|---|---|---|---|
| 1 | `no client can modify system roles` | Expected an `error`, got `error: null` | RLS with no UPDATE policy makes the `USING` clause unconditionally false — Postgres reports success with **zero rows matched**, not a permission-denied error (identical shape to the cross-tenant `tenants` update tests already in the suite) | **Test bug**, not a security bug. Confirmed empirically: queried the live `roles` row after the "attack" — `name` was still `"Owner"`, never `"Hacked Owner"` | Rewrote the assertion to check 0 rows returned + independently re-queried the row to confirm it was unchanged |
| 2 | `a Tenant A custom role cannot be assigned to a Tenant B membership` | Expected "does not belong to tenant", got "at least one active owner" | The test targeted Tenant B's **owner** membership (its only membership at the time). Changing an owner's `role_id` away from `owner` trips `protect_last_owner` (alphabetically-earlier trigger) *before* `validate_membership_role_tenant` ever runs — both guards are correct, the test picked a target that triggered the wrong one first | **Test bug**, not a security bug — the row was never modified either way | Invited a plain (non-owner) member to Tenant B specifically for this test, isolating the two guards from each other |
| 3 | `exactly one of two concurrent demotions of the two owners is rejected` | Expected "at least one active owner" on the losing call, got "only an owner can modify another owner's membership" | Depending on exact commit timing, the loser can be rejected via **either** of two independently-correct mechanisms: (a) `protect_last_owner`'s count check (the mechanism the `FOR UPDATE` lock fix targets), or (b) if the other demotion commits first, the loser's *own* membership becomes inactive before their `user_has_permission('roles.manage')` check runs, so they lose authorization one step earlier. Both are legitimate proof the race can never let both succeed | **Test bug** (regex too narrow), not a security bug. Confirmed: `succeeded.length === 1` and `failed.length === 1` were correct in the *original* failing run too — only the specific error-message regex was wrong | Broadened the accepted-message regex to match either valid rejection reason; documented both mechanisms in the test's comments |

None of these three required any change to `supabase/migrations/`. They are recorded here in full (not silently fixed and forgotten) because a security-hardening pass that "quietly makes failing tests pass" is exactly the failure mode this whole review exists to prevent — each was independently confirmed against live data before being reclassified as a test bug.

## 5. Auth / profile trigger verification

| Check | Result |
|---|---|
| `handle_new_user()` creates a profile with no metadata | PASS — `full_name: null`, sensible defaults (`locale: "en-US"`, `timezone: "UTC"`) |
| `handle_new_user()` captures `full_name` when provided in `user_metadata` | PASS — verified exact value round-trips |
| Deleting a user cleanly removes their profile/memberships (cascade) | PASS — observed throughout suite teardown (`afterAll` deletes 6+ users per run across 3 runs, zero errors) |
| Full browser-driven signup / email confirmation / password recovery UI flow | NOT RUN — requires a running dev server and a real inbox; out of scope for this verification pass, which focused on the 7 items requested (link confirmation, migration list, db push, RLS suite, PASS/FAIL reporting) |

## 6. Version control

| Check | Result |
|---|---|
| `git init` | PASS |
| Secret scan before commit | PASS — 0 matches outside one labeled example password in docs |
| No `.env.local`/keys/tokens staged | PASS |
| Base commit | PASS — `014afe0 chore: complete and verify phase 0 foundations` |
| Follow-up commit (hardening docs + test fixes) | See CHANGELOG.md — created after this document was finalized |
| Pushed to a remote | NOT RUN — not requested; local commits only |

## 7. Summary

Every check requested was executed for real against either the local toolchain or the live `scopevia-test` Postgres database — nothing in this document is inferred from code review alone. The verification process itself found and fixed 3 bugs in the **test suite** (not the application) before reaching a stable 40/40 pass, confirmed stable across 2 additional full runs.
