"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { updateProposalPricingAction } from "../../../../../actions/proposals";
import type { ActionResult } from "../../../../../actions/auth";
import { SubmitButton } from "../../../../../components/submit-button";
import { PricingSummary } from "./pricing-summary";
import { AiWritingAssistant } from "./ai-writing-assistant";
import type { Database } from "../../../../../../types/database";

type ProposalVersion = Database["public"]["Tables"]["proposal_versions"]["Row"];

const initialState: ActionResult = {};

export function StepPricing({
  tenantId,
  proposalId,
  version,
  canEdit,
  canGenerateAiText,
  defaultAiTone,
}: {
  tenantId: string;
  proposalId: string;
  version: ProposalVersion;
  canEdit: boolean;
  canGenerateAiText: boolean;
  defaultAiTone: string;
}) {
  const [state, formAction] = useActionState(updateProposalPricingAction, initialState);

  // Terms/Exclusions/Notes are controlled (unlike the rest of this form)
  // so the AI writing assistant can fill them in directly -- same
  // "controlled field + ref-forcing effect" pattern as
  // create-tenant-form.tsx/new-proposal-form.tsx, needed because React's
  // <form action={...}> does a native-like reset after every action
  // response, which would otherwise desync these from React state
  // without a re-render to catch it.
  const [terms, setTerms] = useState(version.terms);
  const [exclusions, setExclusions] = useState(version.exclusions);
  const [notesForClient, setNotesForClient] = useState(version.notes_for_client);
  const termsRef = useRef<HTMLTextAreaElement>(null);
  const exclusionsRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (termsRef.current) termsRef.current.value = terms;
    if (exclusionsRef.current) exclusionsRef.current.value = exclusions;
    if (notesRef.current) notesRef.current.value = notesForClient;
  }, [state, terms, exclusions, notesForClient]);

  return (
    <div className="stack">
      {canGenerateAiText ? (
        <AiWritingAssistant
          tenantId={tenantId}
          proposalId={proposalId}
          proposalVersionId={version.id}
          defaultTone={defaultAiTone}
          currentValues={{ terms, exclusions, clientNotes: notesForClient }}
          onApply={(draft) => {
            if (draft.terms !== undefined) setTerms(draft.terms);
            if (draft.exclusions !== undefined) setExclusions(draft.exclusions);
            if (draft.clientNotes !== undefined) setNotesForClient(draft.clientNotes);
          }}
        />
      ) : null}

      <div className="section-card stack">
        <h2>Terms &amp; Pricing</h2>
        {state.error ? <p className="error-banner">{state.error}</p> : null}

        <form action={formAction} className="stack">
          <input type="hidden" name="proposalVersionId" value={version.id} />
          <input type="hidden" name="proposalId" value={proposalId} />

          <div className="field">
            <label htmlFor="terms">Terms</label>
            <textarea ref={termsRef} id="terms" name="terms" rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="field">
            <label htmlFor="exclusions">Exclusions</label>
            <textarea
              ref={exclusionsRef}
              id="exclusions"
              name="exclusions"
              rows={4}
              value={exclusions}
              onChange={(e) => setExclusions(e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="field">
            <label htmlFor="notesForClient">Notes for client</label>
            <textarea
              ref={notesRef}
              id="notesForClient"
              name="notesForClient"
              rows={3}
              value={notesForClient}
              onChange={(e) => setNotesForClient(e.target.value)}
              disabled={!canEdit}
            />
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
