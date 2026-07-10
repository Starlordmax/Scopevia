"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { saveMeasurementShapeAction, saveMeasurementPolygonShapeAction } from "../../../../../actions/measurements";
import type { ActionResult } from "../../../../../actions/auth";
import { SubmitButton } from "../../../../../components/submit-button";
import { computeRectangle, computePolygonArea, computePolygonPerimeter, simplifyPolyline, scalePoints, type Point } from "../../../../../lib/proposals/measurements";
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
}: {
  measurementGroups: ProposalMeasurementGroup[];
  idPrefix: string;
}) {
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}GroupId`}>Group</label>
        <select id={`${idPrefix}GroupId`} name="measurementGroupId" required disabled={measurementGroups.length === 0}>
          {measurementGroups.length === 0 ? <option value="">Create a group first (Manual entry tab)</option> : null}
          {measurementGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}Name`}>Name</label>
        <input id={`${idPrefix}Name`} name="name" type="text" required placeholder="e.g. Living room floor" />
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

  const rawPoints = useMemo(() => [...strokes.flat(), ...currentStroke], [strokes, currentStroke]);
  const isDrawing = currentStroke.length > 0;
  const hasEnoughPoints = rawPoints.length >= (closed ? 3 : 2);

  const simplifiedPoints = useMemo(
    () => (rawPoints.length > 2 ? simplifyPolyline(rawPoints, SIMPLIFY_TOLERANCE_PX) : rawPoints),
    [rawPoints]
  );

  const referenceLength = parseFloat(scaleReferenceLength) || 0;
  const boundingWidthPx = rawPoints.length > 0 ? Math.max(...rawPoints.map((p) => p.x)) - Math.min(...rawPoints.map((p) => p.x)) : 0;
  const pixelsPerUnit = boundingWidthPx > 0 && referenceLength > 0 ? boundingWidthPx / referenceLength : 0;

  let preview: { area: number | null; perimeter: number | null; linear: number | null } | null = null;
  let realPoints: Point[] = [];
  if (hasEnoughPoints && pixelsPerUnit > 0) {
    try {
      realPoints = scalePoints(simplifiedPoints, pixelsPerUnit);
      if (closed) {
        preview = { area: computePolygonArea(realPoints), perimeter: computePolygonPerimeter(realPoints, true), linear: null };
      } else {
        preview = { area: null, perimeter: null, linear: computePolygonPerimeter(realPoints, false) };
      }
    } catch {
      preview = null;
    }
  }

  const polylineStr = rawPoints.map((p) => `${p.x},${p.y}`).join(" ");
  const shapeData = JSON.stringify({
    type: "freehand",
    closed,
    strokeCount: strokes.length,
    points: simplifiedPoints,
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
  });

  return (
    <div className="stack">
      <p className="hint">
        Draw the area&apos;s outline with your mouse or finger, like a pencil — one or more strokes. When you&apos;re done, either{" "}
        <strong>Close shape</strong> (for an area) or leave it open (for a linear path, e.g. a trim run), then enter a
        real-world reference length to scale it.
      </p>

      <svg
        ref={svgRef}
        width={VIEWPORT_WIDTH}
        height={VIEWPORT_HEIGHT}
        viewBox={`0 0 ${VIEWPORT_WIDTH} ${VIEWPORT_HEIGHT}`}
        style={{
          touchAction: "none",
          background: "var(--color-surface-alt, #f5f5f5)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius)",
          maxWidth: "100%",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        role="img"
        aria-label="Drawing surface — draw the area's outline with mouse or touch"
      >
        {rawPoints.length > 1 ? (
          closed ? (
            <polygon points={polylineStr} fill="rgba(37, 99, 235, 0.15)" stroke="#2563eb" strokeWidth={2} />
          ) : (
            <polyline points={polylineStr} fill="none" stroke="#2563eb" strokeWidth={2} />
          )
        ) : null}
      </svg>

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
          disabled={rawPoints.length < 3 || isDrawing}
        >
          {closed ? "Shape closed ✓" : "Close shape"}
        </button>
      </div>

      <form action={formAction} className="stack">
        <input type="hidden" name="proposalVersionId" value={proposalVersionId} />
        <input type="hidden" name="proposalId" value={proposalId} />
        <input type="hidden" name="points" value={realPoints.length > 0 ? JSON.stringify(realPoints) : ""} />
        <input type="hidden" name="shapeData" value={shapeData} />
        <input type="hidden" name="closed" value={closed ? "true" : "false"} />
        <input type="hidden" name="unit" value={scaleUnit} />
        <input type="hidden" name="scaleUnit" value={scaleUnit} />
        <input type="hidden" name="measurementType" value={closed ? measurementType : "linear"} />

        {state.error ? <p className="error-banner">{state.error}</p> : null}

        <GroupAndNameFields measurementGroups={measurementGroups} idPrefix="freehand" />

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
            <label htmlFor="freehandScaleReferenceLength">This drawing&apos;s width represents ({scaleUnit})</label>
            <input
              id="freehandScaleReferenceLength"
              name="scaleReferenceLength"
              type="number"
              min={0.01}
              step={0.01}
              value={scaleReferenceLength}
              onChange={(e) => setScaleReferenceLength(e.target.value)}
              required
            />
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

        <SubmitButton pendingText="Saving…" className="button-primary" disabled={!hasEnoughPoints || pixelsPerUnit <= 0 || measurementGroups.length === 0 || isDrawing}>
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

  return (
    <div className="stack">
      <p className="hint">Drag on the grid below to draw a rectangle (mouse or touch), then enter the real-world length of its width to scale it.</p>

      <svg
        ref={svgRef}
        width={VIEWPORT_WIDTH}
        height={VIEWPORT_HEIGHT}
        viewBox={`0 0 ${VIEWPORT_WIDTH} ${VIEWPORT_HEIGHT}`}
        style={{ touchAction: "none", background: "var(--color-surface-alt, #f5f5f5)", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", maxWidth: "100%" }}
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

      <form action={formAction} className="stack">
        <input type="hidden" name="proposalVersionId" value={proposalVersionId} />
        <input type="hidden" name="proposalId" value={proposalId} />
        <input type="hidden" name="shapeData" value={shapeData} />

        {state.error ? <p className="error-banner">{state.error}</p> : null}

        <GroupAndNameFields measurementGroups={measurementGroups} idPrefix="drawRect" />

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
            <label htmlFor="drawScaleReferenceLength">Real-world width ({scaleUnit})</label>
            <input
              id="drawScaleReferenceLength"
              name="scaleReferenceLength"
              type="number"
              min={0.01}
              step={0.01}
              value={scaleReferenceLength}
              onChange={(e) => setScaleReferenceLength(e.target.value)}
              required
            />
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

        <SubmitButton pendingText="Saving…" className="button-primary" disabled={!hasShape || measurementGroups.length === 0}>
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
          <option value="freehand">Freehand (recommended) — for irregular rooms, L-shapes, patios</option>
          <option value="rectangle">Rectangle — for simple rectangular rooms</option>
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
