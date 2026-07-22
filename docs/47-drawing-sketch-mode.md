# 47 — Drawing / Sketch Mode

Status: **Implemented — freehand (primary) + rectangle (secondary)**,
verified end-to-end (`tests/e2e/measurements.spec.ts`,
`measurements.mobile.spec.ts` — the mobile specs drag via
mouse-emulated Pointer Events, the same code path a real touch drag
exercises).

## Phase 2C.1: freehand/brush drawing

Phase 2C shipped rectangle-only sketching, with the limitation
explicitly documented and `sketch_polygon` reserved (but unused) in the
schema for a future phase. Phase 2C.1 adds **freehand/brush drawing** —
tracing an irregular outline (an L-shaped room, a bathroom with a
jog, a patio) with mouse, touch, or stylus — as the **default,
recommended** Draw layout mode. Rectangle mode is kept as a secondary
option (a "Drawing mode" `<select>` switches between them) for the
common case of a simple rectangular room, where typing two numbers is
faster than tracing an outline.

### Freehand is represented internally as a polygon

There is no separate "freehand" geometry — a freehand trace is
captured as an ordered list of points and, once closed, is treated as
a `sketch_polygon`: the exact same `shape_type` Phase 2C reserved. This
is a deliberate simplification, not an oversight: a hand-drawn outline
and a manually-plotted polygon are mathematically identical once
you have the point list, so one code path (`save_measurement_polygon_shape()`)
and one set of geometry formulas (shoelace area, edge-length perimeter)
serve both. If a future phase adds vertex-by-vertex manual polygon
entry, it would call the same function.

An **open** path (the user never taps "Close shape") is stored as a
**linear measurement** instead — `area`/`perimeter` are left `null` and
only `linear_length` (the sum of segment lengths, no closing edge) is
computed. This lets the same tool double as "trace a trim/fencing run"
without a separate UI mode.

### No table migration needed

Diagnosis before writing any code (per this phase's explicit
instruction) found that Phase 2C had already made freehand support a
pure function addition, not a schema change:

- `shape_type`'s CHECK constraint already allowed `'sketch_polygon'`
  (added in `20260709140000_measurements_schema.sql`, unused until now).
- `proposal_measurements.length`/`width` were already nullable — a
  polygon has no natural single length/width pair, and the rectangle
  path already left them `null` for `manual_area`/`manual_linear` rows.
- `proposal_measurement_shapes.shape_data` was already flexible JSONB
  with only a byte-size bound (20KB), no rectangle-specific structure.

So Phase 2C.1 adds exactly one new SQL function,
`save_measurement_polygon_shape()`
(`supabase/migrations/20260710100000_measurement_freehand_polygon.sql`),
alongside the existing `save_measurement_shape()` (rectangle) —
deliberately a separate function, not an extended signature, keeping
zero regression risk to the already-tested rectangle path.

