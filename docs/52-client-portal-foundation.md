# 52 — Client Portal Foundation (Phase 3A)

Status: **Implemented**, verified against real Postgres
(`tests/rls/phase3a-client-portal.test.ts`, 46 tests) and end-to-end via
Playwright (`tests/e2e/client-portal.spec.ts` +
`client-portal.mobile.spec.ts`).

> **This phase (3A) was view-only.** A client could see a proposal through
> a secure, email-verified link — nothing more. **Accept/decline shipped in
> Phase 3B** — see
> [docs/56-client-portal-accept-decline.md](56-client-portal-accept-decline.md)
> and [docs/57-client-response-security.md](57-client-response-security.md).
> Questions/comments, PDF, e-signature, Stripe, deposits/payments, and AI
> remain explicitly out of scope; see "Known limitations" below and
> [docs/53-client-portal-security.md](53-client-portal-security.md) for the
> security model.
>
> **Phase 3D** adds email notifications to the contractor's team when a
> client views/accepts/declines a proposal — `portal_get_session_context()`
> now also returns `is_first_view`/`client_email` for this purpose (same
> signature, no validation change) — see
> [docs/62-proposal-email-notifications.md](62-proposal-email-notifications.md)
> and [docs/63-notification-delivery-security.md](63-notification-delivery-security.md).
>
> **Phase 3C** adds a "Print / Save as PDF" export view
> (`/p/[token]/print`) alongside `/p/[token]/view`, reusing
> `portal_get_session_context()` unchanged — see
> [docs/60-proposal-pdf-print-export.md](60-proposal-pdf-print-export.md)
> and [docs/61-export-version-safety.md](61-export-version-safety.md).
>
> **Phase 3B.1** taught the portal-facing functions here
> (`portal_get_link_info`, `portal_request_otp`,
> `portal_get_session_context`) that a link bound to a version a revision
> has since superseded must keep working — see
> [docs/59-proposal-version-history.md](59-proposal-version-history.md),
> "Portal link safety."

## The flow

```text
Contractor marks proposal as ready
  → Contractor creates a portal link (/proposals/[id] → "Client portal")
  → Client opens /p/[token]
  → Client enters their email
  → System sends a one-time code (real provider or dev/test capture — see "Email strategy")
  → Client enters the code at /p/[token]/verify
  → Client views the proposal at /p/[token]/view
```

No Supabase Auth account is ever created for a client — see
[docs/53](53-client-portal-security.md), "No Supabase Auth for clients."

## Data model

