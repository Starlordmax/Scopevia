import { describe, expect, it } from "vitest";
import {
  computeRectangle,
  computeWallArea,
  applyWaste,
  computeMaterialQuantity,
  computeAreaLaborTotalCents,
  computeLinearLaborTotalCents,
  computePaintGallons,
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
