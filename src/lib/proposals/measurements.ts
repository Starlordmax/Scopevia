/**
 * Pure TypeScript mirror of the measurement calculation engine
 * implemented in PL/pgSQL (add_measurement(), save_measurement_shape(),
 * generate_material_from_measurement(),
 * add_proposal_labor_item_from_measurement() — see
 * supabase/migrations/20260709140200_measurement_functions.sql and
 * 20260709140100_labor_area_linear_pricing.sql).
 *
 * This is a UI-ONLY MIRROR, NOT THE AUTHORITY — exactly like
 * src/lib/proposals/calculations.ts. It exists so the Measurements step
 * can show a live, instant preview while typing. The value that is
 * actually saved and used for material/labor generation always comes
 * back from the server-side functions above. If this file and the SQL
 * ever disagree, the SQL wins.
 *
 * Units: length/width/height/perimeter/linear_length are plain numbers
 * in whichever base unit (ft or m) the measurement uses — this module
 * never converts between unit systems (see docs/46, "Units"). Money:
 * integer cents. Percentages: integer basis points (10000 = 100%).
 * Rounding: dimensions round to 2 decimal places; see docs/46-measurement-calculation-engine.md
 * for the full table (including which material units round up vs. to
 * 2 decimals).
 */

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function requirePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than zero`);
  }
}

/** area = length x width; perimeter = 2 x (length + width). Both rounded to 2 decimals. */
export function computeRectangle(length: number, width: number): { area: number; perimeter: number } {
  requirePositive(length, "Length");
  requirePositive(width, "Width");
  return {
    area: roundTo(length * width, 2),
    perimeter: roundTo(2 * (length + width), 2),
  };
}

/** wall_area = perimeter x height (docs/46, "Room wall area"). length/width describe the room's floor footprint, used only to derive the perimeter. */
export function computeWallArea(length: number, width: number, height: number): { area: number; perimeter: number } {
  requirePositive(length, "Length");
  requirePositive(width, "Width");
  requirePositive(height, "Height");
  const perimeter = roundTo(2 * (length + width), 2);
  return {
    area: roundTo(perimeter * height, 2),
    perimeter,
  };
}

/** quantity_with_waste = base_quantity x (1 + waste_bps / 10000). */
export function applyWaste(baseQuantity: number, wasteBps: number): number {
  if (wasteBps < 0 || wasteBps > 10000) {
    throw new Error("Waste percentage must be between 0% and 100%");
  }
  return baseQuantity * (1 + wasteBps / 10000);
}

/** Units a contractor buys as whole, discrete containers -- round up, never fractional. Continuous units (sq ft, linear ft, fixed) round to 2 decimals instead. */
const DISCRETE_UNITS = new Set(["gallon", "each", "day", "hour"]);

export type MaterialQuantityInput = {
  /** The measured value (area, perimeter, or linear_length) this material is calculated from. */
  measurementValue: number;
  /** How much of the measured value one unit of material covers, e.g. 350 (sq ft per gallon), or 1 for a direct 1:1 material like tile. */
  coverageRate: number;
  /** Number of coats (paint); 1 for materials with no "coats" concept. */
  coats: number;
  wasteBps: number;
  /** The material's default_unit — decides rounding (see DISCRETE_UNITS above). */
  unit: string;
};

/**
 * quantity = measurementValue x coats x (1 + wasteBps/10000) / coverageRate,
 * rounded per docs/46's table. Mirrors generate_material_from_measurement()
 * exactly, including its rounding rule.
 */
export function computeMaterialQuantity(input: MaterialQuantityInput): number {
  requirePositive(input.measurementValue, "Measurement value");
  requirePositive(input.coverageRate, "Coverage rate");
  if (input.coats <= 0 || input.coats > 20) {
    throw new Error("Coats must be between 1 and 20");
  }
  if (input.wasteBps < 0 || input.wasteBps > 10000) {
    throw new Error("Waste percentage must be between 0% and 100%");
  }

  const rawQuantity = (input.measurementValue * input.coats * (1 + input.wasteBps / 10000)) / input.coverageRate;
  return DISCRETE_UNITS.has(input.unit) ? Math.ceil(rawQuantity) : roundTo(rawQuantity, 2);
}

/** total_cents = round(measured_area * rate_cents). */
export function computeAreaLaborTotalCents(measuredArea: number, ratePerAreaCents: number): number {
  requirePositive(measuredArea, "Measured area");
  return Math.round(measuredArea * ratePerAreaCents);
}

/** total_cents = round(measured_linear_length * rate_cents). */
export function computeLinearLaborTotalCents(measuredLinearLength: number, ratePerLinearCents: number): number {
  requirePositive(measuredLinearLength, "Measured linear length");
  return Math.round(measuredLinearLength * ratePerLinearCents);
}

/** ceil((area * coats * wasteFactor) / coveragePerGallon) — the brief's paint-gallons worked example, expressed via computeMaterialQuantity with unit="gallon". */
export function computePaintGallons(areaSqFt: number, coats: number, wasteBps: number, coveragePerGallon: number): number {
  return computeMaterialQuantity({ measurementValue: areaSqFt, coverageRate: coveragePerGallon, coats, wasteBps, unit: "gallon" });
}

// =============================================================================
// Phase 2C.1: freehand/brush drawing — polygon geometry. Mirrors
// save_measurement_polygon_shape() (20260710100000_measurement_freehand_polygon.sql)
// exactly: the shoelace formula for a closed shape's area, plain edge-length
// summation for perimeter (closed) or linear_length (open path, no wrap-around
// edge). See docs/46-measurement-calculation-engine.md, "Freehand polygon
// geometry".
// =============================================================================

export type Point = { x: number; y: number };

/** Shoelace formula: area = |sum(x_i * y_(i+1) - x_(i+1) * y_i)| / 2, wrapping the last point back to the first. Requires at least 3 points and a non-degenerate (non-collinear) shape. */
export function computePolygonArea(points: Point[]): number {
  if (points.length < 3) {
    throw new Error("A closed shape needs at least 3 points");
  }
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const { x: x1, y: y1 } = points[i]!;
    const { x: x2, y: y2 } = points[(i + 1) % points.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  const area = Math.abs(sum) / 2;
  if (area <= 0) {
    throw new Error("The drawn shape has no area -- points may be collinear or too close together");
  }
  return roundTo(area, 2);
}

/**
 * Sums consecutive edge lengths. `closed=true` (an area shape) includes the
 * final edge back to point 0, matching `computePolygonArea`'s perimeter;
 * `closed=false` (an open linear path, e.g. a hand-traced trim run) sums only
 * the n-1 drawn segments, with no wrap-around edge and no implied area.
 */
export function computePolygonPerimeter(points: Point[], closed: boolean): number {
  if (closed && points.length < 3) {
    throw new Error("A closed shape needs at least 3 points");
  }
  if (!closed && points.length < 2) {
    throw new Error("A linear path needs at least 2 points");
  }
  const edgeCount = closed ? points.length : points.length - 1;
  let sum = 0;
  for (let i = 0; i < edgeCount; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  if (sum <= 0) {
    throw new Error("The drawn shape has no length -- points may be too close together");
  }
  return roundTo(sum, 2);
}

/** Perpendicular distance from `point` to the infinite line through `lineStart`/`lineEnd` (or to `lineStart` itself if they coincide). */
function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
  }
  const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy);
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;
  return Math.hypot(point.x - projX, point.y - projY);
}

/**
 * Douglas-Peucker polyline simplification: recursively keeps only the point
 * furthest from the line connecting a segment's endpoints (if that distance
 * exceeds `tolerancePx`), discarding everything else — the standard,
 * well-understood algorithm for "reduce a hand-drawn stroke's point count
 * without visibly deforming its shape" (see docs/47-drawing-sketch-mode.md,
 * "Point simplification"). `tolerancePx` is in the same pixel units as the
 * input points (applied before scaling to real-world units).
 */
export function simplifyPolyline(points: Point[], tolerancePx: number): Point[] {
  if (points.length <= 2) return points;

  let maxDistance = 0;
  let maxIndex = 0;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i]!, first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  if (maxDistance > tolerancePx) {
    const left = simplifyPolyline(points.slice(0, maxIndex + 1), tolerancePx);
    const right = simplifyPolyline(points.slice(maxIndex), tolerancePx);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

/** Converts an array of pixel-space points to real-world units using a pixels-per-unit scale factor (the same scale the rectangle mode derives from its reference length). */
export function scalePoints(points: Point[], pixelsPerUnit: number): Point[] {
  requirePositive(pixelsPerUnit, "Scale");
  return points.map((p) => ({ x: p.x / pixelsPerUnit, y: p.y / pixelsPerUnit }));
}

// =============================================================================
// Multi-stroke drawing (bug fix — see docs/74-custom-service-name-and-multistroke-drawing.md).
// A freehand drawing is one or more independent strokes (the user lifts
// the pen/finger between them). These mirror
// save_measurement_polygon_shape()'s multi-stroke handling exactly:
//   - CLOSED (area): strokes are joined end-to-end in drawn order into
//     one outline — flattenStrokes() below, then the existing
//     computePolygonArea()/computePolygonPerimeter(..., true).
//   - OPEN (linear): each stroke's own length is summed independently —
//     computeMultiStrokeLinearLength() below — NEVER a phantom edge
//     connecting the last point of one stroke to the first point of the
//     next (that gap is where the pen/finger lifted, not a drawn line).
//     This is the actual fix for the reported "strokes auto-connect" bug.
// =============================================================================

/** Joins every stroke's points end-to-end, in drawn order, into one flat outline — the deliberately simple "close shape" strategy for a multi-stroke area (see docs/47, "Multi-stroke drawing"). */
export function flattenStrokes(strokes: Point[][]): Point[] {
  return strokes.flat();
}

/**
 * Sums each stroke's own consecutive-edge length independently, then adds
 * those sums together — a stroke with fewer than 2 points contributes 0
 * (a stray tap, not a drawn segment). Mirrors
 * save_measurement_polygon_shape()'s OPEN-path loop exactly.
 */
export function computeMultiStrokeLinearLength(strokes: Point[][]): number {
  const total = strokes.reduce((sum, stroke) => (stroke.length >= 2 ? sum + computePolygonPerimeter(stroke, false) : sum), 0);
  if (total <= 0) {
    throw new Error("The drawn path has no length -- points may be too close together");
  }
  return roundTo(total, 2);
}
