---
status: Accepted
date: 2026-07-06
supersedes: none
---

# ADR 0032 — Media asset model

## Context

Proposals need current-job photos and reusable previous-work photos
(from a Portfolio), both backed by Supabase Storage. The model needs to
support reuse (the same photo appearing in the Portfolio and in multiple
proposals) without duplicating the underlying file, and must survive a
Portfolio item being archived without breaking a proposal that already
references its media.

## Decision

`media_assets` is one row per uploaded **file**, independent of where
it's used (`media_type`: `current_job` | `portfolio` | `general`). Two
join tables attach it to something:

- `portfolio_project_media` — a photo belongs to a Portfolio project.
- `proposal_media` — a photo is displayed on a specific
  `proposal_version`, tagged `usage_type: current_job | previous_work`,
  with an optional `portfolio_project_id` (informational — which
  Portfolio item it was picked from, for the builder's "already added"
  state).

A `previous_work` attachment references the **same** `media_asset_id` as
the Portfolio row it came from — no file duplication. Archiving the
Portfolio project (`archive_portfolio_project()`) never cascades to
`proposal_media` or `media_assets`; a proposal that already attached that
photo keeps showing it. Verified directly:
`tests/rls/phase2a-proposals.test.ts`, "archiving a portfolio project
does not break a proposal that already references its media."

`media_assets` rows are archived, never hard-deleted (`archived_at`), so
a locked proposal version's photos can never disappear out from under it.

## Consequences

- Reusing a previous-work photo across N proposals costs one row per
  attachment in `proposal_media`, not N copies of the file.
- A future "delete this photo entirely" admin operation must check for
  any non-archived `proposal_media`/`portfolio_project_media` references
  before considering a hard delete — not implemented in Phase 2A (media
  rows are archived only), but the schema doesn't block adding it later.
