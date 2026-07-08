import { describe, expect, it } from "vitest";
import {
  computeLaborHours,
  computeLaborTotalCents,
  computeLineItemTotalCents,
  computeProposalTotals,
  type LaborItemInput,
  type LineItemInput,
} from "../../src/lib/proposals/calculations";

describe("computeLaborHours / computeLaborTotalCents", () => {
  it("one worker, one day", () => {
    const item: LaborItemInput = { pricingMethod: "hourly", workerCount: 1, estimatedDays: 1, hoursPerDay: 8, hourlyRateCents: 3000 };
    expect(computeLaborHours(item)).toBe(8);
    expect(computeLaborTotalCents(item)).toBe(24000); // $240.00
  });

  it("the brief's worked example: 2 workers, 5 days, 8 hours/day, $30/hr -> 80 hours, $2,400", () => {
    const item: LaborItemInput = { pricingMethod: "hourly", workerCount: 2, estimatedDays: 5, hoursPerDay: 8, hourlyRateCents: 3000 };
    expect(computeLaborHours(item)).toBe(80);
    expect(computeLaborTotalCents(item)).toBe(240000); // $2,400.00
  });

  it("multiple workers and multiple days compound correctly", () => {
    const item: LaborItemInput = { pricingMethod: "hourly", workerCount: 4, estimatedDays: 3, hoursPerDay: 6, hourlyRateCents: 2500 };
    expect(computeLaborHours(item)).toBe(72); // 4*3*6
    expect(computeLaborTotalCents(item)).toBe(180000); // 72 * 2500
  });

  it("decimal estimated days", () => {
    const item: LaborItemInput = { pricingMethod: "hourly", workerCount: 1, estimatedDays: 2.5, hoursPerDay: 8, hourlyRateCents: 4000 };
    expect(computeLaborHours(item)).toBe(20);
    expect(computeLaborTotalCents(item)).toBe(80000);
  });

  it("rounds total_hours to 2 decimal places", () => {
    const item: LaborItemInput = { pricingMethod: "hourly", workerCount: 1, estimatedDays: 1, hoursPerDay: 7.333, hourlyRateCents: 100 };
    expect(computeLaborHours(item)).toBe(7.33);
  });

  it("rounds total_cents to the nearest whole cent when hours * rate is fractional", () => {
    const item: LaborItemInput = { pricingMethod: "hourly", workerCount: 1, estimatedDays: 1, hoursPerDay: 1.01, hourlyRateCents: 333 };
    expect(computeLaborHours(item)).toBe(1.01);
    expect(computeLaborTotalCents(item)).toBe(336); // 1.01 * 333 = 336.33 -> 336
  });

  it("a zero or negative worker_count/days/hours must be rejected by callers, not silently computed to zero/negative — this file only mirrors the formula, validation lives in add_proposal_labor_item()", () => {
    // Documented boundary: the pure formula happily computes 0 for
    // worker_count=0, but the real SQL function (and its API caller) reject
    // worker_count<=0 before ever calling this. This test just pins down
    // that the mirror itself has no built-in guard, so nobody mistakes it
    // for the validation layer.
    const item: LaborItemInput = { pricingMethod: "hourly", workerCount: 0, estimatedDays: 5, hoursPerDay: 8, hourlyRateCents: 3000 };
    expect(computeLaborHours(item)).toBe(0);
  });

  it("high but realistic values do not overflow or misbehave", () => {
    const item: LaborItemInput = { pricingMethod: "hourly", workerCount: 50, estimatedDays: 90, hoursPerDay: 12, hourlyRateCents: 15000 };
    expect(computeLaborHours(item)).toBe(54000);
    expect(computeLaborTotalCents(item)).toBe(810000000); // $8,100,000.00
  });
});

describe("computeLaborHours / computeLaborTotalCents — fixed pricing method", () => {
  it("fixed price: total_cents is the fixed price verbatim, total_hours is 0", () => {
    const item: LaborItemInput = { pricingMethod: "fixed", fixedTotalCents: 70000 };
    expect(computeLaborHours(item)).toBe(0);
    expect(computeLaborTotalCents(item)).toBe(70000); // $700.00
  });

  it("fixed price of exactly zero is a valid, distinct value from 'not set'", () => {
    const item: LaborItemInput = { pricingMethod: "fixed", fixedTotalCents: 0 };
    expect(computeLaborTotalCents(item)).toBe(0);
  });

  it("switching pricing method changes which fields are read — an hourly item's rate never leaks into a fixed total", () => {
    const hourly: LaborItemInput = { pricingMethod: "hourly", workerCount: 2, estimatedDays: 5, hoursPerDay: 8, hourlyRateCents: 3000 };
    const fixed: LaborItemInput = { pricingMethod: "fixed", fixedTotalCents: 70000 };
    expect(computeLaborTotalCents(hourly)).toBe(240000);
    expect(computeLaborTotalCents(fixed)).toBe(70000);
  });
});

