"use client";

import { useActionState, useRef, useState } from "react";
import { saveMeasurementShapeAction } from "../../../../../actions/measurements";
import type { ActionResult } from "../../../../../actions/auth";
import { SubmitButton } from "../../../../../components/submit-button";
import { computeRectangle } from "../../../../../lib/proposals/measurements";
import type { Database } from "../../../../../../types/database";

type ProposalMeasurementGroup = Database["public"]["Tables"]["proposal_measurement_groups"]["Row"];

const initialState: ActionResult = {};

const VIEWPORT_WIDTH = 320;
const VIEWPORT_HEIGHT = 220;

type Point = { x: number; y: number };

/**
 * A plain SVG rectangle drawer — no canvas library. Justification (per
 * the brief's requirement to justify any drawing dependency): a
 * construction-takeoff CAD library (Fabric.js, Konva, react-konva, etc.)
 * is 100KB+ minified, brings its own event/rendering model to keep in
 * sync with React, and solves problems (multi-shape editing, layers,
 * undo stacks) this phase explicitly does not need — rectangle-only, one
 * shape at a time (see docs/47-drawing-sketch-mode.md, "Why rectangles
 * only"). The Pointer Events API (onPointerDown/Move/Up) already unifies
 * mouse and touch with zero extra code, and SVG's own <rect> is simpler
 * to keep in sync with React state than a <canvas> 2D context (no manual
 * redraw loop). Total added dependency: none.
 */
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
      <p className="hint">
        Drag on the grid below to draw a rectangle (mouse or touch), then enter the real-world length of its width to scale it.
        Rectangles only in this phase — see the note at the bottom.
      </p>

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

        <div className="field">
          <label htmlFor="drawGroupId">Group</label>
          <select id="drawGroupId" name="measurementGroupId" required disabled={measurementGroups.length === 0}>
            {measurementGroups.length === 0 ? <option value="">Create a group first (Manual entry tab)</option> : null}
            {measurementGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="drawName">Name</label>
          <input id="drawName" name="name" type="text" required placeholder="e.g. Living room floor" />
        </div>

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

      <p className="hint">
        <strong>Limitation:</strong> this phase supports one rectangle at a time — no multi-shape polygons, no moving individual
        points after drawing. Draw again to replace the shape before saving. See docs/47-drawing-sketch-mode.md.
      </p>
    </div>
  );
}