Four new tables, none of which touch `proposals.status` (see
[docs/31](31-proposal-state-machines.md), "Client Portal links do NOT
change proposal status"):

```text
proposal_portal_links       -- a shareable, revocable, expiring link
  ├─ token_hash (SHA-256 of the raw token; the raw token is never stored)
  ├─ status: 'active' | 'revoked'
  └─ expires_at, last_viewed_at, revoked_at/revoked_by

proposal_portal_otps        -- one row per requested one-time code
  ├─ code_hash, expires_at, attempt_count/max_attempts, consumed_at
  └─ ip_hash/user_agent_hash (never the raw IP/user-agent)

proposal_portal_sessions    -- created the instant an OTP is verified
  ├─ session_token_hash (the raw token lives only in an httpOnly cookie)
  └─ expires_at, last_seen_at, revoked_at

proposal_view_events        -- append-only "client opened this proposal" log
  └─ one row per portal view, never updated/deleted (same discipline as audit_logs)
```

Every table follows the existing composite-FK cross-tenant-integrity
pattern (ADR 0007): `unique(id, tenant_id)` + composite foreign keys back
to `proposals`/`proposal_versions`/`proposal_portal_links`. Migrations:
`supabase/migrations/20260715100000_client_portal_schema.sql` (tables),
`20260715100100_client_portal_functions.sql` (functions),
`20260715100200_client_portal_rls_and_permissions.sql` (RLS + permission
seed), and a forward fix,
`20260715100300_client_portal_otp_rate_limit_fix.sql` (see
[docs/53](53-client-portal-security.md), "A rate-limit gap found and fixed
during test-writing").

## Functions

**Internal (contractor-facing)** — called with the contractor's own
authenticated session, exactly like every other proposal mutation:

- `create_proposal_portal_link(p_tenant_id, p_proposal_id, p_token_hash, p_expires_at)`
  — only for a `ready` (or, for forward-compatibility, `sent`) proposal, not
  archived, checks `proposal_portal_links.create`.
- `revoke_proposal_portal_link(p_portal_link_id)` — idempotent, checks
  `proposal_portal_links.revoke`.

**Portal-facing (anonymous visitor)** — called exclusively via the
service-role admin client (see [docs/53](53-client-portal-security.md) for
why), each independently re-validating link/OTP/session state:

- `portal_get_link_info(p_token_hash)` — landing-page lookup: valid?
  business name, proposal title, or a specific invalid reason (not_found /
  revoked / expired / unavailable).
- `portal_request_otp(p_token_hash, p_email, p_code_hash, p_expires_at,
  p_ip_hash, p_user_agent_hash)` — rate-limited (see docs/53), matches the
  email against the proposal's client/client_contact email, but ALWAYS
  returns the same generic outcome so the caller never leaks whether an
  email exists.
- `portal_verify_otp(...)` — outcome: `verified` / `invalid_link` /
  `wrong_code` / `expired` / `too_many_attempts`; creates a
  `proposal_portal_sessions` row on success.
- `portal_get_session_context(p_session_token_hash, p_ip_hash,
  p_user_agent_hash)` — re-validates the session AND the underlying
  link/proposal on every single call (a link revoked or a proposal
  archived after a session was created blocks that session immediately),
  records a view event, and — only on that session's first view — logs a
  `proposal_viewed_by_client` CRM activity.

## Contractor-facing UX

The proposal detail page (`/proposals/[proposalId]`) gained a "Client
portal" section, gated on `proposal_portal_links.view`:

- If the proposal isn't `ready` yet: "Mark this proposal ready to create a
  client portal link." (no button shown — avoids relying solely on the
  RPC's own rejection).
- "Create client portal link" — shows the new URL in a read-only,
  select-on-focus input with a Copy button, and its expiration date. **The
  URL is shown exactly once** — refreshing the page never shows it again,
  since the raw token is never stored (see docs/53).
- A table of every link for this proposal: Status (Active / Revoked /
  Expired — the last one computed client-side from `expires_at`, since the
  stored `status` column only ever tracks explicit revocation), Created,
  Expires, Last viewed ("Not yet viewed" until the first real portal view),
  and a Revoke action (confirm dialog, gated on
  `proposal_portal_links.revoke`) for any still-active link.

Permission matrix (`proposal_portal_links.create/.view/.revoke`) — see
[docs/53](53-client-portal-security.md) for the full reasoning:

| Role | create | view | revoke |
|---|---|---|---|
| Owner / Admin / Estimator / Sales | ✅ | ✅ | ✅ |
| Viewer | ❌ | ✅ | ❌ |
| Field Worker | ❌ | ❌ | ❌ |

## Client-facing UX

Three routes, entirely outside the contractor app shell (`src/app/p/`, its
own `layout.tsx` — no sidebar, no topbar, no tenant switcher):

1. **`/p/[token]`** — validates the link; if invalid, shows a specific
   friendly reason ("This link has expired.", "This link has been
   revoked.", "This proposal is no longer available to view.", "We
   couldn't find that link."). If valid: business name + proposal title,
   "This proposal is private and can only be viewed by authorized
   recipients.", an email field ("Enter the email address where you
   received this proposal."), "Send access code."
2. **`/p/[token]/verify?email=...`** — "If `{email}` is authorized, we'll
   send an access code." (identical regardless of whether it actually was —
   see docs/53), a code field ("Enter the 6-digit code we sent to your
   email."), "View proposal", and a "Resend code" action.
3. **`/p/[token]/view`** — validates the session cookie; on success, renders
   the exact same `ProposalDocument` component the internal Preview/Review
   pages use (see [docs/34](34-proposal-builder-ux.md#preview)) — business
   name, proposal number, prepared-for, title, summary, scope,
   measurements, schedule, labor, materials & costs, current-job photos,
   previous-work photos, terms, exclusions, pricing summary, total. No
   builder controls, no internal status, no UUIDs, no storage paths, no
   JSON, no tenant IDs — the component itself guarantees this (see its own
   header comment), so reusing it for the portal costs nothing extra to
   audit.

Photos use signed URLs generated by a portal-specific loader
(`getFullProposalForPortal()`, `src/lib/portal/data.ts`) that calls the
service-role admin client for both the row data AND the Storage signed
URLs (`getSignedMediaUrlsForPortal()`, `src/lib/storage/media.ts`) — a
portal visitor has no Supabase Auth session, so the ordinary
`media.view`-gated Storage policy can never be satisfied by them; the
service-role bypass is safe here specifically because the caller only ever
passes paths already scoped to a tenant/proposal/version that
`portal_get_session_context()` has just authoritatively validated.

## Email strategy

**Updated in Phase 3A.1** — a real provider path now exists. See
[docs/55-client-portal-email-delivery.md](55-client-portal-email-delivery.md)
for the full writeup; summary:

`sendPortalCodeEmail()` (`src/lib/email/portal.ts`) remains the single call
site every OTP request goes through, now dispatching by `EMAIL_PROVIDER`:
`dev` (default — logs server-side and writes a gitignored local capture
file, unchanged from Phase 3A) or `resend` (a real HTTP send via the
Resend API, with a shared HTML+text template). `sendgrid`/`smtp` are
recognized names that throw "not implemented yet" rather than either
working or silently no-op-ing.

A real production deployment can no longer silently fall back to the dev
capture path: `dev` is refused outright whenever `NODE_ENV=production`
unless `EMAIL_ALLOW_DEV_PROVIDER_IN_PRODUCTION="true"` is explicitly set —
a deliberately dangerous-sounding variable that only ever belongs in a
gitignored `.env.local`/CI secret (this repo's own Playwright E2E suite
needs it, since it always runs a production build locally), never a real
deployment's environment.

**Still not acceptable for real customer use without further setup**: no
automated test has exercised a real Resend send (per the brief's
instruction not to call a real email API in CI) — see docs/55, "Known
limitations," for what manual verification is still required before
enabling the Client Portal for real customers.

## Audit & CRM activity

Every portal action is recorded twice, matching this codebase's existing
split between the security-focused `audit_logs` and the business-facing
`crm_activities` (see [docs/20](20-phase-1-crm-and-projects.md), "Notes vs.
activity vs. audit_logs"):

| Event | `audit_logs.action` | `crm_activities.activity_type` |
|---|---|---|
| Link created | `portal_link.created` | `client_portal_link_created` |
| Link revoked | `portal_link.revoked` | `client_portal_link_revoked` |
| Code requested (matched email only) | `portal_otp.requested` | *(none)* |
| Code verified | `portal_otp.verified` | *(none)* |
| Proposal viewed | `proposal.viewed` | `proposal_viewed_by_client` (first view of a session only) |

`proposal_viewed_by_client` is deliberately logged only once per session
(its first view) even though `proposal_view_events` gets a fresh row on
every single open — a client refreshing the tab repeatedly would otherwise
spam the contractor's activity feed. The raw `proposal_view_events` table
is the complete, un-deduplicated audit trail; the CRM activity is the
human-facing summary. Neither is ever shown to the client themselves
(brief: "No exponer eventos al cliente").

## Known limitations

- **A real provider (Resend) is implemented but not manually verified.**
  See [docs/55](55-client-portal-email-delivery.md), "Known limitations" —
  no automated test sends a real email; someone must manually confirm a
  real send before any real customer relies on this feature.
- **No numbered pagination or search of portal links** — a proposal is
  expected to have very few links (typically one active at a time); the
  contractor-facing table shows all of them.
- **No "logout"/explicit session revocation from the portal UI.** A
  session simply expires after 24 hours, or is invalidated the moment its
  link is revoked or its proposal is archived — there is no user-facing
  "sign out" button, since there's nothing sensitive to protect beyond the
  read-only view itself within that session's own lifetime.
- **`total_count`-style exactness isn't relevant here** (unlike
  [docs/51](51-material-catalog-pagination.md)) — no pagination exists in
  this feature at all.
- **No PDF, no e-signature, no payments, no AI, no scraping, no global
  admin catalog UI, no Client Portal branding/logo upload** — all
  explicitly out of scope for this phase, per the brief. (Accept/decline
  itself shipped in Phase 3B — see
  [docs/56](56-client-portal-accept-decline.md).)
