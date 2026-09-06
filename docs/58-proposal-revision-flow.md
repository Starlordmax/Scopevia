# 58 — Proposal Revision Flow (Phase 3B.1)

Status: **Implemented and verified** — 19 new RLS/integration tests
(`tests/rls/phase3b1-proposal-revision.test.ts`), 6 new unit tests
(`tests/unit/revision-copy.test.ts`, plus additions to
`tests/unit/status-badge.test.ts`), 3 new E2E tests
(`tests/e2e/proposal-revision.spec.ts` +
`proposal-revision.mobile.spec.ts`).

> **Phase 3D**: notification dedupe keys are scoped per
> `proposal_version_id` — a revision's brand-new version gets its own
> independent "viewed"/"accepted"/"declined" notification history, never
> suppressed by the superseded version's — see
> [docs/62-proposal-email-notifications.md](62-proposal-email-notifications.md).
>
> **Phase 3C** lets a contractor export/print any version in the history
> this phase creates — including a superseded one — via a "Print" link on
> each Version History row, and confirms old/new portal links keep
> exporting the right content across a revision — see
> [docs/60-proposal-pdf-print-export.md](60-proposal-pdf-print-export.md)
> and [docs/61-export-version-safety.md](61-export-version-safety.md).

## The problem this phase solves

