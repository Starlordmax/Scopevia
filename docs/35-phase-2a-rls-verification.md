# 35 — Phase 2A RLS Verification

Status: **Real Postgres + real Storage, not mocked.** Same infrastructure
discipline as [17](17-rls-verification.md) and
[23](23-phase-1-rls-verification.md) — a dedicated `scopevia-test`
Supabase project, fresh users/tenants per run, real RPC calls, real
Storage uploads.

## Environment

| | |
|---|---|
| Database | `scopevia-test` (ref `msduefaopvxfjqktjymo`) — the same project used throughout Phase 0/1/2A |
| Storage | The real `scopevia-media` bucket on that same project |
| Test runner | Vitest, `tests/rls/phase2a-proposals.test.ts` and `tests/rls/phase2a-storage.test.ts` |
| Logical users | Owner A (owner in Tenant A, also a member of Tenant B for isolation tests), Owner B, Estimator, Sales, Viewer, Field Worker — all created fresh per run |

## Results

| Suite | Tests | Result |
|---|---|---|
| `tests/rls/tenant-isolation.test.ts` (Phase 0) | 40 | PASS |
| `tests/rls/phase1-crm.test.ts` (Phase 1) | 28 | PASS |
| `tests/rls/phase1-restore.test.ts` (Phase 1) | 27 | PASS |
| `tests/rls/phase2a-proposals.test.ts` (Phase 2A) | 34 | PASS |
| `tests/rls/phase2a-storage.test.ts` (Phase 2A) | 14 | PASS |
| **Total** | **143** | **143/143 PASS, zero regressions** |

(One run during this phase showed a single flaky failure in
`tenant-isolation.test.ts`'s "exactly one of two concurrent demotions… is
rejected" concurrency test — passed cleanly on immediate retry, unrelated
to any Phase 2A change, no RLS/permission code touched by this phase. Not
counted as a regression.)

## What `phase2a-proposals.test.ts` covers

Proposal creation (direct, from-opportunity, auto-created opportunity,
duplicate-active-proposal rejection, cross-client contact/opportunity
rejection, idempotency-key dedup, concurrent-creation numbering safety);
the calculation engine end-to-end through real RPCs (labor, line items,
pricing, manipulated-total rejection, invalid-input rejection); locked
version immutability (service-role-forced lock, function rejection, raw
trigger rejection, sanctioned `locked → superseded`); proposal status
transitions (draft↔ready, no-manual-jump-to-sent/viewed/accepted/declined,
archive/restore); cross-tenant integrity via raw `service_role` inserts
(client, media, portfolio media — all rejected `23503`); tenant isolation
via real RLS (unfiltered query returns nothing, RPC on another tenant's
proposal rejected); the full permission matrix (Viewer read-only, Sales
create/update without pricing, Estimator full pricing, Field Worker
upload-only); Portfolio CRUD and its "archiving doesn't break an existing
proposal" guarantee; tenant proposal settings (idempotent get-or-create,
permission-gated update, concurrency-safe numbering); and
`create_project_from_accepted_proposal()`'s architecture-prep behavior
(rejected before acceptance, correct copy + idempotency once a
`service_role`-forced `accepted` status is in place).

## What `phase2a-storage.test.ts` covers

Real uploads/downloads against the actual `scopevia-media` bucket: bucket
privacy, valid PNG upload, oversized rejection, wrong-MIME rejection,
cross-tenant upload/download/list rejection, no-public-URL, working
signed URL, Viewer upload rejection, Field Worker upload success, path
manipulation rejection, and `register_media_asset()`'s own cross-tenant
path rejection. See [docs/33](33-media-and-storage-security.md) for the
security model these tests exercise.

## Cross-tenant integrity (service_role raw inserts)

Verified directly, bypassing every application-layer check: a `proposals`
row referencing a different tenant's client, a `proposal_media` row
referencing a different tenant's `media_assets`, and a
`portfolio_project_media` row referencing a different tenant's media —
all three rejected by Postgres itself with `23503 foreign_key_violation`,
never merely by RLS.

## Known limitation carried forward

Same as Phase 1: no per-assignment RLS. Field Worker's proposal/media
visibility is tenant-wide (gated by permission, not "only proposals I'm
assigned to") — this was already the case for Projects in Phase 1 and is
not changed or worsened by Phase 2A.
