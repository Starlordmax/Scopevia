# 50 — Visual Review Notes (Phase 2D)

Status: reference notes for the Phase 2D visual review — screenshot
inventory, per-page findings, and limitations intentionally left
unfixed. See [docs/49](49-phase-2d-ux-polish.md) for the changes
actually made.

## Screenshot inventory

All screenshots live under `test-results/ui-review/` (gitignored, not
committed — regenerate with the temporary specs described in
docs/49 if needed again). Two tags: `baseline` (before this phase's
fixes) and `after` (once all fixes landed).

> Note: the `baseline` tag was accidentally overwritten mid-session by
> a full `npm run test:e2e` run that picked up the temporary
> screenshot specs (they weren't excluded from the default test glob).
> The `after` tag is the reliable, deliberately-recaptured set; the
> `baseline` folder ended up reflecting a partially-polished
> intermediate state rather than the true pre-fix state. This did not
> affect the review itself — every issue below was found and confirmed
> against the true baseline *before* the overwrite happened, via direct
> visual inspection during the session.

**desktop/ (1440×900, 23 images):** `01-dashboard-empty`,
`02-proposals-list-empty`, `03-portfolio-empty`, `04-proposal-settings`,
`05-measurements-empty`, `06-measurements-manual-unsaved`,
`07-measurements-freehand-drawn`, `08-measurements-saved-list`,
`09-scope`, `10-labor-empty`, `11-labor-saved`, `12-materials-no-zip`,
`13-materials-with-zip`, `14-materials-saved-costs`, `15-photos-empty`,
`16-photos-with-upload`, `17-terms-pricing`, `18-review-step`,
`19-preview`, `20-portfolio-detail`, `21-portfolio-list-populated`,
`22-dashboard-populated`, `23-proposals-list-populated`.

**mobile/ (390×844, 13 images):** `01-dashboard`, `02-proposals-list`,
`03-portfolio-list`, `04-measurements-empty`, `05-measurements-saved`,
`06-freehand-empty-canvas`, `07-freehand-closed-with-preview`,
`08-freehand-saved`, `09-labor`, `10-materials-no-zip`,
`11-materials-with-zip`, `12-preview`, `13-portfolio-detail`.

## Per-page findings

### Dashboard
All six stat tiles used the identical icon (fixed — see docs/49). Empty
state ("No proposals yet...") was already good, matches the brief's
suggested copy almost verbatim — not touched. Activity feed
capitalization bug found and fixed (docs/49).

### Proposals list
Already clear: Number/Title/Client/Total/Status/Updated columns,
Active/Archived/All filter, "Delete proposal" already lives in a
"Danger zone" secondary section on the detail page, not as a primary
action. Mobile: the existing `.table-card` responsive pattern converts
rows into labeled blocks below 640px — not literal `<div>` cards, but
reads the same way; not restructured, since it's an established,
already-tested pattern shared by every other table in the app.

### Proposal Settings (newly reviewed this phase)
Clean, simple form — Currency/Default hourly rate/Default hours per
day/Default tax rate/Proposal validity/Proposal number prefix/Default
terms/Default exclusions. One leak found and fixed: "Phase 2A supports
USD only." (see docs/49).

### Measurements step
Manual entry vs. Draw layout distinction, and Freehand vs. Rectangle
mode, were already reasonably clear from the existing hint text
(established in Phase 2C/2C.1) — this phase added a per-tab summary
line and reference-length worked examples on top of what already
existed, rather than replacing it (the existing freehand hint text,
which explicitly describes the Close-shape/leave-open distinction, is
more specific than the brief's suggested generic text and was judged
already better — left unchanged).

### Materials & Costs step
ZIP + search already read as one flow (Phase 2B.1). Catalog results
list has no pagination — confirmed on both desktop and, more severely,
mobile (a populated ZIP's full result set renders as one very long
scroll, see Known limitations). **Fixed in Phase 2D.1** — see
[docs/51](51-material-catalog-pagination.md).

### Labor step
Hourly vs. Fixed now explained (docs/49). Saved-vs-preview distinction
already unambiguous (amber dashed border + "Not saved yet." + separate
"Saved labor" heading, from an earlier round of work) — not touched.

### Photos step
Current job vs. Previous work now explained (docs/49). Upload control
is a native, unstyled `<input type="file">` ("Choose File / No file
chosen") — visually dated next to the rest of the polished UI, but
left as-is (see Known limitations).

### Proposal Preview
Matches the brief's 15-item ordered checklist exactly end to end
(confirmed via a fully-populated screenshot with every section filled
in). No technical leakage anywhere. Only change: the measurement Type
column's capitalization (docs/49).

### Portfolio
Service-type capitalization and "1 photo(s)" pluralization fixed
(docs/49). Archive action gained a confirmation dialog (docs/49).

### Mobile (general)
No horizontal overflow found anywhere, confirmed by both visual
screenshot review and the existing E2E overflow assertions (still
passing). The one real mobile bug found this phase (the sticky-topbar
touch issue on the Draw layout canvas) was actually found and fixed in
the *previous* Phase 2D session, not this one — see
[docs/47](47-drawing-sketch-mode.md#phase-2d-fix-sticky-topbar-swallowing-touches-at-the-canvas-top)
for the writeup; re-verified still fixed and working in this session's
screenshots.

## Known limitations carried forward

- **No confirmation dialogs on the Proposal Builder's internal "Remove"
  actions** (Scope section, Labor item, Material line item,
  Measurement, Photos). This phase gave all six a pending-state
  indicator (`SubmitButton`, "Removing…") so a slow click doesn't look
  broken, but did **not** add a confirm-before-submit step. Reason:
  every one of these "Remove" flows is already exercised by an
  existing E2E test that clicks Remove and expects immediate effect
  with no dialog; `window.confirm()` dialogs are auto-dismissed
  (cancelled) by Playwright unless a test explicitly registers a
  listener for one, so adding a confirm step would silently break
  those tests unless each one were also updated to accept the dialog.
  That's a legitimate follow-up, just a larger and riskier one than a
  polish pass should take on unprompted — flagged here rather than
  done partially.
- ~~**Material catalog results list has no pagination.**~~ **Fixed in
  Phase 2D.1** — server-side pagination + "Load more materials," see
  [docs/51](51-material-catalog-pagination.md). (Left here, struck
  through, for continuity with the rest of this document's original
  findings.)
- **Native, unstyled file inputs** on Photos and Portfolio upload forms.
  A custom-styled upload control (hidden input + styled label,
  showing the selected filename) is a reasonable follow-up but needs
  its own accessible-label handling — deferred rather than rushed.
- **"Team member" fallback is still ambiguous** when more than one team
  member hasn't set a `full_name` (a dropdown could show two identical
  "Team member" entries) — friendlier wording than "Unnamed member,"
  but doesn't solve the underlying data gap. The real fix (require a
  name at sign-up/invite, or fall back to showing an email) touches the
  auth/invite flow, outside this phase's scope.
- **The "Not saved yet." labor-preview text visually reads tight**
  against the following word ("yet.Click") in some renders. Checked the
  source twice — the JSX has a literal space (`</strong> Click ...`);
  this is font-rendering/kerning at small scale, not a missing
  character in the DOM. Not changed.
