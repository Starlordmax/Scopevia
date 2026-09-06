# 63 — Notification Delivery Security Model (Phase 3D)

Status: **Implemented and verified** — 16/16 RLS/integration tests. See
[docs/62](62-proposal-email-notifications.md) for the feature itself; this
document covers the security model specifically, extending
[docs/53](53-client-portal-security.md) rather than repeating it.

## Nothing about the portal trust model changes

Every event this phase notifies on is triggered by code that already
independently validated everything it needed, long before this phase
existed: `portal_get_session_context()` and
`submit_proposal_client_response()` re-check the session/link/proposal on
every call (Phase 3A/3B/3B.1). This phase adds **read-only** consumption of
those already-validated results — it introduces zero new trust decisions,
zero new places a portal visitor's input is trusted, and zero new ways to
reach a proposal's data.

**The client never supplies a `tenant_id`, `proposal_id`,
`proposal_version_id`, or recipient list.** Every value the notification
module uses is either read back from a function that already resolved it
authoritatively (the two RPC extensions — see docs/62) or derived
server-side from the tenant id those functions returned
(`get_proposal_notification_recipients()`).

## `get_proposal_notification_recipients()`

`SECURITY DEFINER`, `stable`, revoked from `public`/`anon`/`authenticated`
— reachable only via the service-role admin client, the same discipline
every `portal_*()` function has followed since Phase 3A. Queries
`auth.users` directly (safe specifically because it's `SECURITY DEFINER`
— see [docs/62](62-proposal-email-notifications.md), "Recipients," for why
this needs direct schema access rather than PostgREST). Takes a single
`p_tenant_id` parameter and returns only that tenant's active
Owner/Admin/Estimator/Sales members — verified directly
(`tests/rls/phase3d-notifications.test.ts`, "never includes a different
tenant's members," "Tenant B's recipient list is exactly its own owner").

## Why two existing RPCs' return shapes changed, and why that was safe

`portal_get_session_context()` and `submit_proposal_client_response()`
both now return a few more fields (see
[docs/62](62-proposal-email-notifications.md)) — **every added field was
already being computed and used internally**; nothing new is derived, and
no `if`/validation branch inside either function was touched. The two
migrations that made this change
(`20260722100100_proposal_notification_functions.sql`) are line-for-line
identical to the prior versions except for the `returns table (...)`
signature and the final `return query select ...` statements gaining the
new columns. This is verified directly:

- `tests/rls/phase3d-notifications.test.ts`, "is_first_view is true on the
  first call and false on a subsequent call" — the exact same
  once-per-session semantics Phase 3A originally implemented, now just
  visible to the caller.
- The same file, "an invalid session returns null for the new fields
  too" — an attacker (or a stale/tampered session cookie) gets exactly the
  same `invalid_session` outcome as before, with the new fields simply
  null rather than leaking a partial result.
- The same file, "an already_responded outcome returns null context" —
  a duplicate/racing response attempt never gets back a real
  tenant/proposal/version id to build a spurious second notification from.

## Data model: `proposal_notification_deliveries`

`RLS enabled`, exactly one `SELECT` policy, gated on `audit.view` (the
same permission that already gates the security-focused `audit_logs`
view — Owner/Admin only, not Estimator/Sales/Viewer/Field Worker, even
though Estimator/Sales CAN be notification *recipients*; being emailed and
being authorized to read the delivery *log* are different things, exactly
like `audit_logs` itself). **No `INSERT`/`UPDATE`/`DELETE` policy exists
at all** — every write happens exclusively through the service-role admin
client from `src/lib/notifications/proposals.ts`, which bypasses RLS
entirely. Verified directly: "an ordinary authenticated client cannot
INSERT a delivery row directly," "anon cannot read," "Tenant B cannot see
Tenant A's delivery rows," "Owner (has audit.view) can read their own
tenant's delivery rows."

**No client portal (anonymous visitor) access of any kind** — a portal
visitor has no Supabase Auth session at all (see
[docs/53](53-client-portal-security.md)), so their only possible read path
is the `anon` key, already covered by the "anon cannot read" test above.

## The dedupe key IS the security/correctness guarantee, not a courtesy

`unique (dedupe_key)` on `proposal_notification_deliveries` is the entire
duplicate-email defense — not a "best effort," a hard database constraint.
`buildDedupeKey(eventType, proposalVersionId, recipientEmail)`
(`src/lib/notifications/dedupe-key.ts`) is deterministic and
case/whitespace-normalized, so:

- A client reloading `/p/[token]/view` mid-session can never trigger a
  second "viewed" email, even under a genuine race (two near-simultaneous
  requests both computing `is_first_view = true` before either's session
  update commits) — whichever insert wins, the second hits `23505`
  (`unique_violation`) and is silently skipped. Verified directly: "a
  second insert with the same dedupe_key fails."
- A revision (Phase 3B.1) creates a fresh `proposal_version_id`, which is
  itself part of the dedupe key — so a revised version's own first view/
  response gets its own, independent notification, never suppressed by an
  earlier version's history. Verified: "differs across versions for the
  same event/recipient."

## What `error_code` is (and is not)

`proposal_notification_deliveries.error_code` (capped at 200 characters,
`sanitizeErrorForStorage()`) only ever receives the `.message` of an error
already raised by this codebase's own controlled email code —
`resolveEmailProvider()`'s rejection strings, `validateResendConfig()`'s
"missing X" message, or `sendViaResendGeneric()`'s
`HTTP status ${response.status}` message. **None of these ever include an
API key, a raw provider response body, a stack trace, or any portal
secret** — confirmed by inspection of every throw site in
`src/lib/email/*` (unchanged from Phase 3A.1's own equivalent guarantee
for the OTP path — see [docs/55](55-client-portal-email-delivery.md)).
`sanitizeErrorForStorage()` itself is defense in depth on top of that —
collapsing whitespace and capping length — so the column stays safe even
if a future error source is less disciplined, without needing to trust
every current and future caller to already behave.

## Delivery failure never blocks the client

Every exported function in `src/lib/notifications/proposals.ts` wraps its
entire body in a `try/catch` that only logs and returns — never rethrows.
This means:

- A misconfigured `RESEND_API_KEY` in production fails every notification
  send, but a client's accept/decline is still recorded successfully (the
  RPC call and its result are entirely independent of the notification
  call that follows it — see `acceptProposalAction()`/
  `declineProposalAction()`, `src/actions/portal-visitor.ts`).
- A client viewing their proposal never sees a broken page even if
  `notifyProposalViewed()` fails for any reason — the page's own render
  doesn't depend on the notification call's outcome.

## Known limitations

Everything in [docs/62](62-proposal-email-notifications.md)'s "Known
limitations" applies here too. Nothing security-relevant is deferred by
this phase — the guarantees above (tenant isolation, dedupe, no secret
leakage, no client-supplied trust) are fully implemented and tested, not
partial.
