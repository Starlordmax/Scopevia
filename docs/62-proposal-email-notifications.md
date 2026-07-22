# 62 — Email Notifications for Client Portal Events (Phase 3D)

Status: **Implemented and verified** — 16 new unit tests
(`dedupe-key.test.ts`, `internal-url.test.ts`,
`proposal-notification-template.test.ts`), 16 new RLS/integration tests
(`phase3d-notifications.test.ts`), 4 new E2E tests
(`proposal-notifications.spec.ts` + `.mobile.spec.ts`).

> No PDF attachments, no Stripe/payments/deposits, no legal e-signature, no
> retry queue, no notification preferences UI. See "Known limitations."
>
> **Phase 3D.1**: a public Render staging deployment MUST use
> `EMAIL_PROVIDER=resend` — never `dev` — or beta testers never receive a
> real OTP code or notification email. `src/instrumentation.ts` now
> refuses to even start the server if this isn't configured correctly —
> see [docs/64-render-staging-deployment.md](64-render-staging-deployment.md).

## The problem this phase solves

Every prior phase already recorded that a client viewed, accepted, or
declined a proposal — as an `audit_logs` row, a `crm_activities` row, and
(for views) a `proposal_view_events` row. None of that reaches a
contractor unless they happen to open the app and look. This phase closes
that gap: the team gets a real email the moment something happens on a
proposal they're not actively watching.

## Events implemented

| Event | Trigger | Recipients |
|---|---|---|
| Proposal viewed | The client's FIRST view of a session (`portal_get_session_context()`'s `is_first_view`) — a reload never re-notifies | Contractor team |
| Proposal accepted | `submit_proposal_client_response(p_response_type := 'accepted')` succeeds | Contractor team + a short confirmation to the client |
| Proposal declined | `submit_proposal_client_response(p_response_type := 'declined')` succeeds | Contractor team + a short confirmation to the client |

**Deliberately not implemented this phase** (both explicitly marked
"opcional" in the brief, and absent from its own RLS/E2E test list, unlike
the three above): a "portal link created" notification and a "revision
created" notification. Both would be **contractor-initiated** events — the
person who just clicked the button already knows it happened — versus the
three implemented events, which are all **client-initiated** and are
exactly the case where a contractor genuinely isn't watching in real
time. See "Known limitations" for what a future phase would need
(excluding the acting contractor from their own notification, primarily).

## Recipients

`get_proposal_notification_recipients(p_tenant_id)` — active (not
`invited`/`suspended`/`removed`) memberships with role Owner, Admin,
Estimator, or Sales. Viewer and Field Worker are excluded, matching the
brief's explicit recommendation. No notification-preferences table exists
yet (deliberately — see "Known limitations"); every qualifying member
always receives every implemented event.

