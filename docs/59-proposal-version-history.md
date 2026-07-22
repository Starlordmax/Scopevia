# 59 — Proposal Version History & Portal Link Safety (Phase 3B.1)

Status: **Implemented and verified**. Extends
[docs/58](58-proposal-revision-flow.md) (the revision flow itself) with the
two things that make a multi-version proposal trustworthy to look at: an
honest history view, and a guarantee that old links never start showing
new content (or vice versa).

## Version history

`getProposalVersionHistory(proposalId)`
(`src/lib/portal/data.ts`) loads every `proposal_versions` row for a
proposal (newest first), each joined with:

- **Its response, if any** (`proposal_client_responses`, matched by
  `proposal_version_id` — the same column that made "at most one response
  per version" a database-level guarantee back in Phase 3B, which is
  exactly the property this view relies on to show "no response" for a
  brand-new revision and the real recorded response for an old one).
- **Its most recent portal link's display status** (`proposal_portal_links`,
  computed the same way `PortalLinksPanel` already computes Active/
  Revoked/Expired for the current version — see
  [docs/52](52-client-portal-foundation.md)).

`VersionHistoryPanel`
(`src/app/(protected)/proposals/[proposalId]/version-history-panel.tsx`)
renders this as a table: version number (current one marked), version
status badge, created date, response (with its own badge + date), portal
link status. **Deliberately hides itself entirely for a proposal with only
one version** — a proposal that has never been revised has nothing to show
here, and an always-visible-but-empty section would just be noise on every
one of this app's proposals going forward. No raw UUID is ever rendered —
"Version 2 (current)" (`versionHistoryLabel()`,
`src/lib/proposals/revision-copy.ts`) is the only identifier shown,
matching the rest of the app's established "no internal ids in the UI"
convention (see [docs/52](52-client-portal-foundation.md), the Client
Portal's own identical rule for the client-facing side).

`getProposalClientResponse()` — the pre-existing Phase 3B function powering
the detail page's "Client response" card — was changed to take a
`proposalVersionId` instead of a bare `proposalId`. This was a real,
if latent, correctness gap this phase's own existence exposed: before
revisions were possible, a proposal could only ever have zero or one
response in its entire lifetime, so "the response for this proposal" was
unambiguous. A proposal can now have several responses over time (one per
version, thanks to the same unique constraint above), so "the" response
is meaningless without saying *which version's* response you mean. Every
caller now passes the current version's id — the card keeps showing
exactly what it did before for a never-revised proposal, and correctly
shows nothing (rather than an arbitrary/wrong historical response) for a
revision's own fresh version.

## Portal link safety: the gap found while designing this phase

This was caught during design, before it ever reached a real test run —
see [docs/58](58-proposal-revision-flow.md) for the parallel `superseded`
immutability gap found the same way.

`portal_get_link_info()`, `portal_request_otp()`, and
`portal_get_session_context()` (all from Phase 3A/3B) each gated on the
**proposal's current status** — `status in ('ready', 'sent', 'accepted',
'declined')`. The instant `create_proposal_revision()` runs,
`proposals.status` moves back to `'draft'`, which is not in that list. An
OLD portal link — still bound to the OLD, now-`superseded`, perfectly
intact `proposal_version_id` — would have become unreachable: a client
re-opening the exact link they used to decline a proposal would suddenly
see "This proposal is no longer available to view" instead of the declined
state they actually left behind. That directly breaks the core promise of
this phase: **old links keep showing old content, forever.**

### The fix

`20260720100300_client_portal_historical_version_access_fix.sql` changes
what each function validates. Instead of asking "is the proposal's CURRENT
status viewable," each now asks "is the version THIS LINK is bound to
still legitimately viewable" — true when either:

- **(a)** the link is bound to the proposal's *current* version, and that
  proposal is in a normal viewable status (`ready`/`sent`/`accepted`/
  `declined` — unchanged from Phase 3B), or
- **(b)** the link is bound to a *historical* version, and that version was
  actually finalized (`locked` or `superseded` — never a version abandoned
  mid-draft, which should never have had a link pointing at it to begin
  with).

An archived proposal remains unavailable through either path — archiving
was never something a revision should be able to route around.

All three functions are forward-fixed (`CREATE OR REPLACE`, same
signatures/return shapes, the Phase 3A/3B originals never edited).
Verified directly:
`tests/rls/phase3b1-proposal-revision.test.ts`, "Portal links after a
revision" (old link still resolves post-revision, session survives, a new
link points at the new version, no link creatable before the revision is
marked ready again) and end-to-end in
`tests/e2e/proposal-revision.spec.ts` (old link shows "Proposal declined,"
new link shows "Ready to move forward?").

### What this fix does NOT change

`create_proposal_portal_link()` itself is untouched — it still only
creates a link for a `ready`/`sent` proposal, and it still freezes
`proposals.current_version_id` onto the link at creation time. Both of
those pre-existing guarantees are exactly what already made "a new link
points at the new version" and "no link creatable until the revision is
ready again" true for free, with zero code change — see
[docs/58](58-proposal-revision-flow.md)'s state-transition section. Only
the *read* side (can an existing link still be viewed) needed fixing; the
*write* side (when can a new link be created, and what does it point at)
was already correct by construction.

## Known limitations

- **Version history has no pagination.** A proposal is expected to go
  through a small number of revisions in practice; the table shows all of
  them.
- **No filtering/searching within version history.** Not requested by the
  brief, and not needed at the expected scale.
- Everything else in [docs/58](58-proposal-revision-flow.md)'s "Known
  limitations" applies here too (no PDF/payments/e-signature/email
  notifications).
