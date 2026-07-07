"use client";

import { useActionState } from "react";
import Link from "next/link";
import { updateProposalPricingAction } from "../../../../../actions/proposals";
import type { ActionResult } from "../../../../../actions/auth";
import { SubmitButton } from "../../../../../components/submit-button";
import { PricingSummary } from "./pricing-summary";
import type { Database } from "../../../../../../types/database";

type ProposalVersion = Database["public"]["Tables"]["proposal_versions"]["Row"];

const initialState: ActionResult = {};

export function StepPricing({ proposalId, version, canEdit }: { proposalId: string; version: ProposalVersion; canEdit: boolean }) {
  const [state, formAction] = useActionState(updateProposalPricingAction, initialState);

  return (
    <div className="stack">
      <div className="section-card stack">
        <h2>Terms &amp; Pricing</h2>
        {state.error ? <p className="error-banner">{state.error}</p> : null}

        <form action={formAction} className="stack">
          <input type="hidden" name="proposalVersionId" value={version.id} />
          <input type="hidden" name="proposalId" value={proposalId} />

          <div className="field">
            <label htmlFor="terms">Terms</label>
            <textarea id="terms" name="terms" rows={4} defaultValue={version.terms} disabled={!canEdit} />
          </div>
          <div className="field">
            <label htmlFor="exclusions">Exclusions</label>
            <textarea id="exclusions" name="exclusions" rows={4} defaultValue={version.exclusions} disabled={!canEdit} />
          </div>
          <div className="field">
            <label htmlFor="notesForClient">Notes for client</label>
            <textarea id="notesForClient" name="notesForClient" rows={3} defaultValue={version.notes_for_client} disabled={!canEdit} />
          </div>

          <div className="tenant-form" style={{ width: "100%" }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="discountType">Discount type</label>
              <select id="discountType" name="discountType" defaultValue={version.discount_type} disabled={!canEdit}>
                <option value="none">No discount</option>
                <option value="fixed">Fixed amount</option>
                <option value="percentage">Percentage</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="discountValue">Discount value</label>
              <input
                id="discountValue"
                name="discountValue"
                type="text"
                inputMode="decimal"
                placeholder="e.g. 100.00 or 10"
                defaultValue={
                  version.discount_type === "percentage"
                    ? (version.discount_value / 100).toString()
                    : version.discount_type === "fixed"
                      ? (version.discount_value / 100).toFixed(2)
                      : ""
                }
                disabled={!canEdit}
              />
              <span className="hint">Dollars for fixed, percent (e.g. 10) for percentage.</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="taxRatePercent">Tax rate (%)</label>
            <input
              id="taxRatePercent"
              name="taxRatePercent"
              type="text"
              inputMode="decimal"
              defaultValue={(version.tax_rate_bps / 100).toString()}
              disabled={!canEdit}
            />
          </div>

          {canEdit ? <SubmitButton pendingText="Saving…">Save and continue</SubmitButton> : null}
        </form>

        <PricingSummary
          laborTotalCents={version.labor_total_cents}
          lineItemsSubtotalCents={version.line_items_subtotal_cents}
          discountCents={version.discount_cents}
          taxCents={version.tax_cents}
          totalCents={version.total_cents}
        />
      </div>

      <div className="tenant-form" style={{ justifyContent: "space-between" }}>
        <Link href={`/proposals/${proposalId}/edit?step=photos`} className="button-secondary">
          Back
        </Link>
        <Link href={`/proposals/${proposalId}/edit?step=review`} className="button-primary">
          Continue to Review
        </Link>
      </div>
    </div>
  );
}
