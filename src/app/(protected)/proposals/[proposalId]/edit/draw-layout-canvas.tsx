"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { saveMeasurementShapeAction, saveMeasurementPolygonShapeAction } from "../../../../../actions/measurements";
import type { ActionResult } from "../../../../../actions/auth";
import { SubmitButton } from "../../../../../components/submit-button";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../../../../components/form-field-error";
import {
  computeRectangle,
  computePolygonArea,
  computePolygonPerimeter,
  computeMultiStrokeLinearLength,
  flattenStrokes,
  simplifyPolyline,
  scalePoints,
  type Point,
} from "../../../../../lib/proposals/measurements";
import type { Database } from "../../../../../../types/database";

type ProposalMeasurementGroup = Database["public"]["Tables"]["proposal_measurement_groups"]["Row"];

const initialState: ActionResult = {};

const VIEWPORT_WIDTH = 320;
const VIEWPORT_HEIGHT = 220;
/** Douglas-Peucker tolerance, in canvas pixels — see simplifyPolyline() and docs/47, "Point simplification." */
const SIMPLIFY_TOLERANCE_PX = 2;

type DrawingMode = "freehand" | "rectangle";

function GroupAndNameFields({
  measurementGroups,
  idPrefix,
  fieldErrors,
}: {
  measurementGroups: ProposalMeasurementGroup[];
  idPrefix: string;
  fieldErrors?: Record<string, string>;
}) {
  // `id="name"` (not `${idPrefix}Name`) deliberately matches the Zod
  // schema's field key exactly (path[0] === "name" for every schema this
  // form submits to) -- see zodIssuesToFieldErrors() and
  // fieldErrorProps()'s doc comment. Safe: Manual entry / Freehand /
  // Rectangle are mutually exclusive in the DOM (step-measurements.tsx
  // only ever mounts one at a time), so there is never an id collision.
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}GroupId`}>Group</label>
        {/* No `required` -- with no groups yet this select's only option is
            an empty placeholder; Save is no longer disabled just because
            of that (see handleSubmit in FreehandDrawForm/RectangleDrawForm),
            so an empty/missing group now reaches the same red-state UI as
            every other field instead of silently blocking the click with
            no explanation. */}
        <select
          id={`${idPrefix}GroupId`}
          name="measurementGroupId"
          disabled={measurementGroups.length === 0}
          {...fieldErrorProps(fieldErrors, "measurementGroupId")}
        >
          {measurementGroups.length === 0 ? <option value="">Create a group first (Manual entry tab)</option> : null}
          {measurementGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <FieldError fieldErrors={fieldErrors} id="measurementGroupId" />
      </div>
      <div className="field">
        <label htmlFor="name">Name</label>
        {/* No `required` -- an empty submit must reach our own server-side validation and inline red-state UI, not the browser's native popup. */}
        <input id="name" name="name" type="text" placeholder="e.g. Living room floor" {...fieldErrorProps(fieldErrors, "name")} />
        <FieldError fieldErrors={fieldErrors} id="name" />
      </div>
    </>
  );
}

/**
 * Freehand/brush drawing — the primary Draw layout mode (Phase 2C.1).
 * Captures one or more pointer-drag strokes as a flat point list, lets
 * the user explicitly close the shape (an area) or leave it open (a
 * linear path, e.g. a hand-traced trim run), simplifies the stroke with
 * Douglas-Peucker before submitting, and scales pixel coordinates to
 * real-world units using the drawing's bounding-box width and a
 * user-entered reference length — see docs/47-drawing-sketch-mode.md.
 */
function FreehandDrawForm({
  proposalId,
  proposalVersionId,
  measurementGroups,
  defaultUnit,
}: {
  proposalId: string;
  proposalVersionId: string;
  measurementGroups: ProposalMeasurementGroup[];
  defaultUnit: "ft" | "m";
}) {
  const [state, formAction] = useActionState(saveMeasurementPolygonShapeAction, initialState);
  const svgRef = useRef<SVGSVGElement>(null);
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [currentStroke, setCurrentStrokeState] = useState<Point[]>([]);
  // A fast drag fires many pointermove events in quick succession, faster
  // than React necessarily re-renders between them -- reading the
  // `currentStroke` state directly in handlePointerMove/Up risks a stale
  // closure that silently drops points. This ref mirrors it synchronously
  // so drag handling never depends on render timing; `currentStroke`
  // state still drives the live polyline redraw.
  const currentStrokeRef = useRef<Point[]>([]);
  const setCurrentStroke = (points: Point[]) => {
    currentStrokeRef.current = points;
    setCurrentStrokeState(points);
  };
  const [closed, setClosed] = useState(false);
  const [scaleReferenceLength, setScaleReferenceLength] = useState("10");
  const [scaleUnit, setScaleUnit] = useState<"ft" | "m">(defaultUnit);
  const [wastePercent, setWastePercent] = useState("0");
  const [measurementType, setMeasurementType] = useState("floor_area");

  function pointFromEvent(e: React.PointerEvent<SVGSVGElement>): Point {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - rect.left, 0), VIEWPORT_WIDTH);
    const y = Math.min(Math.max(e.clientY - rect.top, 0), VIEWPORT_HEIGHT);
    return { x, y };
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setClosed(false); // drawing more re-opens a previously-closed shape
    setCurrentStroke([pointFromEvent(e)]);
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (currentStrokeRef.current.length === 0) return;
    setCurrentStroke([...currentStrokeRef.current, pointFromEvent(e)]);
  }

  function handlePointerUp() {
    // Snapshot the ref's value into a plain local before resetting it below
    // -- setStrokes's functional updater is evaluated lazily during React's
    // render phase, by which point `currentStrokeRef.current` would already
    // have been reassigned to [] by setCurrentStroke([]) if read directly.
    const finishedStroke = currentStrokeRef.current;
    if (finishedStroke.length > 1) {
      setStrokes((prev) => [...prev, finishedStroke]);
    }
    setCurrentStroke([]);
  }

  // Strokes actually eligible to save (completed only -- the in-progress
  // stroke, if any, is included separately below for the LIVE preview
  // while dragging, but never submitted mid-drag since Save is disabled
  // whenever isDrawing is true).
  const isDrawing = currentStroke.length > 0;
  const displayStrokes = isDrawing ? [...strokes, currentStroke] : strokes;
  const totalPointCount = useMemo(() => strokes.reduce((n, s) => n + s.length, 0) + currentStroke.length, [strokes, currentStroke]);
  const hasEnoughPoints = closed ? totalPointCount >= 3 : strokes.some((s) => s.length >= 2) || currentStroke.length >= 2;

  // Douglas-Peucker runs PER STROKE, not on a flattened cross-stroke
  // array -- simplifying across the gap between two strokes would treat
  // that gap as if it were a real drawn segment. See docs/47,
  // "Multi-stroke drawing."
  const simplifiedStrokes = useMemo(
    () => strokes.map((s) => (s.length > 2 ? simplifyPolyline(s, SIMPLIFY_TOLERANCE_PX) : s)),
    [strokes]
  );

  const referenceLength = parseFloat(scaleReferenceLength) || 0;
  // The bounding box (for scale calibration) legitimately spans every
  // stroke, including the in-progress one -- this is purely "how wide is
  // everything drawn so far," not a geometry computation that could be
  // corrupted by a phantom cross-stroke edge.
  const boundingBoxPoints = useMemo(() => [...strokes.flat(), ...currentStroke], [strokes, currentStroke]);
  const boundingWidthPx =
    boundingBoxPoints.length > 0 ? Math.max(...boundingBoxPoints.map((p) => p.x)) - Math.min(...boundingBoxPoints.map((p) => p.x)) : 0;
  const pixelsPerUnit = boundingWidthPx > 0 && referenceLength > 0 ? boundingWidthPx / referenceLength : 0;

  let preview: { area: number | null; perimeter: number | null; linear: number | null } | null = null;
  let realStrokes: Point[][] = [];
  if (hasEnoughPoints && pixelsPerUnit > 0) {
    try {
      realStrokes = simplifiedStrokes.map((s) => scalePoints(s, pixelsPerUnit));
      if (closed) {
        const outline = flattenStrokes(realStrokes);
        preview = { area: computePolygonArea(outline), perimeter: computePolygonPerimeter(outline, true), linear: null };
      } else {
        preview = { area: null, perimeter: null, linear: computeMultiStrokeLinearLength(realStrokes) };
      }
    } catch {
      preview = null;
    }
  }

  const shapeData = JSON.stringify({
    type: "freehand",
    closed,
    strokeCount: strokes.length,
    strokes: simplifiedStrokes,
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
  });

  // The Save button used to be `disabled` whenever there was nothing drawn
  // yet, the reference length was missing/invalid, or no measurement
  // group existed yet -- which meant a click in any of those states did
  // NOTHING: no error, no red border, no explanation, since a disabled
  // button can't be clicked at all and the Server Action (the only thing
  // that ever populated `fieldErrors`) never ran. A real user hit exactly
  // this: drew a full shape, entered a reference length, but never
  // created a group first -- Save silently did nothing and "Continue to
  // Scope of Work" let them leave with the drawing un-saved and no
  // indication why. Save is now always clickable (except mid-drag); all
  // three blocking cases are instead caught HERE, client-side, before the
  // browser-level form submission — the same visual result (red border,
  // message, aria-invalid, focus) as a server round trip, just without
  // one, since the server has no way to know about pixel geometry it was
  // never sent, and a nonexistent group has nothing for it to validate.
  // `attemptedSubmit` keeps these hidden until the user actually tries to
  // save, and because they're recomputed every render (not "set once"),
  // fixing the underlying issue clears the red state immediately, before
  // a re-submit. `measurementGroups.length === 0` is a reliable signal
  // for "no group selected" without needing to track the uncontrolled
  // <select>'s own value: once at least one group exists, a native
  // <select> can never be left on its disabled placeholder option (the
  // browser auto-selects the first real option instead), so the only way
  // this field can actually be empty is if there's nothing to select at all.
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const clientFieldErrors: Record<string, string> = {};
  if (attemptedSubmit) {
    if (measurementGroups.length === 0) {
      clientFieldErrors.measurementGroupId = "Create a measurement group before saving.";
    } else if (!hasEnoughPoints) {
      clientFieldErrors.drawing = "Draw the area before saving.";
    } else if (referenceLength <= 0) {
      clientFieldErrors.scaleReferenceLength = "Enter a reference length greater than 0.";
    }
  }
  const fieldErrors: Record<string, string> = { ...state.fieldErrors, ...clientFieldErrors };
  const drawingFieldError = fieldErrors.drawing;
  useFocusFirstFieldError(fieldErrors);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    setAttemptedSubmit(true);
    if (measurementGroups.length === 0 || !hasEnoughPoints || referenceLength <= 0) {
      e.preventDefault();
    }
  }

  return (
    <div className="stack">
      <p className="hint">
        Draw the area&apos;s outline with your mouse or finger, like a pencil — one or more strokes. When you&apos;re done, either{" "}
        <strong>Close shape</strong> (for an area) or leave it open (for a linear path, e.g. a trim run), then enter a
        real-world reference length to scale it.
      </p>

      {/* `aria-invalid` lives on this wrapping div, not the <svg> itself --
          role="img" (correctly describing the drawing surface for screen
          readers) doesn't support aria-invalid per the ARIA spec, so the
          invalid-state semantics and the red border both move one level
          up instead of being dropped. */}
      <div
        id="drawing"
        // Programmatically focusable (a plain <div> isn't in the tab order
        // by default) so useFocusFirstFieldError's .focus() actually
        // scrolls the canvas into view and gives it a visible focus ring
        // when "Draw the area before saving." is the first/only error.
        tabIndex={-1}
        className={drawingFieldError ? "field-input-error" : undefined}
        style={{
          display: "inline-block",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius)",
          maxWidth: "100%",
          lineHeight: 0,
          // The app shell's topbar is `position: sticky; top: 0` (see
          // globals.css) -- without this, scrolling the canvas to the very
          // top of the viewport (e.g. a mobile browser's native
          // scroll-into-view on focus) tucks its top strip behind the
          // sticky header, silently swallowing touches/clicks there.
          scrollMarginTop: "calc(var(--topbar-height) + 12px)",
        }}
        aria-invalid={drawingFieldError ? true : undefined}
        aria-describedby={drawingFieldError ? "drawing-error" : undefined}
      >
        <svg
          ref={svgRef}
          width={VIEWPORT_WIDTH}
          height={VIEWPORT_HEIGHT}
          viewBox={`0 0 ${VIEWPORT_WIDTH} ${VIEWPORT_HEIGHT}`}
          style={{
            touchAction: "none",
            background: "var(--color-surface-alt, #f5f5f5)",
            maxWidth: "100%",
            display: "block",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          role="img"
          aria-label="Drawing surface — draw the area's outline with mouse or touch"
        >
          {closed ? (
          // Closing joins every stroke end-to-end, in drawn order, into
          // one outline -- only ever rendered once the user has
          // explicitly asked for that (Close shape), never automatically
          // while separate strokes are still just separate strokes. See
          // docs/47, "Multi-stroke drawing."
          <polygon
            points={flattenStrokes(strokes)
              .map((p) => `${p.x},${p.y}`)
              .join(" ")}
            fill="rgba(37, 99, 235, 0.15)"
            stroke="#2563eb"
            strokeWidth={2}
          />
        ) : (
          // NOT closed: each stroke renders as its OWN <polyline> -- the
          // actual fix for "the drawing feels like one continuous line."
          // Lifting the pen/finger between strokes never draws a
          // connecting segment.
          displayStrokes.map((stroke, i) =>
            stroke.length > 1 ? (
              <polyline
                key={i}
                points={stroke.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="#2563eb"
                strokeWidth={2}
              />
            ) : null
          )
        )}
        </svg>
      </div>

      <div className="tenant-form" style={{ width: "100%" }}>
        <button type="button" className="button-secondary" onClick={() => setStrokes((prev) => prev.slice(0, -1))} disabled={strokes.length === 0 || isDrawing}>
          Undo
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            setStrokes([]);
            setCurrentStroke([]);
            setClosed(false);
          }}
          disabled={strokes.length === 0 && !isDrawing}
        >
          Clear
        </button>
        <button
          type="button"
          className={closed ? "button-primary" : "button-secondary"}
          onClick={() => setClosed((prev) => !prev)}
          disabled={totalPointCount < 3 || isDrawing}
        >
          {closed ? "Shape closed ✓" : "Close shape"}
        </button>
      </div>
      {drawingFieldError ? (
        <p id="drawing-error" className="field-error-text" role="alert">
          {drawingFieldError}
        </p>
      ) : null}

      <form action={formAction} onSubmit={handleSubmit} noValidate className="stack">
        <input type="hidden" name="proposalVersionId" value={proposalVersionId} />
        <input type="hidden" name="proposalId" value={proposalId} />
        <input type="hidden" name="strokes" value={realStrokes.length > 0 ? JSON.stringify(realStrokes) : ""} />
        <input type="hidden" name="shapeData" value={shapeData} />
        <input type="hidden" name="closed" value={closed ? "true" : "false"} />
        <input type="hidden" name="unit" value={scaleUnit} />
        <input type="hidden" name="scaleUnit" value={scaleUnit} />
        <input type="hidden" name="measurementType" value={closed ? measurementType : "linear"} />

        {state.error ? <p className="error-banner">{state.error}</p> : null}
        {state.message ? <p className="success-banner">{state.message}</p> : null}

        <GroupAndNameFields measurementGroups={measurementGroups} idPrefix="freehand" fieldErrors={fieldErrors} />

        {closed ? (
          <div className="field">
            <label htmlFor="freehandMeasurementType">Measurement type</label>
            <select id="freehandMeasurementType" value={measurementType} onChange={(e) => setMeasurementType(e.target.value)}>
              <option value="floor_area">Floor area</option>
              <option value="ceiling_area">Ceiling area</option>
              <option value="surface">Surface</option>
              <option value="room">Room</option>
              <option value="custom">Custom</option>
            </select>
          </div>
        ) : (
          <p className="hint">Shape is not closed — this will be saved as a linear measurement (e.g. a trim/fencing run).</p>
        )}

        <div className="tenant-form" style={{ width: "100%" }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="freehandUnit">Unit</label>
            <select id="freehandUnit" value={scaleUnit} onChange={(e) => setScaleUnit(e.target.value as "ft" | "m")}>
              <option value="ft">Feet (ft)</option>
              <option value="m">Meters (m)</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="scaleReferenceLength">This drawing&apos;s width represents ({scaleUnit})</label>
            <input
              id="scaleReferenceLength"
              name="scaleReferenceLength"
              type="number"
              min={0.01}
              step={0.01}
              value={scaleReferenceLength}
              onChange={(e) => setScaleReferenceLength(e.target.value)}
              {...fieldErrorProps(fieldErrors, "scaleReferenceLength")}
            />
            <FieldError fieldErrors={fieldErrors} id="scaleReferenceLength" />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="freehandWaste">Waste %</label>
            <input
              id="freehandWaste"
              name="wastePercent"
              type="number"
              min={0}
              max={100}
              step={1}
              value={wastePercent}
              onChange={(e) => setWastePercent(e.target.value)}
            />
          </div>
        </div>
        <p className="hint">
          Tell Scopevia what the full width of your drawing represents in real life. For example, if the widest part of
          your sketch is 10 {scaleUnit === "ft" ? "ft" : "m"} wide, enter 10.
        </p>

        {preview ? (
          <div className="metric-tile unsaved-preview-tile" style={{ maxWidth: 400 }}>
            <div className="metric-tile-value">
              {preview.area != null ? `${preview.area.toFixed(2)} sq ${scaleUnit}` : `${preview.linear!.toFixed(2)} ${scaleUnit}`}
            </div>
            <div className="metric-tile-label">
              <strong>Not saved yet.</strong>
              {preview.perimeter != null ? ` Perimeter: ${preview.perimeter.toFixed(2)} ${scaleUnit}.` : ""}
            </div>
          </div>
        ) : (
          <p className="hint">Draw a shape, close it (or leave it open for a linear path), and enter its reference width to see the calculated area/length.</p>
        )}

        {/* Deliberately NOT disabled just because there's no group yet,
            no drawing yet, or the reference length is invalid -- those
            are exactly the three things this button's own click is
            supposed to surface as a red-state error (see handleSubmit
            above). A disabled button can't be clicked at all, so gating
            on them here would silently swallow the click with no
            explanation, same as the removed `required` attribute
            elsewhere in this app. Only mid-drag stays a real block. */}
        <SubmitButton pendingText="Saving…" className="button-primary" disabled={isDrawing}>
          Save drawn measurement
        </SubmitButton>
      </form>
    </div>
  );
}

/**
 * Rectangle mode — kept as a secondary option for simple rectangular
 * rooms (the brief's explicit instruction: don't force-remove it). See
 * docs/47-drawing-sketch-mode.md.
 */
function RectangleDrawForm({
  proposalId,
  proposalVersionId,
  measurementGroups,
  defaultUnit,
}: {
  proposalId: string;
  proposalVersionId: string;
  measurementGroups: ProposalMeasurementGroup[];
  defaultUnit: "ft" | "m";
}) {
  const [state, formAction] = useActionState(saveMeasurementShapeAction, initialState);
  const svgRef = useRef<SVGSVGElement>(null);
  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);
  const [scaleReferenceLength, setScaleReferenceLength] = useState("10");
  const [scaleUnit, setScaleUnit] = useState<"ft" | "m">(defaultUnit);
  const [wastePercent, setWastePercent] = useState("0");

  function pointFromEvent(e: React.PointerEvent<SVGSVGElement>): Point {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - rect.left, 0), VIEWPORT_WIDTH);
    const y = Math.min(Math.max(e.clientY - rect.top, 0), VIEWPORT_HEIGHT);
    return { x, y };
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointFromEvent(e);
    setStart(p);
    setCurrent(p);
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!start) return;
    setCurrent(pointFromEvent(e));
  }

  function handlePointerUp() {
    // Drawing stays finalized in start/current — nothing else to do; a
    // new drag simply overwrites both, replacing the single rectangle.
  }

  const pixelWidth = start && current ? Math.abs(current.x - start.x) : 0;
  const pixelHeight = start && current ? Math.abs(current.y - start.y) : 0;
  const rectX = start && current ? Math.min(start.x, current.x) : 0;
  const rectY = start && current ? Math.min(start.y, current.y) : 0;
  const hasShape = pixelWidth > 4 && pixelHeight > 4;

  const referenceLength = parseFloat(scaleReferenceLength) || 0;
  const pixelsPerUnit = hasShape && referenceLength > 0 ? pixelWidth / referenceLength : 0;
  const realWidth = referenceLength;
  const realHeight = pixelsPerUnit > 0 ? pixelHeight / pixelsPerUnit : 0;

  let preview: { area: number; perimeter: number } | null = null;
  try {
    if (hasShape && realWidth > 0 && realHeight > 0) {
      preview = computeRectangle(realWidth, realHeight);
    }
  } catch {
    preview = null;
  }

  const shapeData = hasShape
    ? JSON.stringify({
        type: "rectangle",
        points: [
          { x: rectX, y: rectY },
          { x: rectX + pixelWidth, y: rectY },
          { x: rectX + pixelWidth, y: rectY + pixelHeight },
          { x: rectX, y: rectY + pixelHeight },
        ],
        viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      })
    : "";

  // Same fix as FreehandDrawForm above: Save used to be `disabled` whenever
  // nothing was drawn OR no measurement group existed yet, so a click in
  // either state did nothing visible at all -- a real user hit exactly
  // this (drew a shape, set a reference length, but never created a
  // group first) and had no idea why Save wasn't working. Now always
  // clickable (bar mid-drag); both cases are instead caught client-side
  // and shown the same way a server error would be. (Submitting an empty
  // rectangle to the server was also considered, but shapeData="" fails
  // JSON.parse() server-side and surfaces a generic, non-field-specific
  // "Invalid drawing data" — strictly worse than catching it here with a
  // real field-level message.)
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const clientFieldErrors: Record<string, string> = {};
  if (attemptedSubmit) {
    if (measurementGroups.length === 0) {
      clientFieldErrors.measurementGroupId = "Create a measurement group before saving.";
    } else if (!hasShape) {
      clientFieldErrors.drawing = "Draw the area before saving.";
    }
  }
  const fieldErrors: Record<string, string> = { ...state.fieldErrors, ...clientFieldErrors };
  const drawingFieldError = fieldErrors.drawing;
  useFocusFirstFieldError(fieldErrors);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    setAttemptedSubmit(true);
    if (measurementGroups.length === 0 || !hasShape) {
      e.preventDefault();
    }
  }

  return (
    <div className="stack">
      <p className="hint">Drag on the grid below to draw a rectangle (mouse or touch), then enter the real-world length of its width to scale it.</p>

      {/* aria-invalid lives on this wrapping div, not the <svg> itself --
          role="img" doesn't support aria-invalid per the ARIA spec. */}
      <div
        id="drawing"
        tabIndex={-1}
        className={drawingFieldError ? "field-input-error" : undefined}
        style={{
          display: "inline-block",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius)",
          maxWidth: "100%",
          lineHeight: 0,
          scrollMarginTop: "calc(var(--topbar-height) + 12px)",
        }}
        aria-invalid={drawingFieldError ? true : undefined}
        aria-describedby={drawingFieldError ? "drawing-error" : undefined}
      >
        <svg
          ref={svgRef}
          width={VIEWPORT_WIDTH}
          height={VIEWPORT_HEIGHT}
          viewBox={`0 0 ${VIEWPORT_WIDTH} ${VIEWPORT_HEIGHT}`}
          style={{
            touchAction: "none",
            background: "var(--color-surface-alt, #f5f5f5)",
            maxWidth: "100%",
            display: "block",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          role="img"
          aria-label="Drawing surface — drag to draw a rectangle"
        >
          {hasShape ? (
            <rect x={rectX} y={rectY} width={pixelWidth} height={pixelHeight} fill="rgba(37, 99, 235, 0.15)" stroke="#2563eb" strokeWidth={2} />
          ) : null}
        </svg>
      </div>
      {drawingFieldError ? (
        <p id="drawing-error" className="field-error-text" role="alert">
          {drawingFieldError}
        </p>
      ) : null}

      <form action={formAction} onSubmit={handleSubmit} noValidate className="stack">
        <input type="hidden" name="proposalVersionId" value={proposalVersionId} />
        <input type="hidden" name="proposalId" value={proposalId} />
        <input type="hidden" name="shapeData" value={shapeData} />

        {state.error ? <p className="error-banner">{state.error}</p> : null}
        {state.message ? <p className="success-banner">{state.message}</p> : null}

        <GroupAndNameFields measurementGroups={measurementGroups} idPrefix="drawRect" fieldErrors={fieldErrors} />

        <div className="tenant-form" style={{ width: "100%" }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="drawMeasurementType">Measurement type</label>
            <select id="drawMeasurementType" name="measurementType" defaultValue="floor_area">
              <option value="floor_area">Floor area</option>
              <option value="ceiling_area">Ceiling area</option>
              <option value="surface">Surface</option>
              <option value="room">Room</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="drawUnit">Unit</label>
            <select id="drawUnit" name="unit" value={scaleUnit} onChange={(e) => setScaleUnit(e.target.value as "ft" | "m")}>
              <option value="ft">Feet (ft)</option>
              <option value="m">Meters (m)</option>
            </select>
          </div>
        </div>

        <div className="tenant-form" style={{ width: "100%" }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="scaleReferenceLength">Real-world width ({scaleUnit})</label>
            <input
              id="scaleReferenceLength"
              name="scaleReferenceLength"
              type="number"
              min={0.01}
              step={0.01}
              value={scaleReferenceLength}
              onChange={(e) => setScaleReferenceLength(e.target.value)}
              {...fieldErrorProps(fieldErrors, "scaleReferenceLength")}
            />
            <FieldError fieldErrors={fieldErrors} id="scaleReferenceLength" />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="drawWaste">Waste %</label>
            <input
              id="drawWaste"
              name="wastePercent"
              type="number"
              min={0}
              max={100}
              step={1}
              value={wastePercent}
              onChange={(e) => setWastePercent(e.target.value)}
            />
          </div>
        </div>
        <input type="hidden" name="scaleUnit" value={scaleUnit} />
        <input type="hidden" name="length" value={realWidth || ""} />
        <input type="hidden" name="width" value={realHeight || ""} />
        <p className="hint">
          Tell Scopevia what the width of your rectangle represents in real life. For example, if it&apos;s a 10{" "}
          {scaleUnit === "ft" ? "ft" : "m"} wide room, enter 10.
        </p>

        {preview ? (
          <div className="metric-tile unsaved-preview-tile" style={{ maxWidth: 360 }}>
            <div className="metric-tile-value">
              {preview.area.toFixed(2)} sq {scaleUnit}
            </div>
            <div className="metric-tile-label">
              <strong>Not saved yet.</strong> Perimeter: {preview.perimeter.toFixed(2)} {scaleUnit}
            </div>
          </div>
        ) : (
          <p className="hint">Draw a rectangle and enter its real-world width to see the calculated area.</p>
        )}

        {/* Not disabled on `!hasShape` or `measurementGroups.length === 0` --
            same reasoning as FreehandDrawForm's Save button above. */}
        <SubmitButton pendingText="Saving…" className="button-primary">
          Save drawn measurement
        </SubmitButton>
      </form>
    </div>
  );
}

export function DrawLayoutCanvas({
  proposalId,
  proposalVersionId,
  measurementGroups,
  defaultUnit,
}: {
  proposalId: string;
  proposalVersionId: string;
  measurementGroups: ProposalMeasurementGroup[];
  defaultUnit: "ft" | "m";
}) {
  const [drawingMode, setDrawingMode] = useState<DrawingMode>("freehand");

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="drawingMode">Drawing mode</label>
        <select id="drawingMode" value={drawingMode} onChange={(e) => setDrawingMode(e.target.value as DrawingMode)}>
          <option value="freehand">Freehand (recommended) — best for bathrooms, kitchens, patios, and other irregular spaces</option>
          <option value="rectangle">Rectangle — best for simple rectangular rooms</option>
        </select>
      </div>

      {drawingMode === "freehand" ? (
        <FreehandDrawForm proposalId={proposalId} proposalVersionId={proposalVersionId} measurementGroups={measurementGroups} defaultUnit={defaultUnit} />
      ) : (
        <RectangleDrawForm proposalId={proposalId} proposalVersionId={proposalVersionId} measurementGroups={measurementGroups} defaultUnit={defaultUnit} />
      )}

      <p className="hint">
        <strong>Limitations:</strong> one shape at a time (drawing again replaces it before saving), no moving individual
        points after drawing, and a saved drawing&apos;s dimensions can&apos;t be edited in place — archive it and draw a
        replacement instead. See docs/47-drawing-sketch-mode.md.
      </p>
    </div>
  );
}
