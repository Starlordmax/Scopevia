import { describe, expect, it } from "vitest";
import {
  computeRectangle,
  computeWallArea,
  applyWaste,
  computeMaterialQuantity,
  computeAreaLaborTotalCents,
  computeLinearLaborTotalCents,
  computePaintGallons,
  computePolygonArea,
  computePolygonPerimeter,
  simplifyPolyline,
  scalePoints,
  type Point,
} from "../../src/lib/proposals/measurements";

describe("computeRectangle", () => {
  it("area = length x width, perimeter = 2 x (length + width)", () => {
    const { area, perimeter } = computeRectangle(10, 8);
    expect(area).toBe(80);
    expect(perimeter).toBe(36);
  });

  it("rounds to 2 decimal places", () => {
    const { area, perimeter } = computeRectangle(10.333, 8.111);
    expect(area).toBe(83.81); // 10.333 * 8.111 = 83.810963, rounded
    expect(perimeter).toBe(36.89); // 2*(10.333+8.111)=36.888, rounded
  });

  it("rejects zero length", () => {
    expect(() => computeRectangle(0, 8)).toThrow("Length must be greater than zero");
  });

  it("rejects negative width", () => {
    expect(() => computeRectangle(10, -8)).toThrow("Width must be greater than zero");
  });

  it("rejects NaN", () => {
    expect(() => computeRectangle(NaN, 8)).toThrow();
  });
});

describe("computeWallArea", () => {
  it("wall_area = perimeter x height (the brief's Bathroom worked example: 10x8 room, 9ft ceiling)", () => {
    const { area, perimeter } = computeWallArea(10, 8, 9);
    expect(perimeter).toBe(36);
    expect(area).toBe(324); // 36 * 9
  });

  it("rejects zero height", () => {
    expect(() => computeWallArea(10, 8, 0)).toThrow("Height must be greater than zero");
  });

  it("rejects negative dimensions", () => {
    expect(() => computeWallArea(-10, 8, 9)).toThrow();
  });
});

describe("applyWaste", () => {
  it("quantity_with_waste = base_quantity x (1 + waste_bps / 10000)", () => {
    expect(applyWaste(300, 1000)).toBeCloseTo(330, 5); // 10% waste
  });

  it("zero waste leaves quantity unchanged", () => {
    expect(applyWaste(300, 0)).toBe(300);
  });

  it("100% waste doubles the quantity", () => {
    expect(applyWaste(300, 10000)).toBe(600);
  });

  it("rejects waste over 100%", () => {
    expect(() => applyWaste(300, 10001)).toThrow("Waste percentage must be between 0% and 100%");
  });

  it("rejects negative waste", () => {
    expect(() => applyWaste(300, -1)).toThrow();
  });
});

