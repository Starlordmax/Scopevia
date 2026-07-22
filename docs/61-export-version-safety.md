# 61 — Export Version Safety & Security Model (Phase 3C)

Status: **Implemented and verified** — 11/11 RLS/integration tests
(`tests/rls/phase3c-proposal-export.test.ts`), 6/6 new E2E scenarios
including a dedicated old-link/new-link revision-safety test. Extends
[docs/60](60-proposal-pdf-print-export.md) (the feature itself) and
[docs/58](58-proposal-revision-flow.md)/[docs/59](59-proposal-version-history.md)
(the revision flow this phase must stay safe across).

## The core guarantee

**An export always shows the exact `proposal_version` it's bound to — never
"whatever is current right now."** This matters specifically because of
revisions (Phase 3B.1): the instant a contractor creates a revision, the
proposal's *current* version changes, but every existing portal link (and
every historical-version export the contractor opens) must keep showing
what it always showed. Getting this wrong would mean a client re-opening
an old email/bookmark link, printing it, and getting a document that
silently doesn't match what they actually saw or responded to — a much
worse failure than the feature not existing at all.

## Why this required zero new SQL

Phase 3C introduces **no new database functions, no new tables, no new RLS
policies.** Both export routes are thin presentation-layer additions on
top of already-hardened data access:

- **Portal export** (`/p/[token]/print`) calls `portal_get_session_context()`
  — the exact same function `/view` calls, completely unmodified. Phase
  3B.1 already taught this function (and `portal_get_link_info()`/
  `portal_request_otp()`) to resolve a link's *bound* version correctly
  even after that version has been superseded by a revision — see
  [docs/59](59-proposal-version-history.md), "Portal link safety." The
  export route inherits that fix automatically, for free, by construction
  — there was nothing new to get right.
- **Contractor export** (`/proposals/[id]/print`) calls `getFullProposal()`
  — the same Phase 2A data loader every proposal page already uses,
  extended with one optional parameter.

## The one real addition: `getFullProposal(tenantId, proposalId, versionId?)`

`versionId` is optional and defaults to the proposal's current version
(unchanged behavior for every existing caller — the builder, `/preview`,
the detail page). When supplied — the Version History table's "Print"
links, and `/proposals/[id]/print?version=<id>` — it's validated the same
way every other id-taking function in this codebase validates a
client-supplied identifier: **never trust it alone.**

```ts
supabase.from("proposal_versions").select("*")
  .eq("id", targetVersionId)
  .eq("proposal_id", proposalId)   // <- the guard
  .single()
```

A version id that doesn't actually belong to `proposalId` — a stray id, a
typo, or a deliberate attempt to view a different proposal's version by
guessing/reusing an id — resolves to **no row**, and `getFullProposal()`
returns `null` exactly like a not-found proposal. The calling page then
renders `notFound()`, never another proposal's content. This is on top of
(not instead of) RLS, which independently confines every `proposal_versions`
read to the caller's own tenant regardless of what id is requested — see
`tests/rls/phase3c-proposal-export.test.ts`, "a version id that belongs to
a DIFFERENT proposal never resolves, even within the same tenant."

## Security model

**Internal export** (`/proposals/[id]/print`) validates, in order:
authenticated Supabase session (`proxy.ts`'s default — this path isn't in
its always-allowed list), active tenant membership
(`requireActiveTenant()`), `proposals.view` permission, and proposal
ownership + version ownership (`getFullProposal()`'s tenant/proposal
filters, as above). No client-supplied `tenant_id` is ever trusted — it
always comes from the caller's own resolved active-tenant cookie/session,
identically to every other page under `(protected)`.

**Portal export** (`/p/[token]/print`) validates: the session cookie
exists and is unexpired/unrevoked, the link it belongs to is not revoked,
the proposal is not archived, and — per the version-safety rule above —
either the link is bound to the proposal's current version (in a normal
viewable status) or to a historical version that was genuinely finalized
(`locked`/`superseded`). No client-supplied `proposal_id`/`version_id` is
ever accepted directly — both are always derived from the session token
hash, exactly like `/view`.

**Media authorization**: unchanged from Phase 3A/3B — see
[docs/53](53-client-portal-security.md), "Storage / signed URLs." Every
signed URL the export document displays is generated from a
`proposal_media` row already scoped to the exact `proposal_version_id`
the caller was just authorized to see; a portal visitor's signed URLs
still go through the service-role admin client
(`getSignedMediaUrlsForPortal()`), a contractor's through the ordinary
RLS-gated client (`getSignedMediaUrls()`) — no new code path, no new
bypass.

## Verified directly

`tests/rls/phase3c-proposal-export.test.ts`:

- The owning tenant can read its own proposal + version.
- Tenant B cannot read Tenant A's `proposal_versions` row at all (RLS).
- A version id belonging to a *different* proposal never resolves, even
  within the same tenant.
- A historical (superseded) version is still readable by its owning
  tenant.
- A revoked link's session cannot resolve a version to export.
- An expired link's session cannot resolve a version to export.
- An archived proposal cannot resolve a version to export.
- After a revision, the OLD link's session still resolves the OLD version.
- A NEW link created after the revision resolves the NEW version.
- The client response is attached to the exact version exported.
- Tenant B's own proposal is completely unaffected by Tenant A's export
  activity.

`tests/e2e/proposal-export.spec.ts`, "Proposal export — revision safety":
a full browser-driven run of decline → contractor creates a revision →
edits the new version → marks it ready → creates a new portal link — then
confirms the OLD link's export still shows the OLD declined content (and
never the revised summary text), while the NEW link's export shows the
revised content with no response yet recorded.

## Known limitations

Everything in [docs/60](60-proposal-pdf-print-export.md)'s "Known
limitations" applies here too. Nothing security-relevant is deferred by
this phase — the version-safety guarantee above is fully implemented and
tested, not a partial/best-effort version of it.
