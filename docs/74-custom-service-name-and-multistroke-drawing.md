# 74 — Custom Service Name, Multi-Stroke Drawing, and Field Validation

Status: **Implemented.** Three related fixes to the proposal-creation and
Measurements flows:

1. Selecting **Custom** as a proposal's Service type now requires (and
   saves, and displays everywhere) a human-readable name — "Deck
   repair," not the bare word "custom."
2. Freehand drawing (Draw layout → Freehand) now genuinely supports
   **multiple separate strokes** — lifting the pen/finger between two
   strokes no longer draws a phantom connecting line, visually or in the
   computed linear length.
3. The Measurements step's manual-entry and draw-layout forms gained
   **inline, per-field red-state validation** (red border, message
   under the field, `aria-invalid`/`aria-describedby`, focus moved to
   the first invalid field) instead of relying solely on a single
   generic error banner.

## Root cause

**Custom service name**: the "Service type" `<select>` on `/proposals/new`
already had a `Custom` option (used since Phase 2A), but nothing ever
collected what the custom service actually *was* — `proposal.service_type`
just stored the literal string `"custom"`, and every downstream display
(`proposal-document.tsx`, shared by the builder, preview, print, and
Client Portal) rendered that raw value, verbatim, as "Custom."

**Multi-stroke drawing**: `FreehandDrawForm` (`draw-layout-canvas.tsx`)
already captured strokes correctly as `Point[][]` — Undo/Clear already
operated on whole strokes, not points. The bug was downstream of that
correct capture: every stroke was **flattened into one array**
(`[...strokes.flat(), ...currentStroke]`) before being rendered (a
single SVG `<polyline>`/`<polygon>` drawn across every point in order)
and before being sent to the server (`save_measurement_polygon_shape()`
received one flat `p_points` array). An SVG `<polyline>` draws a
straight edge between every consecutive pair of points regardless of
which stroke they came from — so lifting the pen and starting a new
stroke elsewhere still rendered (and, for an open/linear path,
numerically summed into `linear_length`) a straight "teleport" line
across the gap. This is why it *felt* like one continuous line: it
computationally *was* one continuous line by the time it reached
rendering or the server.

**Validation UX**: measurement forms already validated server-side
(`add_measurement()`, `save_measurement_shape()`,
`save_measurement_polygon_shape()` all raise clear exceptions), but the
client only ever showed the resulting message in one generic
`.error-banner` at the top of the form — no per-field red state, no
`aria-invalid`, no focus management, matching neither the brief's
explicit requirement nor this app's own established pattern from
[docs/73](73-client-address-and-material-zip-defaults.md)'s address
validation (which *did* have this, just not extended to measurements).

## Fix

### 1. Custom service name

- **Data model**: `proposals.custom_service_name` (nullable text, ≤160
  chars), with a CHECK constraint (`proposals_custom_service_name_required_check`)
  requiring it whenever `service_type = 'custom'` — defense-in-depth
  below the application layer. See "Data model" below for why this
  lives on `proposals`, not a measurement group.
- **Validation**: `createProposalDirectSchema`/`createProposalFromOpportunitySchema`
  (`src/lib/validation/proposals.ts`) share a `.superRefine()` requiring
  `customServiceName` exactly when `serviceType === "custom"` — the
  exact brief-specified message, **"Enter a name for this custom
  service."**
- **SQL**: `create_proposal_direct()` re-validates the same rule (raising
  the identical message) and trims/stores the name; discards any stray
  value for a non-custom service type. `create_proposal_from_opportunity()`
  delegates to it unchanged.
- **UI**: `/proposals/new` shows "Custom service name" only when Service
  type is Custom, with the brief's exact placeholder. See "A real bug
  found and fixed" below for why this field (and Service type, and
  Proposal title) are now *controlled* React state instead of the
  simpler `defaultValue` pattern used elsewhere in this app.
- **Display**: `serviceTypeLabel(serviceType, customServiceName)`
  (`src/lib/proposals/service-type.ts`) is the single source of truth —
  returns the custom name (trimmed) when present, **"Custom service"**
  as a fallback for pre-existing rows with no name, or the normal label
  for every other service type. Used by `proposal-document.tsx` (covers
  the builder's Review step, the standalone `/preview` route, print/export,
  and the Client Portal — all four render through this one shared
  component) and the builder's own page header (visible on every step,
  including Measurements).

### 2. Multi-stroke drawing

`save_measurement_polygon_shape()`'s `p_points jsonb` (flat point array)
became **`p_strokes jsonb`** (an array of point arrays, one per stroke).
Geometry is computed accordingly:

- **Closed (area)**: every stroke's points are joined end-to-end, *in
  drawn order*, into one outline — the same deliberately simple "close
  shape" strategy this app already used for a single stroke, just now
  explicit about multi-stroke input. Shoelace area + full perimeter,
  numerically identical to before for a single-stroke shape.
- **Open (linear)**: each stroke's own consecutive-edge length is summed
  **independently**; a stroke boundary is never bridged by an edge. This
  is the actual bug fix.

`FreehandDrawForm` mirrors this split:

- Rendering: not closed → one `<polyline>` per stroke (no connecting
  segment between them); closed → one `<polygon>` over every stroke's
  points flattened in order (closing is explicitly what "joins them,"
  same as before).
- Geometry preview: `flattenStrokes()` + the existing
  `computePolygonArea()`/`computePolygonPerimeter()` for closed;
  the new `computeMultiStrokeLinearLength()` (sums each stroke's own
  `computePolygonPerimeter(stroke, false)`) for open.
- Douglas-Peucker simplification runs **per stroke**, not on a
  flattened cross-stroke array — simplifying across a stroke boundary
  would treat the gap as a real segment.

Undo/Clear/Close shape behavior (already correct) is unchanged: Undo
removes the last whole stroke, Clear removes everything, Close shape
only ever fires on explicit user action.

### 3. Field validation UX

Shared primitives, `src/components/form-field-error.tsx`:

- `fieldErrorProps(fieldErrors, id)` — spreads `className="field-input-error"` (red border, `.field-input-error` in globals.css) plus `aria-invalid`/`aria-describedby` onto an input.
- `FieldError` — the red message paragraph (`role="alert"`) under an invalid field.
- `useFocusFirstFieldError(fieldErrors)` — moves focus to the first
  invalid field once a new `fieldErrors` object arrives from a Server
  Action round trip.

Server side, `src/lib/validation/field-errors.ts`:

- `zodIssuesToFieldErrors(error)` — turns every Zod issue into a flat
  `{ fieldName: message }` map (not just the first issue, unlike the
  pre-existing `parsed.error.issues[0]?.message` pattern used
  elsewhere) — this is what actually produces one message per field
  instead of one message total.
- `attributeRpcErrorToField(message, mapping)` — best-effort maps a
  friendly RPC error message (something only the SQL layer could catch,
  e.g. "not closed") onto a field, via an ordered substring list.

`ActionResult` (`src/actions/auth.ts`) gained an optional
`fieldErrors?: Record<string, string>` — additive, every existing
consumer that only reads `.error` is unaffected.

Wired into: `createProposalDirectAction`/`createProposalFromOpportunityAction`,
`addMeasurementAction`, `updateMeasurementAction`, `saveMeasurementShapeAction`,
`saveMeasurementPolygonShapeAction`, and the corresponding form
components (`ManualMeasurementForm`, `FreehandDrawForm`,
`RectangleDrawForm`, `NewProposalForm`).

**`required` was removed from every field now covered by this
mechanism** (measurement name, length/width/height/area/linearLength,
draw-layout name/reference length, custom service name). This is
deliberate, not an oversight: the HTML5 native `required` attribute
blocks form submission — and therefore the Server Action — entirely
before it ever runs, so an empty required field never reaches (and
never shows) our own styled red-state validation; the user only ever
sees the browser's own unstyled tooltip. Removing `required` on these
specific fields lets an empty submit reach the server and get the
in-app message/focus/red-border treatment the brief asked for. Fields
this phase didn't touch (proposal title's sibling `min`/date-type
constraints elsewhere in the app, etc.) are unaffected.

## A real bug found and fixed: React's form-reset silently corrupts controlled fields on resubmit

