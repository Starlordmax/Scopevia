# 76 — Measurements Draw-Layout Validation: Making the Red State Actually Visible

Status: **Implemented.** [docs/75](75-global-field-validation.md) built the
correct `fieldErrors`/`FieldError`/`aria-invalid` architecture everywhere,
but in Measurements' Draw layout (Freehand and Rectangle) it never
actually rendered — clicking Save with missing fields did nothing
visible at all. Root-caused, reproduced with real Playwright + screenshots
**before** fixing, then fixed and re-verified the same way.

## Root cause (two separate, compounding bugs)

1. **The Save button was `disabled` based on the exact conditions it was
   supposed to report as errors.** `FreehandDrawForm`'s Save button was
   `disabled={!hasEnoughPoints || pixelsPerUnit <= 0 || ...}` —
   `!hasEnoughPoints` (nothing drawn) and `pixelsPerUnit <= 0` (no/invalid
   reference length) are exactly the two things `saveMeasurementPolygonShapeAction`
   would otherwise report as `"Draw the area before saving."` and
   `"Enter a reference length greater than 0."`. A disabled button can't
   be clicked, so the Server Action — the only thing that ever populated
   `fieldErrors` — never ran. The click did *nothing*: no error, no red
   border, no message. `RectangleDrawForm` had the same pattern for
   `!hasShape`. Reproduced with `tests/e2e/measurements-validation-visual.spec.ts`
   against the pre-fix code: the "Save" button asserted `toBeEnabled()`
   and failed — it was `disabled`.
2. **Native HTML5 constraint validation (`min`/`max` on `type="number"`,
   `type="email"`, `pattern`) silently intercepts form submission before
   React ever sees it — the exact same class of bug as the `required`
   attribute already removed everywhere in docs/75, just on different
   attributes nobody had checked.** Once bug #1's disabling was removed
   and the Save button became clickable again, clicking it with e.g. a
   reference length of `0` still didn't turn anything red — the browser's
   own native tooltip ("Value must be greater than or equal to 0.01")
   appeared instead, and the `submit` event (and therefore the `onSubmit`
   handler and the Server Action) never fired at all. Confirmed with a
   screenshot of the native browser popup during this investigation.
   This affects **every** field with `min`/`max`/`type="email"`/`pattern`
   across the whole app, not just Measurements — a systemic gap in
   docs/75's own fix, which only ever removed `required`.

## Fix

### 1. Save is never disabled for "this would currently fail validation"

`FreehandDrawForm` and `RectangleDrawForm`'s Save buttons are now only
`disabled` for genuine structural preconditions (no measurement group to
save into, or mid-drag). The two geometry-blocking cases — nothing drawn,
invalid reference length — are instead caught in a `handleSubmit` that
runs `e.preventDefault()` only when actually invalid, computing a local
`clientFieldErrors` object (gated behind an `attemptedSubmit` flag so
nothing shows before the first real attempt) that's merged with the
Server Action's own `state.fieldErrors` and fed through the exact same
`fieldErrorProps`/`FieldError`/`useFocusFirstFieldError` primitives as
every server-validated field. Recomputed every render (not "set once"),
so fixing the underlying value clears the red state immediately.

### 2. `noValidate` on every form wired with `fieldErrorProps`/`FieldError`

Added to the `<form>` element in every file using the pattern (Measurements'
four forms, Draw layout's two, and — since this bug class isn't
Measurements-specific — every other form from docs/75: Auth, Profile,
Members, Clients, Quick Create Client, Opportunities, Proposal creation,
Materials & Costs, Labor, Scope, Portfolio, Notes, the Client Portal, logo
upload). This is the single, safe, standard way to stop the browser's own
constraint validation from intercepting a submit before the app's own
(styled, accessible, server-verified) validation gets a chance to run —
it does **not** remove `type="number"`/`type="email"`'s other benefits
(spinner controls, numeric/email mobile keyboards).

### 3. Canvas invalid-state moved from `<svg role="img">` to a wrapping `<div>`

`aria-invalid` isn't a supported attribute on `role="img"` per the ARIA
spec (caught by `eslint-plugin-jsx-a11y` during this fix). The drawing
canvas's red border, `id="drawing"` (focus target), and
`aria-invalid`/`aria-describedby` now live on a wrapping `<div>`; the
inner `<svg role="img">` keeps its own clean, unconflicted accessible
description of the drawing surface.

## Verification (real, not theoretical)

- `tests/e2e/measurements-validation-visual.spec.ts` — three scenarios,
  each reproduced failing against the pre-fix code first: no drawing at
  all (canvas red, focused, `aria-invalid`, "Draw the area before
  saving."), a drawn shape with an invalid reference length (only that
  field turns red, canvas stays clean), and Manual entry with an invalid
  length (0) turning both the empty name and the invalid length red
  instead of hitting the native number-input popup.
- `tests/e2e/measurements-validation-visual.mobile.spec.ts` — same "no
  drawing" scenario at 390×844, confirming visibility and no horizontal
  overflow.
- Screenshots (gitignored, paths reported): `test-results/validation-review/measurements-draw-errors.png`,
  `measurements-draw-reflength-error.png`, `mobile-measurements-draw-errors.png`.
- Updated two pre-existing tests whose assertions encoded the old
  (buggy) disabled-button behavior: `custom-service-name-and-multistroke.spec.ts`'s
  Save-becomes-disabled-on-Undo and Save-becomes-disabled-on-empty-reference-length
  assertions now assert the button stays enabled and instead check the
  red-state error that (correctly) appears on click.
- Full regression pass (see final report) across every file touched by
  the `noValidate` sweep.

## Known limitations

- A latent, pre-existing `getByLabel("Client")` test-selector ambiguity
  (unrelated to this fix — the Quick Create Client modal's own "Client
  type" label and dialog title both match a non-exact "Client" lookup)
  was hit repeatedly while regression-testing this change across the
  E2E suite. Fixed everywhere it was found (`{ exact: true }`, matching
  the one correct call site that already had it), but this was a
  pre-existing gap in the E2E suite's own selectors, not something this
  fix introduced.
- `clients.spec.ts`'s "editing a client persists after reload" test
  remains an intermittent, pre-existing timeout unrelated to this
  change (see docs/75's own "Known limitations").
