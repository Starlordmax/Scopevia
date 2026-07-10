# 47 — Drawing / Sketch Mode

Status: **Implemented — rectangles only**, verified end-to-end
(`tests/e2e/measurements.spec.ts`, `measurements.mobile.spec.ts` — the
mobile spec drags a rectangle via mouse-emulated Pointer Events, the
same code path a real touch drag exercises).

## Why rectangles only

The brief explicitly allows starting with rectangles if a full polygon
editor "adds too much complexity," with the instruction to document the
limitation. A construction-takeoff CAD editor — arbitrary polygons,
draggable vertices, multi-shape layers, undo/redo — is a genuinely
large feature (real takeoff software is a product category unto
itself); this phase scopes down to exactly what the worked examples in
the brief need: a rectangular room or surface, scaled to real-world
units. **No polygon support exists in this phase** — `shape_type`
reserves the enum value `sketch_polygon` in the database for a future
phase, but no function anywhere accepts or produces one.

## No drawing library — a plain SVG rectangle drawer

`src/app/(protected)/proposals/[proposalId]/edit/draw-layout-canvas.tsx`
implements the entire drawing surface with a plain `<svg>` and React
state — no Fabric.js, Konva, react-konva, or similar dependency.
Justification, per the brief's explicit requirement to justify any
drawing dependency:

- **Size**: a real CAD-style library is typically 80–150KB minified
  (Fabric.js ~300KB unminified, Konva ~200KB) for capabilities (layers,
  multi-shape selection, custom filters) this phase does not use at
  all. The rectangle-drawer above adds **zero** dependency weight.
- **Need**: the entire interaction is "drag to draw one rectangle,
  enter a reference length, save" — a single `<rect>` element kept in
  sync with two `{x, y}` points in React state. A general-purpose
  canvas library solves a much bigger problem than this one.
- **Maintenance**: no third-party API surface to track across React/
  Next.js upgrades; the whole implementation is ~200 lines of
  plain React + SVG, auditable in one read.
- **Mobile compatibility**: the browser's native
  [Pointer Events API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)
  (`onPointerDown`/`onPointerMove`/`onPointerUp`) already unifies mouse
  and touch input with zero extra code or polyfills — exactly the
  cross-device requirement the brief asks for, at no cost.

SVG (not a `<canvas>` 2D context) was chosen specifically because a
`<rect>` element declaratively tracks React state — no manual redraw
loop, no imperative draw calls to keep in sync with re-renders.

## The flow

1. Drag anywhere on the grid (mouse or touch) — a single rectangle
   follows the drag in real time, replacing any previous one (this
   phase supports **one shape per drawing session**, not multiple
   simultaneous shapes).
2. Enter the real-world length of the rectangle's width (a single
   calibration number, e.g. "12 ft") — this establishes a scale
   (pixels-per-unit) purely on the client, the same arithmetic a
   contractor would do by hand with a scale ruler.
3. The client computes the real-world height from that same scale and
   shows a live preview (area, perimeter) using the exact same
   `computeRectangle()` helper the Manual entry tab's preview uses —
   see [docs/46](46-measurement-calculation-engine.md).
4. On save, the client sends the **already-converted real-world
   length/width** (not raw pixels) to `save_measurement_shape()`, which
   independently recomputes area/perimeter server-side from those two
   numbers — exactly like a manual rectangle. The server never trusts a
   client-computed area, only client-computed length/width (the same
   discipline as every other calculation in this codebase).
5. `shape_data` (the four corner points + viewport dimensions, as
   small JSON) is stored in `proposal_measurement_shapes` purely for
   provenance/future re-editing — it is never used to compute anything
   that matters; the measurement's own `length`/`width`/`area`/
   `perimeter` columns are the source of truth for every downstream use
   (material/labor generation, Preview).

## What is explicitly NOT stored

`shape_data` is bounded to 20KB
(`octet_length(shape_data::text) <= 20000`, enforced by a CHECK
constraint) specifically to guarantee nobody stores an image (a base64
photo, a scanned blueprint) in this column — it holds only point
coordinates and viewport metadata, never pixel/image data. There is no
blueprint or PDF upload/parsing anywhere in this phase.

## Known limitations

- **Rectangles only** — no polygons (see above).
- **One shape per session** — drawing a new rectangle replaces the
  previous one; there is no way to draw and calibrate multiple shapes
  before saving.
- **No moving individual points after drawing** — to change a drawn
  shape, draw a new one and save it as a new measurement; there is no
  "drag a corner to adjust" interaction.
- **No re-editing a saved sketch measurement** — `update_measurement()`
  explicitly rejects an attempt to edit a `sketch_rectangle`/
  `sketch_polygon` row's dimensions (the friendly error points the user
  back to the Draw layout tab to draw a replacement). Editing the
  *name*, *waste %*, or *notes* of a sketch-derived measurement is not
  exposed by `update_measurement()` either in this phase — only
  archive-and-recreate is supported for sketch measurements.
- **No blueprint/PDF upload, no AI shape detection** — explicitly out
  of scope, per the brief.
