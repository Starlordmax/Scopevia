"use client";

import { useActionState, useState } from "react";
import { convertOpportunityAction } from "../../../../actions/opportunities";
import type { ActionResult } from "../../../../actions/auth";
import { SubmitButton } from "../../../../components/submit-button";

const initialState: ActionResult = {};

export function ConvertToProjectForm({ opportunityId, defaultName }: { opportunityId: string; defaultName: string }) {
  const [state, formAction] = useActionState(convertOpportunityAction, initialState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="button-primary" onClick={() => setOpen(true)}>
        Convert to project
      </button>
    );
  }

  return (
    <form action={formAction} className="stack">
      {state.error ? <p className="error-banner">{state.error}</p> : null}
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <div className="field">
        <label htmlFor="projectName">Project name</label>
        <input id="projectName" name="projectName" type="text" defaultValue={defaultName} />
      </div>
      <div className="field">
        <label htmlFor="serviceType">Service type</label>
        <input id="serviceType" name="serviceType" type="text" />
      </div>
      <SubmitButton pendingText="Converting…">Create project</SubmitButton>
    </form>
  );
}