This is a **new SQL function**, not a TypeScript query against
`auth.users` — that schema isn't exposed through the ordinary Supabase
client at all (PostgREST doesn't expose the `auth` schema), so resolving
member emails needs a `SECURITY DEFINER` function with direct schema
access, the same pattern `invite_member_by_email()` already uses
(`select id from auth.users where email = ...`, Phase 0). Portal-facing
discipline: revoked from `public`/`anon`/`authenticated`, reachable only
via the service-role admin client — every current caller of this function
is itself triggered by a portal visitor action (view/accept/decline), so
there's no contractor-authenticated call path to grant it to yet.

## Where the email actually gets sent

**Not from a SQL trigger.** Per the brief's own instruction, and because
Postgres has no built-in way to make an outbound HTTP call safely from
this project's stack (no `pg_net` or equivalent configured), every send
happens in TypeScript, at the exact point the triggering Server
Action/page load already runs:

- `notifyProposalViewed()` — called from `/p/[token]/view` and
  `/p/[token]/print` page loads, right after `portal_get_session_context()`
  returns `is_first_view: true`.
- `notifyProposalAccepted()` / `notifyProposalDeclined()` — called from
  `acceptProposalAction()`/`declineProposalAction()`
  (`src/actions/portal-visitor.ts`), right after
  `submit_proposal_client_response()` returns `outcome: 'ok'`.

## The two RPC extensions that made this possible without extra queries

Both `portal_get_session_context()` and `submit_proposal_client_response()`
already computed everything a notification needs internally — they just
never returned it. Both were forward-fixed (`DROP FUNCTION` + `CREATE`,
since the return TABLE shape itself changed, not just internal logic —
Postgres disallows `CREATE OR REPLACE` across a return-type change; the
originals were never edited) to also return:

- `portal_get_session_context()`: `is_first_view boolean`, `client_email text`
- `submit_proposal_client_response()`: `tenant_id`, `proposal_id`,
  `proposal_version_id`, `client_email`, `responded_at`

No validation/security logic changed in either function — see
[docs/63](63-notification-delivery-security.md) for why this was safe.

## Email architecture

A brand-new generic sender (`src/lib/email/send.ts`,
`sendEmail({to, subject, text, html})`), deliberately **separate** from
the existing OTP-specific `sendPortalCodeEmail()`
(`src/lib/email/portal.ts`) — the already-battle-tested access-code
delivery path is completely untouched by this phase, down to its own
dev-capture directory (`.portal-otp-dev/`, unchanged) and its own Resend
call. The new generic sender reuses `resolveEmailProvider()` (Phase 3A.1's
pure provider-selection logic, unmodified) and `validateResendConfig()`
unchanged, so it has the exact same production-safety guarantee: `dev` is
refused whenever `NODE_ENV=production` unless
`EMAIL_ALLOW_DEV_PROVIDER_IN_PRODUCTION="true"` is explicitly set.

```text
src/lib/email/
  types.ts                        -- + GenericEmailInput
  send.ts                         -- sendEmail(), configuredEmailProviderName()
  providers/
    dev-generic.ts                -- .notification-emails-dev/ (separate from .portal-otp-dev/)
    resend-generic.ts             -- plain fetch POST, mirrors providers/resend.ts
  templates/
    html-escape.ts                -- shared escapeHtml(), extracted from portal-code.ts
    proposal-notification.ts      -- viewed / accepted / declined / two client confirmations

src/lib/notifications/
  internal-url.ts                 -- buildInternalProposalUrl(APP_BASE_URL, proposalId)
  dedupe-key.ts                   -- buildDedupeKey(), sanitizeErrorForStorage()
  proposals.ts                    -- notifyProposalViewed/Accepted/Declined()
```

## Dev/test capture

`EMAIL_PROVIDER=dev` (the default) writes to `.notification-emails-dev/`
— one gitignored file per recipient (SHA-256 of the lowercased email),
containing an **appended array** of every notification sent to that
address (not a single overwritten file like the OTP capture: a contractor
can legitimately receive several different notifications over time for
the same email — viewed, then later accepted — and tests need to find a
specific one by subject). `tests/e2e/fixtures/notifications.ts` provides
`getCapturedNotification(email, subjectContains)` (polls, like the OTP
fixture) and `getAllCapturedNotifications(email)` (for asserting a count).

## APP_BASE_URL

A new, server-only (deliberately **not** `NEXT_PUBLIC_`-prefixed) env var,
used only to build the "Open in Scopevia" / "View in Scopevia" link inside
a notification email (`buildInternalProposalUrl()`,
`src/lib/notifications/internal-url.ts`). If unset, the notification is
still sent — just without that link, never blocked. Never falls back to a
hardcoded `localhost` URL. Added to `.env.example` and this repo's own
`.env.local`.

## Why synchronous, not `after()`

Next.js 16 (this project's version) has `after()` for scheduling work to
run once the response has been sent, without adding latency to it — the
obvious tool for "don't make the client wait for an email." It was
deliberately **not** used here: `after()` callbacks run on the server
*after* Playwright's `page.goto()`/action call has already resolved on the
client side, which would make every E2E assertion on captured
notifications race against a callback whose completion the test has no
way to await. Given this phase explicitly requires reliable E2E
verification of notification delivery, synchronous (awaited) dispatch was
chosen over a small amount of extra request latency — a defensible
trade for now, revisited if a future phase adds a real background job
queue (see "Known limitations").

## Delivery safety

Every exported function in `src/lib/notifications/proposals.ts` is
wrapped so it **never throws**: a failure resolving recipients, inserting
a delivery row, or sending the email itself is caught, logged
server-side, and (for a send failure specifically) recorded as
`status='failed'` with a sanitized `error_code` — it never reverts the
accept/decline that triggered it, never blocks the client's own flow, and
never surfaces a raw provider error to anyone. See
[docs/63](63-notification-delivery-security.md) for the full security
review, including exactly what `error_code` is (and is never allowed to
contain).

## Contractor-facing UX

One line added to the existing "Client portal" panel on the proposal
detail page: *"Notifications are sent to your team when clients view or
respond."* No Notification Center, no preferences UI — deliberately out
of scope (see "Known limitations").

## Known limitations

- **No notification preferences.** Every active Owner/Admin/Estimator/
  Sales member always receives every implemented event; there is no way
  to opt out or customize per-user. The brief's own "simple option" is
  exactly what's implemented.
- **No retry queue.** A failed send is recorded (`status='failed'`,
  `error_code`) but never automatically retried. A future phase would need
  a real background job runner to revisit `status='failed'` rows.
- **No "portal link created" or "revision created" notifications.** Both
  explicitly optional in the brief; deferred because they're
  contractor-initiated (the actor already knows), unlike the three
  implemented client-initiated events. Adding them would mean extending
  `notifyTeam()` to exclude the acting user's own email from the
  recipient list — not yet built.
- **No PDF attachment.** A notification links back into Scopevia
  ([docs/60](60-proposal-pdf-print-export.md) covers exporting the
  proposal itself); it never attaches a file.
- **No real Resend send exercised in any automated test** — every
  unit/RLS/E2E test runs with `EMAIL_PROVIDER=dev`. A real send must be
  verified manually before enabling this for real customers (same
  standing caveat as [docs/55](55-client-portal-email-delivery.md)).
- **Dispatch is synchronous**, adding the provider's latency to the
  triggering page load/Server Action — see "Why synchronous, not
  `after()`" above.
