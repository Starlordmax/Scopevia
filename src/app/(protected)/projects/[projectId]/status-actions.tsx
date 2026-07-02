"use client";

import { useActionState, useState } from "react";
import { changeProjectStatusAction } from "../../../../actions/projects";
import type { ActionResult } from "../../../../actions/auth";
import { SubmitButton } from "../../../../components/submit-button";
import { PROJECT_TRANSITIONS, projectStatusLabel } from "../../../../lib/crm/project-transitions";
import type { ProjectStatus } from "../../../../../types/enums";

const initialState: ActionResult = {};

export function ProjectStatusActions({ projectId, status }: { projectId: string; status: ProjectStatus }) {
  const [state, formAction] = useActionState(changeProjectStatusAction, initialState);
  const [pendingStatus, setPendingStatus] = useState<ProjectStatus | null>(null);
  const nextStatuses = PROJECT_TRANSITIONS[status] ?? [];

  if (nextStatuses.length === 0) return null;

  return (
    <div className="stack">
      {state.error ? <p className="error-banner">{state.error}</p> : null}

      <div className="tenant-form">
        {nextStatuses.map((next) => (
          <button
            key={next}
            type="button"
            className={next === "cancelled" ? "button-danger" : "button-secondary"}
            onClick={() => setPendingStatus(pendingStatus === next ? null : next)}
          >
            Move to {projectStatusLabel(next)}
          </button>
        ))}
      </div>

      {pendingStatus ? (
        <form action={formAction} className="stack">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="newStatus" value={pendingStatus} />

          {pendingStatus === "inspection_pending" ? (
            <div className="field">
              <label htmlFor="inspectionScheduledAt">Inspection date &amp; time</label>
              <input id="inspectionScheduledAt" name="inspectionScheduledAt" type="datetime-local" required />
            </div>
          ) : null}

          <SubmitButton pendingText="Updating…">Confirm: move to {projectStatusLabel(pendingStatus)}</SubmitButton>
        </form>
      ) : null}
    </div>
  );
}