Found while writing the E2E test for "fail once, fix the field, submit
again" (exactly the brief's own required flow) — and confirmed to
reproduce identically in a real production build (`next build && next
start`), ruling out a dev-tooling artifact. **React's `<form
action={fn}>` performs a native-like form reset after *every* action
response, success or failure** — the same behavior a plain HTML form
gets after a real submission. For an *uncontrolled* field (this app's
default pattern, `defaultValue` with no `value`/`onChange`), this is
invisible: the field was always going to reset, and on success the page
navigates away anyway.

`NewProposalForm`'s **Service type** select, however, is *controlled*
(`value={serviceType}` + `onChange`) so its visibility-gated "Custom
service name" field can react to the current selection. The native
reset clobbers the `<select>`'s live DOM value directly, **without**
React reliably re-rendering it back on the same tick — React only
re-applies a controlled `value` prop when the state it's derived from
changes, and `serviceType` (React state) never changed; only the DOM
was mutated out from under it. `Proposal title` (plain uncontrolled
text, no `defaultValue` to fall back to) had the analogous problem: a
native reset always reverts a text input to its `defaultValue` (here,
empty), discarding whatever the user had already typed the moment ANY
field on the form fails validation — not just `title` itself.

**This was worse than a blocked resubmission.** A first fix attempt
(controlling both fields via `useState` and forcing a remount with
`key={formGeneration}`, a per-response marker) *looked* correct under
manual `.inputValue()` spot-checks, but empirically raced with exactly
*when* the browser's own reset fires relative to React's remount —
sometimes the remount ran first and the reset silently undid it
afterward. The visible symptom wasn't a dead end; it was **silent data
corruption**: the select would submit `"interior_painting"` — the
first enabled `<option>`, the browser's own reset-to-default-selection
behavior — while `customServiceName` still correctly said "Deck
repair," so the request looked well-formed and succeeded. The saved
proposal was simply the *wrong service type*. A remount-based fix keys
its correctness on a happens-before relationship between two events
(React's commit vs. the browser's own form-reset) with no actual
ordering guarantee between them.

**Fix**: `title` and `serviceType` are backed by `useState` (via
`onChange`, as before) and additionally synced to the DOM through a
`ref` in a `useEffect` that re-asserts `titleRef.current.value =
title`/`serviceTypeRef.current.value = serviceType` on every render
where `state`, `title`, or `serviceType` changes. Unlike a remount,
this doesn't depend on winning a race — a `useEffect` runs strictly
*after* commit (and therefore after whatever the browser's reset
already did during that same submission cycle), so it is always the
last write, deterministically. This is a standard React pattern for
reconciling with a non-React-owned DOM mutation, distinct from (and a
better fit here than) the `key`-based forced-remount pattern already
used elsewhere in this codebase for `ClientSelect`
([docs/72](72-quick-create-client.md)), where the problem is a prop
update that a `defaultValue`-based uncontrolled element never re-reads
on its own — there, nothing is actively fighting the fix, so remounting
once is sufficient.

**Scope of this fix**: applied to the two fields that actually
corrupted a resubmission in this phase's tested flow (`serviceType`,
`title`). `customServiceName` remains uncontrolled/unsynced — the
brief's own test flow always re-fills it fresh immediately before every
submit, and it has no `required` attribute to get stuck behind. A
broader audit of every field in every form in this app for the same
latent desync
pattern is out of scope for this phase (see "Known limitations").

## Data model

```text
proposals
  └─ custom_service_name   text, nullable, ≤160 chars
     CHECK (service_type <> 'custom' OR (custom_service_name IS NOT NULL AND <> ''))

save_measurement_polygon_shape(..., p_strokes jsonb, p_closed boolean, ...)
  p_strokes: [[{x,y}, {x,y}, ...], [{x,y}, ...], ...]  -- one array per stroke
