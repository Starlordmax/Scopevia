# 49 — Phase 2D: Visual Review & UX Polish

Status: **Implemented**, verified against the full test suite (unit,
RLS, E2E) both before and after the polish pass, with zero regressions.

## Scope

A visual/microcopy review of the entire app ahead of the Client Portal
phase — Dashboard, Proposals list, every Proposal Builder step
(Measurements, Scope, Labor, Materials & Costs, Photos, Terms &
Pricing, Review), Preview, Portfolio, Members, Profile, Proposal
Settings, and mobile (390×844). No new backend functionality was
added, per the brief's explicit restriction — with one exception: a
real bug found while testing the flow.

## The real bug: proposal creation redirected to the wrong step

**Symptom (reported directly):** after filling in a proposal's name and
clicking "Save and continue," the builder opened on step 2 (Scope of
Work) instead of step 1 (Measurements).

**Root cause:** `createProposalDirectAction` and
`createProposalFromOpportunityAction`
(`src/actions/proposals.ts`) both `redirect()`ed to
`/proposals/[id]/edit?step=scope` — unchanged since Phase 2A, before
the Measurements step existed at all. Phase 2C added Measurements as
the stepper's first tab but never updated this redirect (deliberately,
at the time, to avoid touching a large number of E2E assertions — see
the now-superseded note in [docs/45](45-measurements-takeoff-builder.md)).

**Fix:** both actions now redirect to `?step=measurements`.

**Test fallout:** ~15 E2E assertions across 7 spec files expected the
old `step=scope` redirect immediately after proposal creation.
Each was updated on a case-by-case basis:

- Where the test didn't care about Scope content at all (most cases):
  the expected URL was simply changed to `step=measurements`, and any
  subsequent `.replace(/step=scope/, ...)` string surgery was updated
  to match.
- Where a test actually needed to land on Scope (e.g. to fill Job
  Summary fields, or because its own name promised scope-editing
  coverage): a `page.getByRole("link", { name: "Continue to Scope of
  Work" }).click()` step was inserted right after the creation
  redirect, then the test proceeds exactly as before.
- Where a test jumped straight to Labor via the stepper (`/3.*Labor/i`),
  no navigation change was needed at all — Labor is still the
  stepper's 3rd item regardless of which step a session starts on.

Files touched: `tests/e2e/proposals.spec.ts`,
`proposals.mobile.spec.ts`, `measurements.spec.ts`,
`measurements.mobile.spec.ts`, `material-catalog.spec.ts`,
`material-catalog.mobile.spec.ts`, `permissions.spec.ts`. All 70
E2E tests pass after the change — zero coverage removed, only the
expected step name updated.

## Visual / microcopy changes

### Dashboard

- **Distinct icons per stat tile.** All six tiles (Draft/Ready/Sent/
  Accepted proposals, Total quoted value, Needs follow-up) previously
  used the identical `FileText` icon — a real scannability gap flagged
  in an earlier polish pass but not fixed until now. Now: `FileEdit`
  (Draft), `CircleCheck` (Ready), `Send` (Sent), `ThumbsUp` (Accepted),
  `DollarSign` (Total quoted value), `Clock` (Needs follow-up) — all
  from the already-installed `lucide-react` dependency, no new package.

### Measurements step