describe("computeMaterialQuantity", () => {
  it("the brief's paint gallons worked example: 600 sq ft, coverage 350 sq ft/gal, 2 coats, 10% waste", () => {
    // ceil((600 * 2 * 1.10) / 350) = ceil(1320/350) = ceil(3.77) = 4
    const qty = computeMaterialQuantity({ measurementValue: 600, coverageRate: 350, coats: 2, wasteBps: 1000, unit: "gallon" });
    expect(qty).toBe(4);
  });

  it("the brief's flooring worked example: 300 sq ft floor, 10% waste, 1:1 coverage -> 330 required", () => {
    const qty = computeMaterialQuantity({ measurementValue: 300, coverageRate: 1, coats: 1, wasteBps: 1000, unit: "sq_ft" });
    expect(qty).toBe(330);
  });

  it("discrete units (gallon/each/day/hour) round UP, never fractional", () => {
    const qty = computeMaterialQuantity({ measurementValue: 80, coverageRate: 350, coats: 2, wasteBps: 1000, unit: "gallon" });
    // 80*2*1.1/350 = 176/350 = 0.5028... -> ceil -> 1
    expect(qty).toBe(1);
    expect(Number.isInteger(qty)).toBe(true);
  });

  it("continuous units (sq_ft/linear_ft/fixed) round to 2 decimals, can be fractional", () => {
    const qty = computeMaterialQuantity({ measurementValue: 33.333, coverageRate: 1, coats: 1, wasteBps: 0, unit: "sq_ft" });
    expect(qty).toBe(33.33);
  });

  it("rejects zero measurement value", () => {
    expect(() => computeMaterialQuantity({ measurementValue: 0, coverageRate: 350, coats: 1, wasteBps: 0, unit: "gallon" })).toThrow();
  });

  it("rejects zero coverage rate", () => {
    expect(() => computeMaterialQuantity({ measurementValue: 100, coverageRate: 0, coats: 1, wasteBps: 0, unit: "gallon" })).toThrow();
  });

  it("rejects coats out of range", () => {
    expect(() => computeMaterialQuantity({ measurementValue: 100, coverageRate: 350, coats: 0, wasteBps: 0, unit: "gallon" })).toThrow();
    expect(() => computeMaterialQuantity({ measurementValue: 100, coverageRate: 350, coats: 21, wasteBps: 0, unit: "gallon" })).toThrow();
  });

  it("rejects waste out of range", () => {
    expect(() => computeMaterialQuantity({ measurementValue: 100, coverageRate: 350, coats: 1, wasteBps: 10001, unit: "gallon" })).toThrow();
  });
});

describe("computePaintGallons (thin wrapper over computeMaterialQuantity)", () => {
  it("matches the brief's exact worked example", () => {
    expect(computePaintGallons(600, 2, 1000, 350)).toBe(4);
  });
});

describe("computeAreaLaborTotalCents", () => {
  it("total_cents = round(measured_area * rate_cents) -- $4.00/sq ft on 300 sq ft = $1,200", () => {
    expect(computeAreaLaborTotalCents(300, 400)).toBe(120000);
  });

  it("rejects zero area", () => {
    expect(() => computeAreaLaborTotalCents(0, 400)).toThrow();
  });

  it("rejects negative area", () => {
    expect(() => computeAreaLaborTotalCents(-10, 400)).toThrow();
  });
});

describe("computeLinearLaborTotalCents", () => {
  it("total_cents = round(measured_linear_length * rate_cents)", () => {
    expect(computeLinearLaborTotalCents(36, 150)).toBe(5400); // $1.50/ft * 36 ft = $54.00
  });

  it("rejects zero linear length", () => {
    expect(() => computeLinearLaborTotalCents(0, 150)).toThrow();
  });
});

// =============================================================================
// Phase 2C.1: freehand/brush drawing — polygon geometry
// =============================================================================

describe("computePolygonArea (shoelace formula)", () => {
  it("a 10x10 square (drawn as 4 corners) has area 100", () => {
    const square: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(computePolygonArea(square)).toBe(100);
  });

  it("an L-shape (10x10 square minus a 5x5 corner) has area 75", () => {
    const lShape: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(computePolygonArea(lShape)).toBe(75);
  });

  it("works regardless of winding order (clockwise vs counter-clockwise)", () => {
    const clockwise: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
    ];
    expect(computePolygonArea(clockwise)).toBe(100);
  });

  it("rejects fewer than 3 points", () => {
    expect(() =>
      computePolygonArea([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ])
    ).toThrow("A closed shape needs at least 3 points");
  });

  it("rejects collinear points (zero area)", () => {
    expect(() =>
      computePolygonArea([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ])
    ).toThrow("The drawn shape has no area");
  });
});

describe("computePolygonPerimeter", () => {
  it("closed: sums all edges including the wrap-around edge (10x10 square = 40)", () => {
    const square: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(computePolygonPerimeter(square, true)).toBe(40);
  });

  it("open: sums only the n-1 drawn segments, no wrap-around (two 5-unit segments = 10)", () => {
    const path: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ];
    expect(computePolygonPerimeter(path, false)).toBe(10);
  });

  it("rejects a closed shape with fewer than 3 points", () => {
    expect(() =>
      computePolygonPerimeter(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        true
      )
    ).toThrow("A closed shape needs at least 3 points");
  });

  it("rejects an open path with fewer than 2 points", () => {
    expect(() => computePolygonPerimeter([{ x: 0, y: 0 }], false)).toThrow("A linear path needs at least 2 points");
  });

  it("rejects a degenerate path with zero length (all points coincide)", () => {
    expect(() =>
      computePolygonPerimeter(
        [
          { x: 5, y: 5 },
          { x: 5, y: 5 },
        ],
        false
      )
    ).toThrow("The drawn shape has no length");
  });
});

