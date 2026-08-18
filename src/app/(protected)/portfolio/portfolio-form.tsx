"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createPortfolioProjectAction, updatePortfolioProjectAction } from "../../../actions/portfolio";
import type { ActionResult } from "../../../actions/auth";
import { SubmitButton } from "../../../components/submit-button";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../../components/form-field-error";
import type { Database } from "../../../../types/database";

type PortfolioProject = Database["public"]["Tables"]["portfolio_projects"]["Row"];

const SERVICE_TYPES: { value: string; label: string }[] = [
  { value: "interior_painting", label: "Interior painting" },
  { value: "exterior_painting", label: "Exterior painting" },
  { value: "bathroom_remodeling", label: "Bathroom remodeling" },
  { value: "general_remodeling", label: "General remodeling" },
  { value: "flooring", label: "Flooring" },
  { value: "custom", label: "Custom" },
];

const initialState: ActionResult = {};

export function PortfolioForm({ tenantId, project }: { tenantId: string; project?: PortfolioProject }) {
  const isEdit = Boolean(project);
  const [state, formAction] = useActionState(isEdit ? updatePortfolioProjectAction : createPortfolioProjectAction, initialState);
  useFocusFirstFieldError(state.fieldErrors);

  return (
    <form action={formAction} noValidate className="stack">
      {state.error ? <p className="error-banner">{state.error}</p> : null}
      <input type="hidden" name="tenantId" value={tenantId} />
      {project ? <input type="hidden" name="portfolioProjectId" value={project.id} /> : null}

      <div className="field">
        <label htmlFor="title">Title</label>
        <input
          id="title"
          name="title"
          type="text"
          defaultValue={project?.title}
          placeholder="e.g. Residential bathroom remodel"
          {...fieldErrorProps(state.fieldErrors, "title")}
        />
        <FieldError fieldErrors={state.fieldErrors} id="title" />
      </div>

      <div className="field">
        <label htmlFor="serviceType">Service type</label>
        <select
          id="serviceType"
          name="serviceType"
          defaultValue={project?.service_type ?? ""}
          {...fieldErrorProps(state.fieldErrors, "serviceType")}
        >
          <option value="" disabled>
            Select a service type…
          </option>
          {SERVICE_TYPES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <FieldError fieldErrors={state.fieldErrors} id="serviceType" />
      </div>

      <div className="field">
        <label htmlFor="locationLabel">General location (optional)</label>
        <input id="locationLabel" name="locationLabel" type="text" maxLength={160} defaultValue={project?.location_label ?? ""} placeholder="e.g. Miami, FL" />
        <span className="hint">Use a general area only — never a client&apos;s full address.</span>
      </div>

      <div className="field">
        <label htmlFor="description">Description</label>
        <textarea id="description" name="description" rows={3} defaultValue={project?.description ?? ""} />
      </div>

      <div className="field">
        <label htmlFor="completedAt">Completed on (optional)</label>
        <input id="completedAt" name="completedAt" type="date" defaultValue={project?.completed_at ?? ""} />
      </div>

      <div className="tenant-form" style={{ justifyContent: "flex-end" }}>
        <Link href="/portfolio" className="button-secondary">
          Cancel
        </Link>
        <SubmitButton pendingText="Saving…">{isEdit ? "Save changes" : "Create portfolio item"}</SubmitButton>
      </div>
    </form>
  );
}
