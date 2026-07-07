import { formatCents } from "../../../../../lib/proposals/format";

/**
 * Server-rendered snapshot of the proposal_version's stored totals — always
 * the authoritative, just-recalculated values (every mutation triggers
 * recalculate_proposal_version() before this page re-renders), never a
 * client-side estimate. See docs/34-proposal-builder-ux.md.
 */
export function PricingSummary({
  laborTotalCents,
  lineItemsSubtotalCents,
  discountCents,
  taxCents,
  totalCents,
}: {
  laborTotalCents: number;
  lineItemsSubtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}) {
  return (
    <div className="pricing-summary">
      <div className="pricing-summary-row">
        <span>Labor</span>
        <span>{formatCents(laborTotalCents)}</span>
      </div>
      <div className="pricing-summary-row">
        <span>Materials &amp; costs</span>
        <span>{formatCents(lineItemsSubtotalCents)}</span>
      </div>
      {discountCents > 0 ? (
        <div className="pricing-summary-row">
          <span>Discount</span>
          <span>-{formatCents(discountCents)}</span>
        </div>
      ) : null}
      {taxCents > 0 ? (
        <div className="pricing-summary-row">
          <span>Tax</span>
          <span>{formatCents(taxCents)}</span>
        </div>
      ) : null}
      <div className="pricing-summary-row pricing-summary-total">
        <span>Total</span>
        <span>{formatCents(totalCents)}</span>
      </div>
    </div>
  );
}