```

`custom_service_name` lives on `proposals`, not a measurement group,
because that's where `service_type` itself already lives — the brief's
own recommendation was "store it wherever the service type is stored."
`proposal_measurement_groups.service_type` exists in the schema but has
no UI writer anywhere in this app (`createMeasurementGroupSchema`
accepts it, but the "New group" form never renders a field for it) — it
is a **user-facing, single-per-proposal selection**, made once at
creation on `/proposals/new`, not a per-measurement-group concept. No
new table: one nullable column, matching this codebase's default of not
introducing structure beyond what's actually used.

`save_measurement_polygon_shape()`'s `p_points` → `p_strokes` is a
rename at the same parameter position with the same `jsonb` type — a
true `CREATE OR REPLACE` (same signature), not a new overload, per this
project's own hard-learned rule about `CREATE OR REPLACE FUNCTION` and
parameter count changes (see
[docs/73](73-client-address-and-material-zip-defaults.md)). The
migration drops the old signature first anyway, as zero-cost insurance.

## Tests

- **Unit** (`tests/unit/`): `custom-service-name-and-measurement-validation.test.ts`
  (customServiceName required-when-custom, discarded-when-not-custom,
  measurement/reference-length exact brief-specified messages),
  `field-errors.test.ts` (`zodIssuesToFieldErrors`/`attributeRpcErrorToField`),
  `service-type-label.test.ts` (`serviceTypeLabel()` — custom name shown,
  never the bare word "custom," "Custom service" fallback for legacy
  rows), and new cases in `measurement-calculations.test.ts`
  (`flattenStrokes`, `computeMultiStrokeLinearLength` — including the
  exact "phantom gap" regression case: two strokes 3 and 4 units long
  with a 100-unit gap between them sum to 7, not 107).
- **RLS/integration** (`tests/rls/`): a new "Custom service name" describe
  block in `phase2a-proposals.test.ts` (rejects missing/blank name with
  the exact message, saves and trims a real name, never persists a name
  for a non-custom type, `create_proposal_from_opportunity` enforces the
  same rule) and a new "Multi-stroke drawing" describe block in
  `phase2c-measurements.test.ts` (closed multi-stroke area matches an
  equivalent single-stroke shape exactly, open multi-stroke sums each
  stroke independently — the phantom-gap regression case again, this
  time through the real RPC — ignores a degenerate single-point stroke
  without crashing, rejects too-few-points and empty-strokes with the
  brief's exact friendly messages). Every pre-existing
  `save_measurement_polygon_shape` call site across the RLS suite
  (`phase2c-measurements.test.ts`) and every pre-existing `service_type:
  "custom"` proposal-creation call site across the whole RLS suite
  (9 files) was updated for the new `p_strokes` shape / the new
  `p_custom_service_name` requirement — a large, mechanical, but
  necessary compatibility pass; one incidentally-matched
  `create_portfolio_project` call (a different, unrelated RPC that
  happens to also accept `p_service_type: "custom"`) was correctly left
  untouched. 417/417 RLS tests passing.
- **E2E desktop**: `tests/e2e/custom-service-name-and-multistroke.spec.ts`
  — Custom service name required with a red field + focus + no
  navigation on failure; two genuinely separate strokes drawn (with a
  real gap) don't auto-connect (asserted via the live linear-length
  preview reading the correct sum, not the full bounding width); Undo
  removes a whole stroke; Clear removes everything; a closed shape's
  missing name is rejected with a red field; the full flow saves
  successfully and the custom service name appears on the proposal
  preview. `measurements.spec.ts`/`measurements.mobile.spec.ts` (the
  pre-existing suite) updated for the `name`/`scaleReferenceLength`
  field id unification (see "Files modified").
- **E2E mobile**: `tests/e2e/custom-service-name-and-multistroke.mobile.spec.ts`
  (390×844) — same flow, touch-sized drag, no horizontal overflow at any
  step, validation errors visible and usable.
- Full regression: `measurements.spec.ts`, `measurements.mobile.spec.ts`,
  `proposals.spec.ts`, `proposals.mobile.spec.ts` (including the full
  "client → proposal → every builder step → mark ready → dashboard →
  draft → archive → restore" flow and tenant isolation), and
  `quick-create-client.spec.ts` all pass alongside the new tests — 30/30
  in one combined run on a clean environment. Along the way, a
  pre-existing, unrelated flake was found and fixed in these same files:
  `page.getByLabel("Client")` (no `exact: true`) is ambiguous on
  `/proposals/new` because Playwright's substring match also matches the
  Quick Create Client modal's "Client type" field and its "Create new
  client" dialog title — fixed the same way this phase's own new E2E
  specs already had it right.
- Final full-suite verification: 345/345 unit tests, 429/429 RLS tests
  (run serially — this environment has a known Supabase Auth
  rate-limit flakiness under heavy test parallelism, unrelated to this
  phase), `tsc --noEmit` clean, `eslint .` clean, `next build` clean.

## Files created

- `supabase/migrations/20260801100000_proposal_custom_service_name.sql`
- `supabase/migrations/20260801100100_measurement_polygon_multistroke.sql`
- `src/lib/proposals/service-type.ts`
- `src/lib/validation/field-errors.ts`
- `src/components/form-field-error.tsx`
- `tests/unit/custom-service-name-and-measurement-validation.test.ts`
- `tests/unit/field-errors.test.ts`
- `tests/unit/service-type-label.test.ts`
- `tests/e2e/custom-service-name-and-multistroke.spec.ts`
- `tests/e2e/custom-service-name-and-multistroke.mobile.spec.ts`
- `docs/74-custom-service-name-and-multistroke-drawing.md` (this file)

## Files modified

- `types/database.ts` — `proposals.custom_service_name`;
  `create_proposal_direct`/`create_proposal_from_opportunity` Args/Returns;
  `save_measurement_polygon_shape` Args (`p_points` → `p_strokes`).
- `src/lib/validation/proposals.ts` — `customServiceName` +
  `refineCustomServiceName()` on both proposal-creation schemas;
  `positiveReferenceLength()` (exact brief copy); "Measurement name is
  required." copy across the measurement schemas.
- `src/actions/auth.ts` — `ActionResult.fieldErrors`.
- `src/actions/proposals.ts` — `customServiceName` wiring + fieldErrors
  on both proposal-creation actions.
- `src/actions/measurements.ts` — fieldErrors on all five measurement
  actions; `saveMeasurementPolygonShapeAction` rewritten for `strokes`.
- `src/lib/proposals/measurements.ts` — `flattenStrokes()`,
  `computeMultiStrokeLinearLength()`.
- `src/app/(protected)/proposals/new/new-proposal-form.tsx` — Custom
  service name field; `title`/`serviceType` made controlled and synced
  to the DOM via a ref+`useEffect` (see "A real bug found and fixed").
- `src/app/(protected)/proposals/[proposalId]/proposal-document.tsx` —
  uses `serviceTypeLabel()`.
- `src/app/(protected)/proposals/[proposalId]/edit/page.tsx` — page
  header shows the resolved service label on every step.
- `src/app/(protected)/proposals/[proposalId]/edit/draw-layout-canvas.tsx`
  — multi-stroke rendering/geometry/submission; field-error wiring;
  `name`/`scaleReferenceLength` ids unified to `name`/`scaleReferenceLength`
  (from `freehandName`/`drawRectName`/`freehandScaleReferenceLength`/
  `drawScaleReferenceLength`) so they match their Zod field keys exactly
  — safe since Manual entry/Freehand/Rectangle are mutually exclusive in
  the DOM.
- `src/app/(protected)/proposals/[proposalId]/edit/step-measurements.tsx`
  — field-error wiring on every `ManualMeasurementForm` field; `name`
  id unified the same way.
- `src/app/globals.css` — `.field-input-error`, `.field-error-text`.
- `tests/rls/phase2a-proposals.test.ts`, `phase2b-materials.test.ts`,
  `phase2c-measurements.test.ts`, `client-address-and-zip.test.ts`,
  `phase3a-client-portal.test.ts`, `phase3b-client-response.test.ts`,
  `phase3b1-proposal-revision.test.ts`, `phase3c-proposal-export.test.ts`,
  `phase3d-notifications.test.ts` — `p_custom_service_name` added to
  every `service_type: "custom"` proposal-creation call;
  `phase2c-measurements.test.ts` additionally updated for `p_strokes`.
- `tests/e2e/measurements.spec.ts`, `measurements.mobile.spec.ts` — field
  id updates (`#measurementName`/`#freehandName`/`#drawRectName` →
  `#name`; `#freehandScaleReferenceLength`/`#drawScaleReferenceLength` →
  `#scaleReferenceLength`); plus, alongside `proposals.spec.ts` and
  `proposals.mobile.spec.ts`, `getByLabel("Client")` →
  `getByLabel("Client", { exact: true })` (the pre-existing ambiguity
  fix — see "Tests").