describe("computeLineItemTotalCents", () => {
  it("integer quantity", () => {
    const item: LineItemInput = { quantity: 4, unitPriceCents: 5000, taxable: true };
    expect(computeLineItemTotalCents(item)).toBe(20000);
  });

  it("decimal quantity (e.g. gallons or sq_ft)", () => {
    const item: LineItemInput = { quantity: 12.5, unitPriceCents: 800, taxable: true };
    expect(computeLineItemTotalCents(item)).toBe(10000); // 12.5 * 800 = 10000
  });

  it("rounds a fractional-cent result to the nearest cent", () => {
    const item: LineItemInput = { quantity: 3, unitPriceCents: 333, taxable: true };
    expect(computeLineItemTotalCents(item)).toBe(999);
    const fractional: LineItemInput = { quantity: 1 / 3, unitPriceCents: 100, taxable: true };
    expect(computeLineItemTotalCents(fractional)).toBe(33); // 33.33... -> 33
  });
});

describe("computeProposalTotals", () => {
  const oneLaborItem: LaborItemInput = { pricingMethod: "hourly", workerCount: 2, estimatedDays: 5, hoursPerDay: 8, hourlyRateCents: 3000 };

  it("no discount, no tax", () => {
    const result = computeProposalTotals({
      laborItems: [oneLaborItem],
      lineItems: [],
      discountType: "none",
      discountValue: 0,
      taxRateBps: 0,
    });
    expect(result.laborTotalCents).toBe(240000);
    expect(result.subtotalCents).toBe(240000);
    expect(result.discountCents).toBe(0);
    expect(result.taxCents).toBe(0);
    expect(result.totalCents).toBe(240000);
  });

  it("multiple labor items sum correctly", () => {
    const result = computeProposalTotals({
      laborItems: [
        { pricingMethod: "hourly", workerCount: 1, estimatedDays: 5, hoursPerDay: 8, hourlyRateCents: 3000 }, // $1,200
        { pricingMethod: "hourly", workerCount: 2, estimatedDays: 3, hoursPerDay: 8, hourlyRateCents: 2500 }, // 48h * 2500 = $1,200
      ],
      lineItems: [],
      discountType: "none",
      discountValue: 0,
      taxRateBps: 0,
    });
    expect(result.laborTotalCents).toBe(240000);
  });

  it("a mix of hourly and fixed labor items sums correctly", () => {
    const result = computeProposalTotals({
      laborItems: [
        { pricingMethod: "hourly", workerCount: 1, estimatedDays: 1, hoursPerDay: 8, hourlyRateCents: 3500 }, // $280
        { pricingMethod: "fixed", fixedTotalCents: 70000 }, // $700
      ],
      lineItems: [],
      discountType: "none",
      discountValue: 0,
      taxRateBps: 0,
    });
    expect(result.laborTotalCents).toBe(98000); // $280 + $700
  });

  it("manual verification case from the brief: fixed labor $700 + material 2x$40 = $780 total", () => {
    const result = computeProposalTotals({
      laborItems: [{ pricingMethod: "fixed", fixedTotalCents: 70000 }],
      lineItems: [{ quantity: 2, unitPriceCents: 4000, taxable: true }],
      discountType: "none",
      discountValue: 0,
      taxRateBps: 0,
    });
    expect(result.laborTotalCents).toBe(70000); // $700.00
    expect(result.lineItemsSubtotalCents).toBe(8000); // $80.00
    expect(result.totalCents).toBe(78000); // $780.00
  });

  it("manual verification case from the brief: hourly labor 1 worker x 1 day x 8h x $35/hr = $280 total", () => {
    const result = computeProposalTotals({
      laborItems: [{ pricingMethod: "hourly", workerCount: 1, estimatedDays: 1, hoursPerDay: 8, hourlyRateCents: 3500 }],
      lineItems: [],
      discountType: "none",
      discountValue: 0,
      taxRateBps: 0,
    });
    expect(result.laborTotalCents).toBe(28000); // $280.00
    expect(result.totalCents).toBe(28000);
  });

  it("multiple line items across categories sum correctly", () => {
    const result = computeProposalTotals({
      laborItems: [],
      lineItems: [
        { quantity: 5, unitPriceCents: 4500, taxable: true }, // material, $225
        { quantity: 1, unitPriceCents: 15000, taxable: true }, // equipment, $150
        { quantity: 2, unitPriceCents: 5000, taxable: false }, // disposal, $100
      ],
      discountType: "none",
      discountValue: 0,
      taxRateBps: 0,
    });
    expect(result.lineItemsSubtotalCents).toBe(47500);
    expect(result.subtotalCents).toBe(47500);
  });

  it("fixed discount reduces the total by exactly that amount", () => {
    const result = computeProposalTotals({
      laborItems: [oneLaborItem], // $2,400
      lineItems: [],
      discountType: "fixed",
      discountValue: 50000, // $500
      taxRateBps: 0,
    });
    expect(result.discountCents).toBe(50000);
    expect(result.totalCents).toBe(190000); // $1,900
  });

  it("percentage discount is basis points of the subtotal", () => {
    const result = computeProposalTotals({
      laborItems: [oneLaborItem], // $2,400
      lineItems: [],
      discountType: "percentage",
      discountValue: 1000, // 10%
      taxRateBps: 0,
    });
    expect(result.discountCents).toBe(24000); // 10% of $2,400
    expect(result.totalCents).toBe(216000);
  });

  it("a discount greater than the subtotal is capped at the subtotal, never producing a negative total", () => {
    const result = computeProposalTotals({
      laborItems: [{ pricingMethod: "hourly", workerCount: 1, estimatedDays: 1, hoursPerDay: 1, hourlyRateCents: 10000 }], // $100
      lineItems: [],
      discountType: "fixed",
      discountValue: 100000, // $1,000 — way more than the $100 subtotal
      taxRateBps: 0,
    });
    expect(result.discountCents).toBe(10000); // capped at subtotal
    expect(result.totalCents).toBe(0);
  });

  it("tax applies only to taxable line items, not non-taxable ones", () => {
    const result = computeProposalTotals({
      laborItems: [],
      lineItems: [
        { quantity: 1, unitPriceCents: 100000, taxable: true }, // $1,000 taxable
        { quantity: 1, unitPriceCents: 100000, taxable: false }, // $1,000 non-taxable
      ],
      discountType: "none",
      discountValue: 0,
      taxRateBps: 1000, // 10%
    });
    expect(result.taxableSubtotalCents).toBe(100000);
    expect(result.taxCents).toBe(10000); // 10% of only the taxable $1,000
    expect(result.totalCents).toBe(210000); // 200000 subtotal + 10000 tax
  });

  it("labor is always taxable (documented decision)", () => {
    const result = computeProposalTotals({
      laborItems: [oneLaborItem], // $2,400
      lineItems: [{ quantity: 1, unitPriceCents: 10000, taxable: false }], // $100 non-taxable
      discountType: "none",
      discountValue: 0,
      taxRateBps: 1000, // 10%
    });
    expect(result.taxableSubtotalCents).toBe(240000); // labor only
    expect(result.taxCents).toBe(24000);
  });

  it("discount is prorated between taxable and non-taxable amounts", () => {
    const result = computeProposalTotals({
      laborItems: [],
      lineItems: [
        { quantity: 1, unitPriceCents: 60000, taxable: true }, // $600 taxable
        { quantity: 1, unitPriceCents: 40000, taxable: false }, // $400 non-taxable
      ],
      discountType: "percentage",
      discountValue: 5000, // 50% discount
      taxRateBps: 1000, // 10%
    });
    // subtotal 1000, discount 500 (50%), taxable share is 600/1000 = 60% of
    // the discount -> 300 removed from the 600 taxable -> taxable subtotal 300
    expect(result.discountCents).toBe(50000);
    expect(result.taxableSubtotalCents).toBe(30000);
    expect(result.taxCents).toBe(3000); // 10% of 300
  });

  it("zero-value proposal (no labor, no line items) totals to zero without error", () => {
    const result = computeProposalTotals({
      laborItems: [],
      lineItems: [],
      discountType: "none",
      discountValue: 0,
      taxRateBps: 0,
    });
    expect(result.subtotalCents).toBe(0);
    expect(result.discountCents).toBe(0);
    expect(result.taxCents).toBe(0);
    expect(result.totalCents).toBe(0);
  });

  it("the total is always derived from inputs — there is no field to pass a pre-computed/manipulated total into", () => {
    // computeProposalTotals's input type has no "total" field at all, so an
    // attempt to "manipulate" the total by passing one is a TypeScript
    // compile error, not a runtime bypass — this test documents that
    // guarantee by exercising the actual return shape.
    const result = computeProposalTotals({
      laborItems: [oneLaborItem],
      lineItems: [],
      discountType: "none",
      discountValue: 0,
      taxRateBps: 0,
    });
    expect(Object.keys(result).sort()).toEqual(
      [
        "discountCents",
        "laborTotalCents",
        "lineItemsSubtotalCents",
        "subtotalCents",
        "taxCents",
        "taxableSubtotalCents",
        "totalCents",
      ].sort()
    );
  });

  it("high but realistic combined values", () => {
    const result = computeProposalTotals({
      laborItems: [{ pricingMethod: "hourly", workerCount: 10, estimatedDays: 30, hoursPerDay: 10, hourlyRateCents: 5000 }], // 3000h * $50 = $150,000
      lineItems: [{ quantity: 500, unitPriceCents: 10000, taxable: true }], // $50,000
      discountType: "percentage",
      discountValue: 500, // 5%
      taxRateBps: 750, // 7.5%
    });
    expect(result.subtotalCents).toBe(20000000); // $200,000
    expect(result.discountCents).toBe(1000000); // 5% of 200000
    expect(result.totalCents).toBeGreaterThan(0);
    expect(result.totalCents).toBeLessThan(result.subtotalCents + result.taxCents);
  });
});