`update_measurement()`'s existing rejection of sketch-derived rows
already covered `sketch_polygon` (its `else` branch catches any
shape_type that isn't `manual_*`) — no change was needed there either.

## Why no drawing library — a plain SVG point-capture drawer

`src/app/(protected)/proposals/[proposalId]/edit/draw-layout-canvas.tsx`
implements both drawing modes with a plain `<svg>` and React state — no
Fabric.js, Konva, react-konva, or similar dependency. The same
justification from Phase 2C extends to freehand capture:

- **Size**: a real CAD-style library is typically 80–150KB minified for
  capabilities (layers, multi-shape selection, vertex editing) neither
  drawing mode uses. Freehand capture adds **zero** dependency weight —
  it's an array of `{x, y}` points appended on `pointermove`.
- **Need**: the entire interaction is "drag to trace an outline, close
  it or not, enter a reference length, save" — a `<polygon>`/`<polyline>`
  element kept in sync with a point array in React state.
- **Mobile compatibility**: the same native
  [Pointer Events API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)
  (`onPointerDown`/`onPointerMove`/`onPointerUp`) unifies mouse, touch,
  and stylus input with zero extra code or polyfills.

## The freehand flow

1. **Draw**: drag anywhere on the canvas (mouse, touch, or stylus) — one
   or more strokes are captured as they're drawn, rendered live as an
   SVG `<polyline>`. Multiple strokes concatenate into one point list
   (draw a few short strokes, or one continuous trace — both work).
2. **Undo** removes the last completed stroke; **Clear** discards
   everything and starts over; both are disabled mid-stroke.
3. **Close shape** (a toggle button, the brief's recommended MVP
   choice over auto-close-on-release or tap-near-start) marks the
   outline as a closed area — leaving it un-toggled saves a **linear**
   measurement instead (see above). The button requires at least 3
   captured points and is disabled mid-drag.
4. **Scale**: enter the real-world length the *drawing's bounding-box
   width* represents (e.g. "This drawing's width represents: 20 ft").
   Unlike rectangle mode (which has one obvious "width" side), an
   arbitrary polygon has no natural single reference edge, so the
   calibration dimension is the outline's overall horizontal extent
   (`max(x) − min(x)` across every captured point) — matching the
   brief's own suggested approach.
5. A live preview (area + perimeter, or linear length) computes
   client-side using the exact same formulas the server uses — see
   [docs/46](46-measurement-calculation-engine.md).
6. **Save** sends the already-scaled real-world points (not raw
   pixels) to `save_measurement_polygon_shape()`, which independently
   recomputes area/perimeter/linear_length server-side via the
   shoelace formula and edge-length summation — the server never
   trusts a client-computed area, exactly the same discipline as
   rectangle mode.

## Point simplification (Douglas-Peucker)

A real mouse/touch drag can produce hundreds of points, most of them
redundant (near-collinear samples along a straight stretch of the
trace). Before scaling and submission, the raw point list is run
through Douglas-Peucker simplification
(`simplifyPolyline()` in `src/lib/proposals/measurements.ts`, tolerance
2px): recursively keep only the point furthest from the line
connecting a segment's endpoints (if beyond the tolerance), discard
the rest. This is the standard, well-understood point-decimation
algorithm — chosen because the brief allowed "a reasonable strategy"
and asked that it be documented, not because any more exotic technique
was needed. It:

- keeps the shape's corners and curves recognizable while dropping
  near-duplicate points along straight stretches,
- keeps `shape_data` comfortably under its 20KB bound without a
  separate ad-hoc point-count cap doing the real work (a defensive
  500-point server-side cap exists as a backstop, not a realistic
  limit given simplification),
- is applied **before** scaling, so the tolerance is in canvas pixels,
  not real-world units (the same 2px feels right regardless of what
  the final scale turns out to be).

## What is explicitly NOT stored

Same rule as rectangle mode: `shape_data` (bounded to 20KB, enforced by
a CHECK constraint) holds only point coordinates, a `closed` flag,
stroke count, and viewport metadata — never a base64 image or scanned
blueprint. There is no blueprint/PDF upload or parsing anywhere in
this phase.

## Mobile behavior

`touch-action: none` on the drawing `<svg>` prevents the browser from
interpreting a drag inside the canvas as a page-scroll gesture — the
same rule rectangle mode already relied on. Verified at 390×844
(`measurements.mobile.spec.ts`): a touch-emulated freehand drag closes,
scales, saves, and generates a material with no horizontal overflow at
any step. Buttons (Undo/Clear/Close shape/Save) use the same
touch-friendly sizing as the rest of the builder; no gesture more
complex than "drag, then tap a button" is required.

### Phase 2D fix: sticky topbar swallowing touches at the canvas top

Found while building a screenshot-capture script that scrolled the
canvas into view: the app shell's `.topbar` is `position: sticky; top:
0`. Scrolling the canvas to the very top of the viewport — exactly what
`scrollIntoViewIfNeeded()` does, and what a mobile browser's native
scroll-into-view-on-focus would also do — tucked the canvas's top
~50px behind the sticky header. Geometrically the canvas was still
"there" (`getBoundingClientRect()` reported its real position), but any
touch/click landing in that top strip actually hit the topbar, not the
drawing surface, silently dropping the first stroke of a drag. Fixed
with `scroll-margin-top: calc(var(--topbar-height) + 12px)` on both the
freehand and rectangle canvases (`draw-layout-canvas.tsx`) — the
standard CSS-only fix for a sticky/fixed header covering a
scroll-into-view target. A real user manually scrolling to the Draw
layout section could have hit the same issue; this fix covers both the
automated-scroll and manual-scroll cases identically since it's a
browser-level scroll behavior, not test-specific code.

### Phase 2D microcopy: reference-length examples, friendlier mode names

The reference-length field's label stayed short (form labels need to
stay compact), but both drawing modes now show a one-line example
underneath explaining the concept concretely — "Tell Scopevia what the
[full width of your drawing / width of your rectangle] represents in
real life. For example, if \[the widest part of your sketch / it's a
10 ft wide room\], enter 10." The "Drawing mode" dropdown's option text
was also reworded to name concrete, contractor-relatable spaces
("bathrooms, kitchens, patios, and other irregular spaces" instead of
"irregular rooms, L-shapes, patios") — same information, more
recognizable examples. See [docs/49](49-phase-2d-ux-polish.md).

## Known limitations

- **One shape per session** — drawing again (or starting a new stroke
  after closing) replaces the in-progress shape; there is no way to
  draw and calibrate multiple shapes before saving.
- **No moving individual points after drawing** — to change a drawn
  shape (freehand or rectangle), draw a new one and save it as a new
  measurement; there is no "drag a vertex to adjust" interaction.
- **No re-editing a saved sketch measurement** — `update_measurement()`
  explicitly rejects an attempt to edit a `sketch_rectangle`/
  `sketch_polygon` row's dimensions (the friendly error points the user
  back to the Draw layout tab to draw a replacement); only
  archive-and-recreate is supported for sketch measurements.
- **No multi-room/connected-floorplan drawing** — each measurement is
  one independent shape; there is no "draw a whole floor plan with
  multiple connected rooms" mode.
- **No advanced node editing, no PDF/blueprint import, no AI shape
  detection** — explicitly out of scope, per the brief.
- **The bounding-box scale calibration assumes the drawing's widest
  extent is the dimension the user measured in real life.** For a
  shape drawn at an angle, or where the meaningful reference length
  isn't the horizontal extent, the resulting scale (and therefore
  area/perimeter) will be off — the same "approximate precision is
  acceptable, not topographic accuracy" tradeoff the brief explicitly
  allows.