- `CHANGELOG.md`, `README.md`, `docs/45-measurements-takeoff-builder.md`,
  `docs/46-measurement-calculation-engine.md`,
  `docs/47-drawing-sketch-mode.md`.

## Known limitations

- **The form-reset-desync fix is scoped, not exhaustive.** Only
  `serviceType` and `title` on `/proposals/new` were confirmed to
  actually corrupt a resubmission and were fixed (with the ref+effect
  DOM-forcing pattern, not a remount — see above). `customServiceName`
  (uncontrolled, no `required`) and every OTHER form in this app that
  mixes controlled fields with `<form action={...}>` could have the
  same latent issue if a future field is added that gates other UI the
  way Service type gates Custom service name. A general audit/fix (e.g.
  a small reusable hook wrapping this ref+effect pattern) is a
  reasonable follow-up, not done here to stay in scope.
- **`measurementType` (the closed-shape select in `FreehandDrawForm`) is
  still desync-prone** — it isn't `required` and has no blank
  placeholder option, so a post-reset resubmission can't be *blocked*
  by it, but per the exact same mechanism documented above, it COULD
  silently save with a different `measurementType` than the user last
  picked if a retry cycle happens to touch it. Not exercised by this
  phase's tests; a real but low-severity gap, and a good candidate for
  the same ref+effect fix if it's ever reported.
- **One shape per drawing session, no editing a saved sketch** — both
  pre-existing limitations from Phase 2C.1, unchanged by this phase.
- **No canonical outline-validity check for a multi-stroke closed
  shape** — "close shape" simply requires ≥3 total points across all
  strokes and a non-degenerate (non-zero) shoelace area; it does not
  detect e.g. two strokes that are geometrically nowhere near each
  other but still happen to enclose *some* area once joined end-to-end.
  This matches the brief's own explicit allowance for "a reasonable,
  simple strategy" and this app's existing "no advanced node editing"
  scope boundary.
