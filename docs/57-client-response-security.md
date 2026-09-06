# 57 — Client Response Security Model (Phase 3B)

Status: **Implemented and verified** — 28/28 RLS/integration tests, 5/5 new
E2E scenarios. See [docs/56](56-client-portal-accept-decline.md) for the
feature itself; this document covers the security model specifically,
extending [docs/53-client-portal-security.md](53-client-portal-security.md)
rather than repeating it.

> **Phase 3B.1 extends this security model further** — the
> `create_proposal_revision()` permission/ownership/locked-state checks and
> the historical-version portal-link access fix are covered in
> [docs/58-proposal-revision-flow.md](58-proposal-revision-flow.md) and
> [docs/59-proposal-version-history.md](59-proposal-version-history.md).
> Everything below is unchanged and still accurate.

## Nothing about the trust model changes — one new function joins it

Phase 3A established the pattern this phase reuses without modification:
a portal visitor has no Supabase Auth session, so `submit_proposal_client_response()`
is called exclusively via the service-role admin client
(`createAdminClient()`), from `src/actions/portal-visitor.ts`'s
`acceptProposalAction`/`declineProposalAction`, exactly like every
`portal_*()` function before it. It's explicitly `revoke`d from `public`,
`anon`, and `authenticated` — confirmed callable only via `service_role`
(the same empirically-verified assumption from Phase 3A, unchanged).

**The client never supplies a `tenant_id`, `proposal_id`, or
`proposal_version_id`.** The only client-controlled input identifying
"who is asking" is the session token hash (read from the httpOnly cookie,
already established in Phase 3A) — every id used to write a response row
is derived from the session's own chain (`session → portal_link →
proposal`), never accepted as a parameter.

## Duplicate-response prevention: one constraint, not scattered application logic

The brief lists five separate rules ("no duplicate accept," "no accept
after decline," "no decline after accept," "no second link/session can
respond," "no raw duplicate insert"). All five collapse into exactly one
mechanism: `unique (proposal_version_id)` on `proposal_client_responses`.

```sql
-- schema
unique (proposal_version_id)
```

```sql
-- submit_proposal_client_response(), the fast/friendly path
if v_proposal.status in ('accepted', 'declined') then
  return query select 'already_responded', null::text;
  return;
end if;
...
-- the hard backstop, closing any race the fast path's read could miss
begin
  insert into public.proposal_client_responses (...) values (...);
exception when unique_violation then
  return query select 'already_responded', null::text;
  return;
end;
```

The upfront `proposals.status` check exists purely for a fast, honest
outcome in the overwhelmingly common (non-racing) case — the `unique`
constraint is what actually GUARANTEES correctness, including under
concurrent submissions from two different sessions/links racing each
other. Verified directly:
`tests/rls/phase3b-client-response.test.ts`, "only one row ever exists in
proposal_client_responses for the version, even under a raw duplicate
insert attempt" and the four duplicate/conflict scenarios above it.

This is deliberately simpler than, say, a `status` column on
`proposal_client_responses` itself with application-level transition
rules — a row's mere *existence* for a version *is* the "final response
recorded" fact, with nothing to get out of sync.

## Locking the version: real usage of an existing mechanism

`prevent_locked_proposal_version_mutation()` and
`prevent_locked_version_child_mutation()` have existed since Phase 2A but
were, per `docs/31`'s own words, exercised only via "admin/test
functions, not real send." `submit_proposal_client_response()` is the
first function to set `version_status = 'locked'` as part of ordinary
product usage — immediately after inserting the response row, in the same
transaction. This means:

- The exact commercial content (scope, pricing, terms) the client saw and
  responded to can never be silently altered afterward — verified
  directly by attempting both a raw child-table insert (`23514`... actually
  `55000`, the trigger's own errcode) and a call through
  `add_proposal_line_item()` itself (defense in depth: the function's own
  `version_status = 'draft'` guard rejects it before the trigger would
  even need to).
- This is a byproduct of locking, not a new mechanism — Phase 3B added
  zero new trigger/constraint logic for this; it just finally exercises
  what Phase 2A built and left dormant.

## The post-response access gap — a real bug, not a design choice

Fully described in [docs/56](56-client-portal-accept-decline.md#a-gap-found-by-e2e-testing-post-response-portal-access);
summarized here for the security record: `portal_get_link_info()` and
`portal_request_otp()` initially still refused any proposal not
`ready`/`sent`, which meant a visitor without an already-valid session
cookie couldn't even request a code for an already-answered proposal.
Fixed by broadening both to also accept `accepted`/`declined` — mirroring
`portal_get_session_context()`'s Phase 3B change. This broadening is
narrow and safe:

- **Archived proposals remain fully blocked** — `v_proposal.archived_at is
  not null` is checked with `or`, independent of the status list, so
  broadening the status list has zero effect on archived-proposal
  rejection. Verified directly (unchanged from Phase 3A):
  `tests/rls/phase3b-client-response.test.ts` and
  `tests/rls/phase3a-client-portal.test.ts` both still pass their
  archived-proposal rejection tests.
- **Revoked links remain fully blocked** — `v_link.status = 'revoked'` is
  an entirely separate check, also unaffected.
- **The new statuses only ever let a visitor reach a READ (view the final
  state) or a REJECTED write** (`submit_proposal_client_response()`'s own
  `already_responded` outcome) — there is no path where broadening these
  two functions allows a NEW response to be recorded past the first one;
  that guarantee lives entirely in the unique-constraint mechanism above,
  which this change does not touch at all.

## RLS for the new table

```sql
alter table public.proposal_client_responses enable row level security;

create policy proposal_client_responses_select on public.proposal_client_responses
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'proposals.view'));

grant select on public.proposal_client_responses to authenticated;
```

No new permission key — reusing `proposals.view` (the same reasoning
already applied to `proposal_view_events` in Phase 3A: "can this person
see this proposal" already implies "can they see how it was answered").
No `INSERT`/`UPDATE`/`DELETE` policy at all — the append-only triggers
block mutation outright regardless of role, and the only write path is
`submit_proposal_client_response()`. Verified directly: anon gets zero
rows (not an error), an authenticated user from a different tenant gets
zero rows, and — reconfirmed unaffected by this phase —
`proposal_portal_sessions`/`proposal_portal_otps` remain completely
unreadable by any ordinary tenant member, including the Owner.

## Audit metadata never carries a secret

`log_audit_event()` calls for both `proposal.accepted_by_client` and
`proposal.declined_by_client` pass only
`jsonb_build_object('proposal_version_id', ..., 'portal_link_id', ...)` —
no OTP code, no raw link token, no raw session token, no raw IP/user-agent
(only their hashes are ever persisted, on the `proposal_portal_otps`/
`proposal_view_events` rows those hashes belong to, never copied into
audit metadata at all). Verified directly with a metadata-content
assertion, not just a schema check:
`tests/rls/phase3b-client-response.test.ts`, "the audit metadata never
includes an OTP code, a raw token, or a raw session token."

## What this phase deliberately did NOT touch

Per the brief's explicit "no debilitar" list — confirmed unchanged by
running the full pre-existing Phase 3A/3A.1 RLS and E2E suites alongside
this phase's new ones, all passing: token/OTP/session hashing algorithms,
rate limiting thresholds and logic, the service-role/admin-client
boundary, Storage signed-URL privacy, tenant isolation, and the Proposal
Builder's own RLS/permission model.