describe("simplifyPolyline (Douglas-Peucker)", () => {
  it("a perfectly straight line collapses to its two endpoints", () => {
    const straightLine: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(simplifyPolyline(straightLine, 0.5)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it("keeps a point far enough from the line to matter", () => {
    const withABump: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 5 }, // 5 units off the direct line from (0,0) to (10,0)
      { x: 10, y: 0 },
    ];
    const simplified = simplifyPolyline(withABump, 1);
    expect(simplified).toContainEqual({ x: 5, y: 5 });
  });

  it("never increases the point count, and always keeps the endpoints", () => {
    const jittery: Point[] = Array.from({ length: 50 }, (_, i) => ({ x: i, y: Math.sin(i / 3) * 0.3 }));
    const simplified = simplifyPolyline(jittery, 2);
    expect(simplified.length).toBeLessThanOrEqual(jittery.length);
    expect(simplified[0]).toEqual(jittery[0]);
    expect(simplified.at(-1)).toEqual(jittery.at(-1));
  });

  it("a real hand-drawn-shaped stroke still yields a reasonable area after simplification", () => {
    // A rough approximation of a 10x8 rectangle traced by hand (extra
    // jittery points along each edge) -- simplifying should not deform the
    // shape enough to meaningfully change its area.
    const jitteryRectangle: Point[] = [
      { x: 0, y: 0 },
      { x: 2.5, y: 0.05 },
      { x: 5, y: -0.05 },
      { x: 7.5, y: 0.05 },
      { x: 10, y: 0 },
      { x: 10.05, y: 4 },
      { x: 9.95, y: 8 },
      { x: 5, y: 8.05 },
      { x: 0, y: 8 },
      { x: 0.05, y: 4 },
    ];
    const simplified = simplifyPolyline(jitteryRectangle, 0.5);
    const area = computePolygonArea(simplified);
    // True area is 80 (10 x 8) -- allow a small tolerance for the jitter.
    expect(area).toBeGreaterThan(75);
    expect(area).toBeLessThan(85);
  });

  it("leaves a 2-point (or shorter) line untouched", () => {
    const twoPoints: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(simplifyPolyline(twoPoints, 1)).toEqual(twoPoints);
  });
});

describe("scalePoints", () => {
  it("divides every coordinate by the pixels-per-unit scale", () => {
    const pixelPoints: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ];
    // 100px represents 10ft -> 10 pixels per unit
    expect(scalePoints(pixelPoints, 10)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
    ]);
  });

  it("rejects a zero or negative scale", () => {
    expect(() => scalePoints([{ x: 0, y: 0 }], 0)).toThrow();
    expect(() => scalePoints([{ x: 0, y: 0 }], -5)).toThrow();
  });
});

describe("Freehand measurement quantity/labor generation (reusing the same generic helpers as rectangle mode)", () => {
  it("material quantity from a freehand-derived area works identically to a rectangle-derived area", () => {
    // Freehand area 120 sq ft, 10% waste, 1:1 coverage -> 132 sq ft required (the brief's worked example).
    const qty = computeMaterialQuantity({ measurementValue: 120, coverageRate: 1, coats: 1, wasteBps: 1000, unit: "sq_ft" });
    expect(qty).toBe(132);
  });

  it("area-based labor from a freehand-derived area works identically to a rectangle-derived area", () => {
    // 120 sq ft x $4.00/sq ft = $480.00 (the brief's worked example).
    expect(computeAreaLaborTotalCents(120, 400)).toBe(48000);
  });
});
