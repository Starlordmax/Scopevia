/**
 * Pure TypeScript mirror of the proposal calculation engine implemented in
 * PL/pgSQL (recalculate_proposal_version(), add_proposal_labor_item(),
 * add_proposal_line_item() — see supabase/migrations/20260706141000_proposal_helpers.sql
 * and 20260706141200_proposal_functions_sections_items.sql).
 *
 * This is a UI-ONLY MIRROR, NOT THE AUTHORITY — exactly like
 * src/lib/crm/opportunity-transitions.ts is documented as a mirror of the
 * SQL transition table. It exists solely so the Proposal Builder can show a
 * live, instant total while editing (see docs/34-proposal-builder-ux.md,
 * "El preview de frontend es orientativo"). The value that is actually
 * saved and displayed everywhere else always comes back from
 * recalculate_proposal_version() on the server. If this file and the SQL
 * ever disagree, the SQL wins — the UI would just show a momentarily wrong
 * preview that self-corrects once the server responds.
 *
 * Money: integer cents. Percentages: integer basis points (10000 = 100%).
 */

export type DiscountType = "none" | "fixed" | "percentage";

export type LaborItemInput = {
  workerCount: number;
  estimatedDays: number;
  hoursPerDay: number;
  hourlyRateCents: number;
};

export type LineItemInput = {
  quantity: number;
  unitPriceCents: number;
  taxable: boolean;
};

export type ProposalTotalsInput = {
  laborItems: LaborItemInput[];
  lineItems: LineItemInput[];
  discountType: DiscountType;
  /** Cents when discountType is "fixed", basis points when "percentage". */
  discountValue: number;
  taxRateBps: number;
};

export type ProposalTotals = {
  laborTotalCents: number;
  lineItemsSubtotalCents: number;
  subtotalCents: number;
  discountCents: number;
  taxableSubtotalCents: number;
  taxCents: number;
  totalCents: number;
};

/** total_hours = worker_count * estimated_days * hours_per_day, rounded to 2 decimals. */
export function computeLaborHours(item: LaborItemInput): number {
  return roundTo(item.workerCount * item.estimatedDays * item.hoursPerDay, 2);
}

/** total_cents = round(total_hours * hourly_rate_cents). */
export function computeLaborTotalCents(item: LaborItemInput): number {
  return Math.round(computeLaborHours(item) * item.hourlyRateCents);
}

/** line_total_cents = round(quantity * unit_price_cents). */
export function computeLineItemTotalCents(item: LineItemInput): number {
  return Math.round(item.quantity * item.unitPriceCents);
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Full deterministic total, mirroring recalculate_proposal_version()'s order
 * of operations exactly:
 *   1. Sum labor + line items -> subtotal.
 *   2. Apply discount (capped at the subtotal — never negative-totals).
 *   3. Prorate the discount between taxable and non-taxable amounts by their
 *      share of the subtotal (documented decision — see
 *      docs/32-proposal-calculation-engine.md, "Discount proration").
 *   4. Apply tax to the taxable subtotal only.
 *
 * Labor is always taxable (documented decision — see
 * docs/adr/0031-tax-and-discount-model.md); there is no per-item taxable
 * flag for labor in Phase 2A.
 */
export function computeProposalTotals(input: ProposalTotalsInput): ProposalTotals {
  const laborTotalCents = input.laborItems.reduce((sum, item) => sum + computeLaborTotalCents(item), 0);

  const lineItemsSubtotalCents = input.lineItems.reduce((sum, item) => sum + computeLineItemTotalCents(item), 0);
  const lineItemsTaxableSubtotalCents = input.lineItems
    .filter((item) => item.taxable)
    .reduce((sum, item) => sum + computeLineItemTotalCents(item), 0);

  const subtotalCents = laborTotalCents + lineItemsSubtotalCents;

  let discountCents = 0;
  if (input.discountType === "fixed") {
    discountCents = input.discountValue;
  } else if (input.discountType === "percentage") {
    discountCents = Math.floor((subtotalCents * input.discountValue) / 10000);
  }
  if (discountCents > subtotalCents) {
    discountCents = subtotalCents;
  }
  if (discountCents < 0) {
    discountCents = 0;
  }

  let taxableSubtotalCents = laborTotalCents + lineItemsTaxableSubtotalCents;
  if (subtotalCents > 0) {
    taxableSubtotalCents -= Math.floor((discountCents * taxableSubtotalCents) / subtotalCents);
  }
  if (taxableSubtotalCents < 0) {
    taxableSubtotalCents = 0;
  }

  const taxCents = Math.floor((taxableSubtotalCents * input.taxRateBps) / 10000);

  let totalCents = subtotalCents - discountCents + taxCents;
  if (totalCents < 0) {
    totalCents = 0;
  }

  return {
    laborTotalCents,
    lineItemsSubtotalCents,
    subtotalCents,
    discountCents,
    taxableSubtotalCents,
    taxCents,
    totalCents,
  };
}
