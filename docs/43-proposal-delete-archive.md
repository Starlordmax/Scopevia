# 43 — Proposal "Delete" (Soft Archive Only)

Status: **Implemented** — UI-only change; no new migration. Verified
end-to-end (`tests/e2e/proposals.spec.ts`,
`tests/e2e/material-catalog.spec.ts`/`.mobile.spec.ts`) and with
additional RLS coverage (`tests/rls/phase2b-materials.test.ts`,
"Proposal archive/restore — additional coverage").

## "Delete" always means archive

The UI says "Delete proposal." Internally this is **always**
`archive_proposal()` — the same `SECURITY DEFINER` function that has
existed, fully implemented and tested, since Phase 2A
([docs/30](30-phase-2a-proposal-data-model.md)). There is no hard
delete path anywhere in this phase: no `DELETE FROM proposals` is ever
issued from an ordinary UI action, and none was added. `archive_proposal`
already:

- Requires `proposals.archive`, validates the status transition
  (draft/ready → archived), sets `archived_at`/`archived_by`/
  `pre_archive_status`.
- Writes an audit log row (`proposal.archived`) and a CRM activity.
- Never touches line items, labor items, media, or versions — archiving
  a proposal archives the *proposal*, not its content.
- Is fully reversible via `restore_proposal()`, which returns the
  proposal to its `pre_archive_status` and even catches the "another
  active proposal on this opportunity" conflict with a friendly error.

**No new backend function was needed for this phase** — this is a pure
UI/UX change: relabeling, a confirmation step, and repositioning.

## Confirmation

A native `window.confirm()` dialog (via the new
`ConfirmSubmitButton` component,
[src/components/confirm-submit-button.tsx](../src/components/confirm-submit-button.tsx))
blocks the submit until confirmed, with this exact copy:

> Delete this proposal? This will remove it from your active proposals.
> You can restore it later from archived proposals.

Restore has its own, simpler confirmation ("Restore this proposal? This
will move it back to your active proposals.").

## Placement: a secondary "Danger zone," never a primary action

Previously, Archive/Restore lived directly in the detail page's primary
action row, right next to Mark Ready/Return to Draft. This phase moves
them into a collapsed `<details><summary>Danger zone</summary>…`
section beneath the main content — closed by default, requiring an
explicit click to even reveal the Delete/Restore buttons. The primary
CTA on this page (and everywhere else in the app) remains **New
proposal**; nothing about proposal creation changed.

## Active / Archived / All filter

`/proposals` previously had a binary Active/Archived toggle (`?archived=1`)
plus an already-present-but-unexposed `status=` query param (used by the
dashboard's "Needs follow-up" link). This phase replaces the toggle with
a real three-way filter — `?view=active` (default) / `?view=archived` /
`?view=all` — rendered as three simple links. An explicit `status=`
always wins over `view` (so the dashboard's `?status=ready` link keeps
working unchanged, without ever contradictorily filtering the same
`status` column twice — see the comment in
[src/app/(protected)/proposals/page.tsx](../src/app/%28protected%29/proposals/page.tsx)).

## What did NOT change

- `archive_proposal()` / `restore_proposal()` — untouched, same
  functions since Phase 2A.
- Permissions — `proposals.archive` / `proposals.restore`, same as
  before.
- Line items, labor items, media, versions — never deleted, never
  touched by archive/restore, verified directly in
  `tests/rls/phase2b-materials.test.ts` ("archiving writes an
  audit_logs row and never deletes line items").

## Additional test coverage added this phase

`tests/rls/phase2a-proposals.test.ts` already covered the basic
archive/restore round-trip. This phase adds, in
`tests/rls/phase2b-materials.test.ts`:

- Tenant B cannot archive Tenant A's proposal (cross-tenant rejection).
- A suspended user's existing session cannot archive (same pattern as
  `tests/rls/phase1-restore.test.ts`).
- Archiving writes a real `audit_logs` row and never deletes line
  items (queried directly via `service_role`, not inferred).
