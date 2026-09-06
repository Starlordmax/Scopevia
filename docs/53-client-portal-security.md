# 53 — Client Portal Security Model (Phase 3A)

Status: **Implemented and verified** — see
[docs/54-client-portal-e2e-verification.md](54-client-portal-e2e-verification.md)
for real test-run evidence, including two real bugs found and fixed during
verification (below).

> **Phase 3B (accept/decline) extends this document rather than
> replacing it** — see
> [docs/57-client-response-security.md](57-client-response-security.md)
> for the `proposal_client_responses` table, the duplicate-response
> guard, version locking, and a real post-response access gap found by
> E2E testing. Everything below is unchanged and still accurate.
>
> **Phase 3D.2 adds one more admin-client signed-URL case** — the
> business logo shown on the portal, signed the same way portal photos
> already were (Phase 2A/3A's `getSignedMediaUrlsForPortal()` pattern,
> now mirrored by `getSignedBrandingUrlForPortal()`), safe for the same
> reason: the visitor never chooses which tenant's asset gets signed —
> `portal_get_session_context()` already resolved that. See
> [docs/70-logo-storage-security.md](70-logo-storage-security.md).
>
> **Phase 3D (email notifications) extends the trust model to zero new
> decisions** — see
> [docs/63-notification-delivery-security.md](63-notification-delivery-security.md):
> every notification is built entirely from data two already-hardened
> functions (`portal_get_session_context()`,
> `submit_proposal_client_response()`) had already validated.

## Why a portal visitor breaks every existing assumption

Every security mechanism in this codebase up to this phase — RLS policies,
`user_has_permission()`, `SECURITY DEFINER` functions that call `auth.uid()`
— assumes the caller is an authenticated Supabase user with a real session.
A client portal visitor is not: they never sign up, never get a Supabase
Auth account, never hold a JWT. `docs/17-rls-verification.md` and every
phase since have built on "RLS + `auth.uid()`" as the security boundary;
Phase 3A is the first time that assumption doesn't hold, and the whole
design here exists to answer "how do we stay just as safe without it."

## No Supabase Auth for clients — by design

