# 56 — Client Portal Accept/Decline (Phase 3B)

Status: **Implemented**, verified against real Postgres
(`tests/rls/phase3b-client-response.test.ts`, 28 tests) and end-to-end via
Playwright (`tests/e2e/client-portal-response.spec.ts` +
`client-portal-response.mobile.spec.ts`).

> **This is a basic approval, not legal e-signature.** A typed name and a
> confirmation checkbox, recorded with a timestamp and hashed IP/user-agent
> for the record — nothing cryptographically binding, no certificate, no
> witness. PDF, Stripe/payments/deposits, and questions/comments remain
> explicitly out of scope; see "Known limitations."
>
> **Phase 3B.1 adds the revision flow this phase deliberately left out**
> ("No revision flow" below) — see
> [docs/58-proposal-revision-flow.md](58-proposal-revision-flow.md) and
> [docs/59-proposal-version-history.md](59-proposal-version-history.md).
>
> **Phase 3C adds a "Print / Save as PDF" export**, on the Client Portal
> view, which includes the client's accepted/declined response when there
> is one — see
> [docs/60-proposal-pdf-print-export.md](60-proposal-pdf-print-export.md).
>
> **Phase 3D adds email notifications** — the contractor's team is emailed
> the moment a client accepts or declines (not just an in-app "Client
> response" card), and the client themselves gets a short confirmation —
> see
> [docs/62-proposal-email-notifications.md](62-proposal-email-notifications.md).

## The flow

```text
Client views the proposal at /p/[token]/view (Phase 3A)
  → "Ready to move forward?" section, below the document
  → Client clicks "Accept proposal" or "Decline"
  → Accept: enters their name, checks a confirmation box, confirms in a dialog
  → Decline: optionally enters a reason, confirms in a dialog
  → submit_proposal_client_response() records the decision, locks the
    version, sets proposals.status
  → Client sees a final "Proposal accepted" / "Proposal declined" state
  → Contractor sees the same, immediately, on the proposal detail page
```

## Data model

One new table, `proposal_client_responses` — a single row per
`proposal_version_id`, ever:

```text
proposal_client_responses
  ├─ proposal_id, proposal_version_id, portal_link_id, portal_session_id
  ├─ client_email, client_name (required for accepted, null for declined)
  ├─ response_type: 'accepted' | 'declined'
  ├─ decline_reason (nullable, declined only)
  ├─ accepted_terms (must be true for accepted, per a CHECK constraint)
  ├─ responded_at, ip_hash, user_agent_hash
  └─ unique (proposal_version_id)  -- the entire duplicate-response guard
```

`unique (proposal_version_id)` is the whole mechanism — see
[docs/57-client-response-security.md](57-client-response-security.md) for
why this single constraint is sufficient for every "no conflicting
response" rule in the brief. Append-only (trigger-enforced, same as
`audit_logs`/`crm_activities`/`proposal_view_events`) — a client's decision
is a historical record, never edited or deleted. Migration:
`supabase/migrations/20260718100000_proposal_client_responses_schema.sql`.

## State transitions

`proposals.status` already had `'accepted'`/`'declined'` in its CHECK
constraint since Phase 2A — reserved, never reachable by any function
until now (see [docs/31](31-proposal-state-machines.md)). This phase is
the first to actually set them:

| From | To | Function | Actor |
|---|---|---|---|
| `ready` (or `sent`) | `accepted` | `submit_proposal_client_response(p_response_type := 'accepted')` | The client, via a verified portal session |
| `ready` (or `sent`) | `declined` | `submit_proposal_client_response(p_response_type := 'declined')` | The client, via a verified portal session |