Phase 3B (see [docs/56](56-client-portal-accept-decline.md)) made
`proposal_versions` locking real for the first time: the instant a client
accepts or declines, their exact version is frozen (immutable) and their
response is permanently tied to it. That's correct — but it left no way
forward. If a client declines ("too expensive," "wrong timing," "let's
change the scope"), the contractor had no way to adjust anything without
either editing a proposal a client had never actually seen the revision of,
or manually recreating a brand-new proposal from scratch (losing the
opportunity link, the version history, everything).

This phase adds the missing step: **a revision**. A revision is a new
`proposal_versions` row, seeded from the locked one's content, that the
contractor can freely edit — while the locked version and the client's
response to it stay exactly as they were, forever.

## The flow

```text
Client declines/accepts a proposal (Phase 3B)
  → proposal_versions.version_status = 'locked'
  → proposals.status = 'declined' / 'accepted'
  → Contractor sees the response + a "Create revised version" /
    "Create new revision" card on /proposals/[id]
  → Contractor clicks it (accepted case: explicit confirm dialog first)
  → create_proposal_revision() runs:
      - copies the locked version's content into a brand-new draft version
      - the old version becomes 'superseded' (still immutable)
      - proposals.status returns to 'draft', current_version_id -> new version
  → Contractor edits the new draft version normally in the builder
  → Contractor marks it ready, creates a NEW client portal link
  → The OLD portal link keeps showing the OLD (superseded) version and
    its response, forever; the NEW link shows the NEW version
```

## `create_proposal_revision(p_proposal_id uuid)`

`supabase/migrations/20260720100100_proposal_revision_functions.sql`.
`SECURITY DEFINER`, called with the contractor's own authenticated session
(never the portal/admin client — this is entirely a contractor-side action).

Validates, in order: authenticated caller, `proposals.create_revision`
permission, proposal not archived, `proposals.status in ('accepted',
'declined')`, and (defensively) that the current version is actually
`locked`. Nothing here trusts a client-supplied version id — the current
version is always read from `proposals.current_version_id` itself.

Deliberately its **own** function rather than reusing or extending
`create_new_proposal_version()` (`20260706141100_proposal_functions_core.sql`,
Phase 2A's dormant "architecture prep for sending," never wired into any
UI): that function's copy logic predates Phase 2B's material-catalog
snapshot columns and Phase 2C's entire measurements schema, and would
silently corrupt or drop that data if reused unmodified (e.g. every copied
labor item would come out `pricing_method = 'hourly'` regardless of its
real method, since that function's `INSERT` never mentions the column).
It's left untouched — still unused by any caller, so changing it carries
real regression risk for zero benefit here.

## Data copy strategy

Everything is copied via `INSERT ... SELECT` from the old version to the
new one, in dependency order, using temporary id-mapping tables (`old_id ->
new_id`, `on commit drop`) so foreign keys that point at rows copied
earlier — `section_id`, `measurement_group_id`, `proposal_measurement_id`,
`proposal_line_item_id` — get remapped to the **new** rows, never left
pointing back at the old, now-superseded version's content:

1. **Sections** (`proposal_sections`) — title, description, type, sort
   order. Builds the section id map.
2. **Measurement groups** (`proposal_measurement_groups`) — name, service
   type, unit system. Builds the group id map.
3. **Measurements** (`proposal_measurements`) — every computed field
   (length/width/height/area/perimeter/linear_length/unit/waste), remapped
   to the new group. Builds the measurement id map.
4. **Line items / materials** (`proposal_line_items`) — description,
   quantity, unit, unit price, taxable, **and** the full catalog-snapshot
   provenance (`material_catalog_item_id`, `material_zip_price_id`,
   `source_type`, `source_zip_code`, `source_supplier_name`,
   `source_price_effective_date`) copied verbatim, since those reference
   the catalog itself (tenant/global-scoped), not anything version-specific.
   `section_id` remapped via the section map. Builds the line-item id map.
5. **Labor items** (`proposal_labor_items`) — every field for every pricing
   method (`hourly`, `fixed`, `area`, `linear`), including
   `proposal_measurement_id` remapped via the measurement map, so a
   measurement-generated labor item still points at ITS new measurement,
   not the old one.
6. **Measurement shapes** (`proposal_measurement_shapes`) — the drawn
   geometry, remapped to the new measurement.
7. **Measurement materials** (`proposal_measurement_materials`) —
   provenance rows linking a measurement to a generated catalog material,
   remapped to both the new measurement and the new line item.
8. **Media** (`proposal_media`) — `media_asset_id` copied as-is (the
   underlying Storage file is never duplicated — both versions simply
   reference the same uploaded photo).

**Explicitly never copied** (all stay attached to the OLD version only):
`proposal_client_responses`, `proposal_view_events`,
`proposal_portal_sessions`, `proposal_portal_otps`,
`proposal_portal_links`, `audit_logs`, `crm_activities`. A revision is a
fresh start for editable content — not a fresh start for history.

Version-level fields (summary, scope intro, dates, terms, exclusions,
notes, discount, tax rate, pricing ZIP/state/city) are copied directly in
the `INSERT` that creates the new `proposal_versions` row itself.

After every table is copied, `recalculate_proposal_version()` — the same
function every ordinary labor/line-item mutation calls — runs once on the
new version, so its totals are freshly derived from what was actually
copied, not carried over as stale numbers.

## Why totals are copied, not recalculated from scratch pricing

The brief is explicit: copy the previous snapshot values as a starting
point, don't auto-recalculate *prices*. This function honors that —
`unit_price_cents`, `hourly_rate_cents`, `fixed_total_cents`, and every
other price field are copied byte-for-byte from the old version. Only the
*aggregate totals* (`subtotal_cents`, `tax_cents`, `total_cents`, etc.) are
recomputed, because they're never trusted values to begin with —
`recalculate_proposal_version()` is the same server-side derivation every
other proposal mutation already goes through, and skipping it here would
leave a new version whose stored totals don't match its own line items.

## State transitions

See [docs/31](31-proposal-state-machines.md) for the updated diagram. In
short:

- `accepted` / `declined` → `draft`, exactly once `create_proposal_revision()`
  succeeds. No new status literal was added — `proposals.status` already
  had `draft` available, and the brief's own preference ("avoid inventing
  many new statuses if unnecessary") pointed the same direction.
- **"Revision in progress" is a UI signal, not a database state.** The
  contractor detail page computes `isRevisionInProgress = proposal.status
  === 'draft' && version.version_number > 1` and shows "— Revision in
  progress" next to the proposal title whenever that's true — a plain
  second (or third, or Nth) draft proposal looks identical in the database
  to a brand-new one; the version number is what distinguishes them, and
  the UI is the only place that needs to know.
- The **version's own** `version_status`: `locked -> superseded` for the
  old version, a fresh `draft` for the new one. See "Why superseded, not
  left locked" below.

## Why `superseded`, not left `locked`

`proposal_versions.version_status` has always had three values (`draft`,
`locked`, `superseded`) since Phase 2A, but until this phase nothing ever
reachable from the UI produced a `superseded` row.
`create_new_proposal_version()` (Phase 2A's dormant prep function) is the
only prior code that used it, and it was never called.

Reviewing that dormant function's approach while designing this one
surfaced a real, if previously harmless, gap: both
`prevent_locked_proposal_version_mutation()` and
`prevent_locked_version_child_mutation()` (the two immutability triggers
from `20260706140300_proposal_versions.sql`) only ever fired for
`version_status = 'locked'` — the moment a row became `'superseded'`, its
trigger-level protection silently disappeared. That was never exercised
before (nothing ever produced a `superseded` row from the app), so it
never mattered. It matters now: a revision makes `superseded` a real, live,
permanently-reachable state for every declined/accepted proposal's history.

Both triggers are forward-fixed in
`20260720100000_proposal_revision_schema.sql` (`CREATE OR REPLACE`, same
signatures, originals never edited) to treat `locked` and `superseded`
identically — both are terminal, immutable states now; the only legal
transition between them is `locked -> superseded` itself, which both
functions still explicitly allow. This is defense in depth on top of every
mutation function's own `version_status = 'draft'` check, not the primary
guard — but it's the same "second barrier" discipline this codebase has
followed for locked versions since Phase 2A, and it was worth closing
before `superseded` became something a real client's real accepted/
declined snapshot depends on.

## Known limitations

- **No PDF, no e-signature, no payments, no Stripe.** Unchanged from every
  prior phase — still explicitly out of scope.
- **No contractor/client email notification when a revision is created or
  a new link is sent.** The contractor must manually share the new portal
  link, same as every prior phase's link-sharing flow.
- **No way to "undo" a revision** (return to editing the old locked
  version). This is intentional — see
  [docs/57](57-client-response-security.md) and
  [docs/31](31-proposal-state-machines.md): once a client has responded,
  that exact content is permanent history, not something a later mistake
  should be able to silently rewrite.
- **Accepting-then-revising has no additional business-process gate**
  beyond the UI's confirmation dialog (`acceptedRevisionConfirmMessage()`,
  `src/lib/proposals/revision-copy.ts`) — the brief's own recommendation
  was "allow with a strong warning," not "block outright" or "require a
  second approver," so that's what's implemented. A tenant that wants a
  stricter policy (e.g. Owner-only revision-from-accepted) would need a
  future, explicit permission split.