- A one-line hint now appears under the Manual entry / Draw layout tab
  buttons, describing whichever mode is currently active ("Measure a
  room or surface by entering its dimensions." / "Sketch the job area
  with your mouse or finger, then enter a real-world reference length
  so Scopevia can estimate its area and perimeter.") — previously the
  tabs had no description at all beyond their own labels.
- Both drawing modes' reference-length field now has a concrete
  worked-example hint beneath it ("Tell Scopevia what the full width of
  your drawing represents in real life. For example, if the widest
  part of your sketch is 10 ft wide, enter 10.") — previously just a
  short field label with no example.
- The "Drawing mode" dropdown's option text was reworded to name
  concrete, contractor-relatable spaces: "Freehand (recommended) — best
  for bathrooms, kitchens, patios, and other irregular spaces" /
  "Rectangle — best for simple rectangular rooms."
- The "Generate labor from measurement" panel had no explanatory text
  at all (unlike "Generate materials from measurement," which already
  explained ZIP status); it now reads "Price labor by a saved
  measurement's area or length — useful for jobs quoted per square foot
  or linear foot, like flooring or painting."
- The Materials-catalog dropdown inside this panel, and the "Coverage
  rate (per X)" label next to it, previously interpolated the raw
  database unit value directly (`linear_ft`, with the underscore
  visible) — now runs through the same `.replace(/_/g, " ")` treatment
  already used elsewhere in the app (`step-materials.tsx`), for
  `linear ft`.

### Labor step

- The Hourly estimate / Fixed price toggle had no guidance on which to
  pick; now reads "Use hourly estimate when you know your crew size and
  how long the job will take. Use fixed price when you already know
  what you want to charge for labor."

### Photos step

- Both "Current job photos" and "Previous work" headings had no
  sub-text distinguishing their purpose; now: "Photos of this specific
  job — before, during, or after the work." and "Show examples of
  similar work you've completed, pulled from your Portfolio."

### Materials & Costs step

- The empty-search message ("No materials match your search for this
  ZIP code. Try a different keyword or category.") didn't mention the
  custom-cost fallback, unlike its sibling "no price available"
  message. Now: "...Try a different keyword, category, or add a custom
  cost below." (`tests/e2e/material-catalog.spec.ts` updated to match.)

### Portfolio

- Service type ("bathroom remodeling") rendered in raw lowercase; now
  runs through the same `formatLabel()` capitalization as every other
  status/type label in the app (see "Systemic label capitalization"
  below).
- "1 photo(s)" — the classic lazy-pluralization placeholder — now shows
  correct singular/plural ("1 photo" / "2 photos").
- The Portfolio detail page's "Archive" action had no confirmation
  dialog at all (every other archive-style action in the app has one);
  now uses `ConfirmSubmitButton`, matching the existing proposal
  delete/restore pattern. Zero E2E test exercised this button before,
  so zero regression risk.

### Systemic label capitalization (`formatLabel()`)

A single shared helper, `formatLabel()` in `lib/proposals/format.ts`
(sentence-case + underscore-to-space), was added and applied at every
site that previously rendered a raw lowercase/snake_case database value
as a standalone label: proposal status badges (4 render contexts),
opportunity status badges (2 contexts), the scope section-type badge,
the measurement Type column (builder table + Preview), the material
catalog's Unit column, and the portfolio service-type line. Before:
`draft`, `floor_area`, `custom`. After: `Draft`, `Floor area`, `Custom`.
Verified this doesn't break any existing `.locator(".badge").filter({
hasText: "draft" })`-style E2E assertion, since Playwright's `hasText`
does case-insensitive substring matching on a plain string.

### Activity feed label bug

`describeActivity()` (`lib/crm/activity-labels.ts`) had explicit,
properly-capitalized cases for the original CRM activity types
(`"Client created"`, `"Opportunity created"`, ...) but fell through to
an un-capitalized default (`activityType.replace(/_/g, " ")`) for any
type it didn't recognize — and the 7 Phase 2C proposal/portfolio
activity types (`proposal_created`, `proposal_marked_ready`, ...) were
never added as explicit cases, so they rendered as `"proposal created"`
(lowercase) right next to properly-capitalized siblings in the same
list. Fixed: explicit cases added for all 7, and the default fallback
itself now auto-capitalizes as a defensive safety net for any future
activity type added without a matching case.

### "Unnamed member" / internal-phase leaks

- "Unnamed member" (shown as a byline/dropdown fallback when a
  member's `full_name` is empty) replaced with "Team member" across its
  3 usage sites (activity feed, notes author, assignable-member
  dropdown) — reads more naturally in a sentence ("Team member ·
  7/13/2026") than the slightly alarming "Unnamed."
- The Members page's own Name-column fallback (a different context —
  literally the person's name in a table) uses "No name set" instead,
  since it's read as a value, not a byline.
- Three internal-phase/vendor-name references that were visible to
  users (not just code comments) were removed: Proposal Settings'
  "Phase 2A supports USD only." → "Only USD is supported right now.";
  Members' "Phase 0 can only add someone who already has a Scopevia
  account..." → "You can only invite someone who already has a
  Scopevia account..."; Profile's "Managed by Supabase Auth — not
  editable here in Phase 0." → "Your email is used to sign in and
  can't be changed here."

### Error states

Five list pages (Members, Portfolio, Proposals, Clients, Opportunities)
rendered a raw Postgrest query-error message directly
(`{error.message}`) if their initial data fetch failed — an
essentially-unreachable path in normal operation, but one that could
leak a raw Postgres/RLS error string (relation names, constraint
names) if it ever did fire. All five now show a generic "We couldn't
load this page right now. Please try refreshing." instead. (This is
distinct from `friendlyRpcErrorMessage()`, the existing translator for
Server Action/RPC errors — its "pass raw text through if no known
pattern matches" fallback was reviewed and left unchanged, since most
RPC-raised errors reaching that fallback are deliberately
human-authored validation messages, e.g. "Name is required," not
internal leakage; blindly replacing that fallback would have broken
dozens of legitimate, already-friendly messages throughout the app.)

### Loading states

Six "Remove" buttons across the builder steps (Scope section, Labor
item, Material line item, Measurement, and Photos ×2 — current-job and
previous-work) were plain unwrapped `<button type="submit">` elements
with no pending-state feedback at all (no disabling, no spinner, no
text change during the request) — a real risk of a confused double
click on a slow connection. All six now use the existing `SubmitButton`
component (`pendingText="Removing…"`), the same component every primary
"Save"/"Add" button in the builder already uses.

### Accessibility

- `aria-current="step"` added to the active link in the builder's
  stepper nav (`stepper-nav.tsx`) — previously only a non-standard
  `data-active` attribute existed, with no ARIA equivalent for
  assistive tech.
- Confirmed (no change needed): every icon-only button/link in the app
  already carries an `aria-label` (sidebar/bottom-nav items always pair
  an icon with visible text; the profile icon-only link already has
  both `aria-label` and `title`); `:focus-visible` styling already
  exists globally for `button`/`a` in `globals.css`.

## What was reviewed and found already correct (no change made)

- The Preview/Review document's section order already matches the
  brief's 15-item checklist exactly (business name → proposal number →
  prepared for → title → summary → scope → measurements → labor →
  materials → photos → previous work → terms → exclusions → pricing
  summary → total) — confirmed via a fully-populated screenshot. No
  UUIDs, JSON, storage paths, or internal statuses render anywhere.
- ZIP + catalog search already read as one unified panel (fixed in
  Phase 2B.1); the "changing ZIP only affects new items" warning
  already existed and was already clear.
- The Labor step's unsaved-preview vs. saved-items distinction (amber
  dashed border, explicit "Not saved yet." text, separate "Saved
  labor"/"Saved costs" headings) was already unambiguous, established
  in an earlier round of work — not touched.
- Every table (proposals list, labor items, material line items)
  already collapses into a labeled-card layout below 640px via the
  existing `.table-card`/`data-label` CSS pattern — confirmed still
  working on the current mobile screenshots, no horizontal overflow.

## Tests

| Suite | Before polish | After polish |
|---|---|---|
| Typecheck | clean | clean |
| Lint | clean | clean |
| Unit (`npm test`) | 153/153 | 153/153 |
| RLS/integration (`npm run test:rls`, sequential) | 247/247 | 247/247 |
| E2E (`npm run test:e2e`) | 70/70 | 70/70 (72/72 including the two temporary screenshot-capture specs, deleted after use) |
| Build | clean | clean |

## Files modified

```
.gitignore
CHANGELOG.md
README.md
docs/34-proposal-builder-ux.md
docs/45-measurements-takeoff-builder.md
docs/47-drawing-sketch-mode.md
src/actions/proposals.ts
src/app/(protected)/clients/page.tsx
src/app/(protected)/clients/[clientId]/page.tsx
src/app/(protected)/members/page.tsx
src/app/(protected)/opportunities/page.tsx
src/app/(protected)/opportunities/[opportunityId]/page.tsx
src/app/(protected)/page.tsx
src/app/(protected)/portfolio/page.tsx
src/app/(protected)/portfolio/[portfolioId]/page.tsx
src/app/(protected)/profile/profile-form.tsx
src/app/(protected)/proposals/page.tsx
src/app/(protected)/proposals/[proposalId]/page.tsx
src/app/(protected)/proposals/[proposalId]/edit/draw-layout-canvas.tsx
src/app/(protected)/proposals/[proposalId]/edit/step-labor.tsx
src/app/(protected)/proposals/[proposalId]/edit/step-materials.tsx
src/app/(protected)/proposals/[proposalId]/edit/step-measurements.tsx
src/app/(protected)/proposals/[proposalId]/edit/step-photos.tsx
src/app/(protected)/proposals/[proposalId]/edit/step-scope.tsx
src/app/(protected)/proposals/[proposalId]/edit/stepper-nav.tsx
src/app/(protected)/proposals/[proposalId]/proposal-document.tsx
src/app/(protected)/settings/proposals/settings-form.tsx
src/app/globals.css
src/lib/crm/activity-feed-data.ts
src/lib/crm/activity-labels.ts
src/lib/crm/assignable-members.ts
src/lib/crm/notes-data.ts
src/lib/proposals/format.ts
tests/e2e/material-catalog.spec.ts
tests/e2e/material-catalog.mobile.spec.ts
tests/e2e/measurements.spec.ts
tests/e2e/measurements.mobile.spec.ts
tests/e2e/permissions.spec.ts
tests/e2e/proposals.spec.ts
tests/e2e/proposals.mobile.spec.ts
```

## Files created

```
docs/49-phase-2d-ux-polish.md   (this file)
docs/50-visual-review-notes.md
```

(Two temporary Playwright specs used to capture before/after screenshots,
`tests/e2e/_ui-review-desktop.spec.ts` and `_ui-review.mobile.spec.ts`,
were created and deleted within this same phase — not part of the
permanent suite.)

## Known limitations (not fixed, by design)

See [docs/50](50-visual-review-notes.md#known-limitations-carried-forward)
for the full list — no confirmation dialogs on the Builder's internal
"Remove" actions' *destructive intent* (they now have loading feedback,
but not a confirm step — see the reasoning there), no pagination on the
material catalog results list, native unstyled file inputs, and the
"Team member" fallback still being ambiguous when multiple team members
lack a name.
