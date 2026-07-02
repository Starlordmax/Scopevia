"use client";

import { useActionState } from "react";
import { changeOpportunityStatusAction } from "../../../actions/opportunities";
import type { ActionResult } from "../../../actions/auth";
import { opportunityStatusLabel } from "../../../lib/crm/opportunity-transitions";
import type { OpportunityStatus } from "../../../../types/enums";

const initialState: ActionResult = {};

/**
 * Only offers transitions that need no extra fields (lost/inspection_scheduled
 * require a reason/date, entered on the opportunity's own detail page instead
 * — see docs/20-phase-1-crm-and-projects.md, "Pipeline"). Works identically on
 * desktop and mobile: a native <select> is not drag-and-drop, so there is
 * nothing extra to build for touch devices.
 */
export function QuickAdvance({ opportunityId, options }: { opportunityId: string; options: OpportunityStatus[] }) {
  const [state, formAction] = useActionState(changeOpportunityStatusAction, initialState);

  if (options.length === 0) return null;

  return (
    <form action={formAction} className="tenant-form">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      {state.error ? <span className="hint">{state.error}</span> : null}
      <select
        name="newStatus"
        defaultValue=""
        aria-label="Move to stage"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="" disabled>
          Move to…
        </option>
        {options.map((o) => (
          <option key={o} value={o}>
            {opportunityStatusLabel(o)}
          </option>
        ))}
      </select>
    </form>
  );
}
