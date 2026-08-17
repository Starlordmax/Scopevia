"use client";

import { useActionState, useState } from "react";
import { changeOpportunityStatusAction } from "../../../../actions/opportunities";
import type { ActionResult } from "../../../../actions/auth";
import { SubmitButton } from "../../../../components/submit-button";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../../../components/form-field-error";
import { OPPORTUNITY_TRANSITIONS, opportunityStatusLabel } from "../../../../lib/crm/opportunity-transitions";
import type { OpportunityStatus } from "../../../../../types/enums";

const initialState: ActionResult = {};

export function OpportunityStatusActions({ opportunityId, status }: { opportunityId: string; status: OpportunityStatus }) {
  const [state, formAction] = useActionState(changeOpportunityStatusAction, initialState);
  const [pendingStatus, setPendingStatus] = useState<OpportunityStatus | null>(null);
  const nextStatuses = OPPORTUNITY_TRANSITIONS[status] ?? [];
  useFocusFirstFieldError(state.fieldErrors);

  if (nextStatuses.length === 0) return null;

  return (
    <div className="stack">
      {state.error ? <p className="error-banner">{state.error}</p> : null}

      <div className="tenant-form">
        {nextStatuses.map((next) => (
          <button
            key={next}
            type="button"
            className={next === "lost" ? "button-danger" : "button-secondary"}
            onClick={() => setPendingStatus(pendingStatus === next ? null : next)}
          >
            Move to {opportunityStatusLabel(next)}
          </button>
        ))}
      </div>

      {pendingStatus ? (
        <form action={formAction} className="stack">
          <input type="hidden" name="opportunityId" value={opportunityId} />
          <input type="hidden" name="newStatus" value={pendingStatus} />

          {pendingStatus === "lost" ? (
            <div className="field">
              <label htmlFor="lostReason">Why was this lost?</label>
              <input id="lostReason" name="lostReason" type="text" {...fieldErrorProps(state.fieldErrors, "lostReason")} />
              <FieldError fieldErrors={state.fieldErrors} id="lostReason" />
            </div>
          ) : null}

          {pendingStatus === "inspection_scheduled" ? (
            <div className="field">
              <label htmlFor="inspectionScheduledAt">Inspection date &amp; time</label>
              <input
                id="inspectionScheduledAt"
                name="inspectionScheduledAt"
                type="datetime-local"
                {...fieldErrorProps(state.fieldErrors, "inspectionScheduledAt")}
              />
              <FieldError fieldErrors={state.fieldErrors} id="inspectionScheduledAt" />
            </div>
          ) : null}

          <SubmitButton pendingText="Updating…">Confirm: move to {opportunityStatusLabel(pendingStatus)}</SubmitButton>
        </form>
      ) : null}
    </div>
  );
}