**No `viewed` transition was added.** The brief offered this as optional
("Client view puede marcar viewed, si el modelo ya lo soporta") — Phase 3A
already records every view as a `proposal_view_events` row and a
`proposal_viewed_by_client` CRM activity, which serves the same
"contractor knows the client looked at it" purpose without consuming
another reserved status value ahead of a future phase that might want it
for something more specific (e.g. distinguishing "opened" from "actually
read"). Evaluated and deliberately not adopted, the same "don't add a
status with no real need yet" discipline `docs/31` already applied to
`sent`/`viewed` in Phase 2A.

**The responded-to version is locked** (`version_status = 'locked'`,
`locked_at = now()`) as part of the same transaction — this is the FIRST
real-usage exercise of the locking mechanism that has existed since Phase
2A (`prevent_locked_proposal_version_mutation()` /
`prevent_locked_version_child_mutation()`), previously only exercised via
"admin/test functions." A locked version's line items, labor, sections,
media, and measurements all become immutable — verified directly
(`tests/rls/phase3b-client-response.test.ts`, "Locked version immutability
after a response").

**No accept-after-decline or decline-after-accept, ever, for that
version.** `submit_proposal_client_response()` checks
`proposals.status in ('accepted', 'declined')` up front (a fast, honest
"already_responded" outcome) and the table's `unique(proposal_version_id)`
constraint is the hard backstop underneath that check, closing any race.
Revising a declined or accepted proposal requires a **new** proposal
version — not implemented in this phase (see "Known limitations").

## Portal UX

`PortalResponseSection` (`src/app/p/[token]/view/portal-response-section.tsx`),
rendered directly below the `ProposalDocument` on `/p/[token]/view`:

- **No response yet**: "Ready to move forward?" + two buttons, "Accept
  proposal" and "Decline." Clicking either reveals its own form:
  - **Accept**: a required name field, a required confirmation checkbox
    ("I confirm that I have reviewed this proposal and approve the scope
    and pricing shown above."), a native-`confirm()` guarded submit button
    (`ConfirmSubmitButton`, the same component the contractor app already
    uses for delete/revoke actions), and Cancel.
  - **Decline**: an optional reason textarea, the same confirm-guarded
    submit pattern, and Cancel.
- **A response already exists** (fresh page load, or a reload after
  responding): "Proposal accepted" / "Proposal declined" with the brief's
  exact copy — no buttons, no form, nothing actionable. The decline reason
  is **not** echoed back to the client here — it's for the contractor only.

A visitor without an existing session (a different device, or a lapsed
cookie) can still reach this final state: `/p/[token]` and the OTP request
step both had to be broadened alongside `/view` — see "A gap found by
E2E testing" below.

## Contractor UX

The proposal detail page (`/proposals/[proposalId]`) gained a "Client
response" card, positioned immediately after the status/metrics card —
deliberately prominent, per the brief's "no esconder en sección difícil de
encontrar":

- Accepted: a green "Accepted" badge, "by {name} ({email})", timestamp.
- Declined: a red "Declined" badge, "by {email}", "Reason: {reason}" (only
  if one was given), timestamp.

Three follow-on UX corrections, all direct consequences of a proposal
being locked/responded-to that would otherwise mislead the contractor:

1. **"Continue editing" is hidden** once `status` is `accepted`/`declined`
   (previously only hidden for `archived`) — clicking it would otherwise
   land the contractor in a builder where every save silently fails
   against the now-locked version.
2. **The "Client portal" panel's "Mark this proposal ready..." hint no
   longer shows** once responded-to — found via screenshot review (see
   docs/54-style verification below): the panel's `isReady` check alone
   made this hint appear for a proposal that will never need to become
   "ready" again in the ordinary sense, since it already went further.
3. Existing portal links remain listed (status/expiry/last-viewed/Revoke)
   even after a response — a contractor may still want to revoke a link
   for a proposal that's already been decided.

`proposalBadgeClass()` (`src/lib/crm/status-badge.ts`) already mapped
`'accepted'` → green and `'declined'` → red since Phase 2A (reserved,
unused) — no change needed there, confirmed by a new unit test.

## Audit & CRM activity

| Event | `audit_logs.action` | `crm_activities.activity_type` |
|---|---|---|
| Accepted | `proposal.accepted_by_client` | `proposal_accepted_by_client` |
| Declined | `proposal.declined_by_client` | `proposal_declined_by_client` |

Metadata is deliberately minimal (`proposal_version_id`, `portal_link_id`)
— never an OTP code, a raw link/session token, or a raw IP — verified
directly (`tests/rls/phase3b-client-response.test.ts`, "the audit metadata
never includes an OTP code, a raw token, or a raw session token"). Along
the way, this phase also filled in three Phase 3A activity types that had
never been given explicit `describeActivity()` cases
(`client_portal_link_created/_revoked`, `proposal_viewed_by_client`) — they
were already falling through to a reasonable capitalized default, now
explicit for consistency.

## A gap found by E2E testing: post-response portal access

The first implementation only broadened `portal_get_session_context()`
(the function `/view` calls) to accept `accepted`/`declined` proposals —
reasoning that an EXISTING session, once granted, should keep working.
That reasoning was incomplete: `portal_get_link_info()` (the `/p/[token]`
landing page) and `portal_request_otp()` (requesting a code) were left
gating on `status in ('ready', 'sent')` only, so a visitor **without** an
already-valid session cookie — a different device/browser, or simply a
cookie that expired — could no longer even reach the OTP step for an
already-answered proposal. The landing page silently became "This proposal
is no longer available to view," never reaching the brief's required "This
proposal has already received a response" experience at all.

Caught by `tests/e2e/client-portal-response.spec.ts`'s duplicate-response
scenario timing out waiting for a landing-page email field that no longer
existed. Fixed in a forward migration,
`20260718100300_client_portal_post_response_access_fix.sql` (originals
never edited): both functions now accept `ready`/`sent`/`accepted`/`declined`,
matching `portal_get_session_context()` exactly. See
[docs/57](57-client-response-security.md) for the security implications
(none — archived-proposal and revoked-link checks are unaffected, since
`archived_at is not null` is checked independently via `or`, not folded
into the status list).

## Known limitations

- **Not legal e-signature.** A typed name + checkbox + timestamp is a
  basic approval record, not a cryptographically binding signature, no
  certificate, no biometric/handwritten capture, no third-party
  attestation service (e.g. DocuSign-equivalent). Explicitly out of scope
  per the brief.
- ~~**No revision flow.**~~ **Resolved in Phase 3B.1** — see
  [docs/58-proposal-revision-flow.md](58-proposal-revision-flow.md). A
  declined/accepted proposal's version is still locked forever, exactly as
  documented here, but the contractor can now create a new draft version
  from it (`create_proposal_revision()`) and send a new portal link,
  without touching the original locked version or its response.
- **No contractor email notification.** The brief explicitly defers this
  ("Notify contractor when proposal is accepted/declined" is documented
  for a future phase, not built now) — the contractor learns of a response
  only by checking Scopevia (the activity feed, the dashboard, or the
  proposal detail page itself), not via an email/push alert.
- **No client confirmation email.** Same deferral — the client sees the
  confirmation on-screen only, no follow-up email copy of their decision.
- **No PDF, Stripe, payments, or deposits** — all explicitly out of scope.
- **No questions/comments channel** between client and contractor within
  the portal — deferred.