The brief is explicit about this ("No usar Supabase Auth para clientes
externos en esta fase. No crear usuarios internos para clientes."), and
it's the right call independent of the instruction: creating a real
Supabase Auth user per client would mean password resets, email
verification flows, and a permission system designed entirely around
*tenant members*, none of which fit "a client should be able to view
exactly one proposal, for a limited time, after proving they control one
specific email address." Three custom, hash-based secrets do that job
instead:

| Secret | Lives in | Table | Lifetime |
|---|---|---|---|
| Link token | The `/p/[token]` URL | `proposal_portal_links.token_hash` | Until expiry or revocation (default 14 days) |
| OTP code | Emailed to the client | `proposal_portal_otps.code_hash` | 10 minutes, max 5 attempts |
| Session token | An httpOnly cookie | `proposal_portal_sessions.session_token_hash` | 24 hours, or until its link is revoked / proposal archived |

## Token/OTP/session generation and hashing

All three secrets are generated in TypeScript
(`src/lib/portal/tokens.ts`), not SQL:

```ts
generatePortalLinkToken()    // randomBytes(32).toString("base64url") -- 256 bits
generatePortalOtpCode()      // randomInt(0, 1_000_000), zero-padded to 6 digits
generatePortalSessionToken() // randomBytes(32).toString("base64url") -- 256 bits
hashPortalSecret(raw)        // createHash("sha256").update(raw).digest("hex")
```

**The raw secret is never sent to Postgres, in any form, ever** — only
`hashPortalSecret(raw)`'s output. This is a deliberate choice over hashing
inside a SQL function (which Postgres's `pgcrypto` extension, already
enabled, could do): generating and hashing in the same process that will
hand the raw value to the caller means the plaintext secret never appears
in a SQL query string, a query plan, or a database log line — a strictly
smaller trust surface than "hash it after it arrives."

Every table storing one of these hashes has RLS enabled with either a
narrow read policy (`proposal_portal_links`, `proposal_view_events` — see
"RLS for the four new tables" below) or **zero policies at all**
(`proposal_portal_otps`, `proposal_portal_sessions`) — nobody, not even the
tenant's own Owner, can `SELECT` these two tables through the ordinary
client; they exist purely for the portal backend's own bookkeeping.

## Why the service-role admin client, and why it's safe here

The brief's recommended approach (section 12) is exactly what's
implemented: *"Usar server-side admin/service role solo en funciones
encapsuladas. Validar portal token/session manualmente. Nunca exponer
service role. Nunca confiar en parámetros del cliente."*

Every portal-facing function (`portal_get_link_info`, `portal_request_otp`,
`portal_verify_otp`, `portal_get_session_context`) is called **exclusively**
from a small, fixed set of Server Actions and Server Components under
`src/app/p/[token]/**` and `src/actions/portal-visitor.ts`, always via
`createAdminClient()` (`src/lib/supabase/admin.ts` — the service-role
client, previously reserved-but-unused everywhere else in this codebase).
This is safe specifically because:

1. **The service-role key never reaches the browser** — `admin.ts` has
   `import "server-only"`, so any accidental import from a Client Component
   fails the build (same guarantee already relied on everywhere else in
   this codebase).
2. **Every function independently re-validates everything it needs** — link
   status, OTP expiry/attempts/consumption, session status, and (fresh, on
   every call) the underlying proposal's archived/status state — rather
   than trusting that a previous check still holds. A link revoked or a
   proposal archived *after* a session was created is caught on the very
   next `portal_get_session_context()` call, not just at session-creation
   time (verified directly — see docs/54).
3. **These four functions are explicitly revoked from `anon` and
   `authenticated`** (`revoke execute on function ... from public, anon,
   authenticated;`) — confirmed empirically that `service_role` can still
   call them (Postgres's default per-function `EXECUTE` grant to `PUBLIC`
   is what gets revoked; Supabase provisions `service_role` with its own
   broad default privileges on the `public` schema, independent of that
   grant, which is also why every `service_role`-driven RLS test in this
   codebase already works this way for raw table access).
4. **Nothing here trusts a client-supplied tenant/proposal id.** Every
   portal-facing function's *only* client-supplied identifiers are opaque
   hashes (`p_token_hash`, `p_session_token_hash`) — `tenant_id`/
   `proposal_id`/`proposal_version_id` are always derived by the function
   itself from the row that hash resolves to, never accepted as a
   parameter. The one place a `tenant_id`/`proposal_id` pair IS passed in
   (`create_proposal_portal_link`) comes from the **contractor's own
   authenticated session**, checked against `user_has_permission()` exactly
   like every other mutation in this codebase — no portal-anonymous code
   path ever supplies one.

## RLS for the four new tables

```sql
-- proposal_portal_links: tenant members can see their own links (harmless
-- -- token_hash is a one-way digest, the raw token is never stored).
create policy proposal_portal_links_select on public.proposal_portal_links
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'proposal_portal_links.view'));

-- proposal_portal_otps / proposal_portal_sessions: RLS enabled, ZERO
-- policies -- reachable only via the four SECURITY DEFINER functions
-- above, called only through the service-role admin client.

-- proposal_view_events: tenant members with proposals.view can see when
-- their proposal was viewed (no new permission needed).
create policy proposal_view_events_select on public.proposal_view_events
  for select to authenticated
  using (public.user_has_permission(tenant_id, 'proposals.view'));
```

No `INSERT`/`UPDATE`/`DELETE` policy exists on any of the four tables —
every mutation goes exclusively through the six `SECURITY DEFINER`
functions, the same "RLS is read-only, writes are function-gated"
discipline this codebase has followed since Phase 0.

## Rate limiting

Implemented in Postgres, no Redis (per the brief: "No necesita Redis
todavía si puedes usar Postgres"), inside `portal_request_otp()`:

- **Per link**: max 8 OTP requests in a rolling 15-minute window (defends
  against enumerating many different emails against one link).
- **Per link + email**: max 3 requests in the same window (defends against
  spamming one recipient).
- **Per code**: max 5 verification attempts (`proposal_portal_otps.
  max_attempts`), enforced with `select ... for update` row locking inside
  `portal_verify_otp()` so concurrent verify attempts against the same code
  can never race past the limit.

Both request-side counts are deliberately based on `count(*) from
proposal_portal_otps where portal_link_id = ...`, which only works if a row
is inserted for **every** request — see the next section.

## A rate-limit gap found and fixed during test-writing

While writing the RLS test suite (`tests/rls/phase3a-client-portal.test.ts`),
a real design flaw surfaced before it ever reached the E2E stage: the first
version of `portal_request_otp()` only inserted a `proposal_portal_otps`
row when the submitted email actually **matched** the proposal's client/
contact email. Since both rate limits above count existing rows, an
attacker submitting a *wrong* email repeatedly — exactly the "enumerate
emails against one link" scenario the per-link limit exists to catch —
produced zero rows and was **never throttled at all**.

Fixed in a forward migration,
`20260715100300_client_portal_otp_rate_limit_fix.sql` (the original,
already-applied migration was never edited): `portal_request_otp()` now
always inserts a row, matched or not — an unmatched row's `code_hash` is
simply never emailed to anyone (`requestPortalOtpAction` only calls
`sendPortalCodeEmail()` when `email_matched` is true), so it can never be
used to pass `portal_verify_otp()` regardless of whether the row exists.
The caller-visible outcome (`'ok'` either way) and the "no revelar si el
email existe" guarantee are unchanged — only the *internal* rate-limit
counting became correct. Verified directly: `tests/rls/
phase3a-client-portal.test.ts`, "rate limits after 8 requests for the same
link within the window, even across different (including wrong) emails."

## No enumeration leak

`portal_request_otp()` always returns the same `'ok'` outcome whether or
not the submitted email matched, and the browser always sees the identical
copy either way ("If `{email}` is authorized, we'll send an access code.")
— `email_matched` is returned to the TypeScript caller purely so it can
decide whether to actually call `sendPortalCodeEmail()`, never surfaced in
the HTTP response. Verified end-to-end: `tests/e2e/client-portal.spec.ts`,
"an email that doesn't match the proposal's client shows the same generic
message and never captures a code."

The only outcomes that ARE distinguishable to a visitor are `invalid_link`
and `rate_limited` — neither leaks anything about email addresses, only
about the link/request itself, which is not the property the brief asks to
protect.

**Phase 3A.1 extends this to email provider failures.** A real send
failure (the Resend API returning a non-2xx, a network error) for a
*matched* email is caught in `requestPortalOtpAction()`
(`src/actions/portal-visitor.ts`) and swallowed — logged server-side only,
never surfaced as a distinct browser-visible outcome. Surfacing it would
have reintroduced exactly the leak this section describes: "this email got
a delivery-failure error" is itself a signal that the email was
authorized, which "no revelar si el email existe" forbids just as much as
a direct "email not found" message would be. See
[docs/55-client-portal-email-delivery.md](55-client-portal-email-delivery.md)
for the full email provider writeup.

## Cookies

The session cookie is httpOnly, `sameSite=lax`, `secure` in production
(matching `activeTenantCookieOptions()`'s existing convention in
`src/lib/auth/tenant.ts`), and — a Phase-3A-specific addition — **scoped to
`/p/<token>`**, not `/`. Its *name* is also namespaced per link
(`scopevia_portal_session_<first-32-hex-chars-of-token-hash>`,
`portalSessionCookieName()` in `src/lib/portal/tokens.ts`), so a visitor
with several portal links open in different tabs gets independent cookies
that can never clobber each other, and a session cookie is only ever looked
up under the exact token it was issued for.

## Storage / signed URLs

A portal visitor has no Supabase Auth session, so the ordinary
`scopevia_media_select` Storage RLS policy (`to authenticated`, gated on
`media.view`) can never be satisfied by them. `getSignedMediaUrlsForPortal()`
(`src/lib/storage/media.ts`) uses the admin client instead — safe here
specifically because its only caller (`getFullProposalForPortal()`,
`src/lib/portal/data.ts`) only ever passes storage paths already scoped to
a tenant/proposal/version that `portal_get_session_context()` has just
authoritatively validated, never a path chosen by the visitor. No public
URLs are generated (unchanged from the pre-existing convention); URLs are
short-lived (5 minutes, matching every other signed-URL call site) and
regenerated fresh on every `/p/[token]/view` render.

## Tenant isolation under the portal model

Verified directly (`tests/rls/phase3a-client-portal.test.ts`, "Cross-tenant
isolation"): a session created via Tenant A's link never resolves to
Tenant B's `tenant_id`/`proposal_id`, regardless of what any other tenant's
concurrent portal activity looks like — every id returned by
`portal_get_session_context()` is derived strictly from the session's own
`portal_link_id` chain, never from any ambient/global state.
