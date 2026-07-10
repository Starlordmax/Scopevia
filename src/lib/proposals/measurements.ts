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
