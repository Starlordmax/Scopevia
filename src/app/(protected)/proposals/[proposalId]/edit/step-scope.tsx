"use client";

import { useActionState } from "react";
import Link from "next/link";
import { updateProposalScopeAction, addProposalSectionAction, archiveProposalSectionAction } from "../../../../../actions/proposals";
import type { ActionResult } from "../../../../../actions/auth";
import { SubmitButton } from "../../../../../components/submit-button";
import type { Database } from "../../../../../../types/database";

type ProposalVersion = Database["public"]["Tables"]["proposal_versions"]["Row"];
type ProposalSection = Database["public"]["Tables"]["proposal_sections"]["Row"];

const TEMPLATES: Record<string, { title: string; sectionType: string }[]> = {
  interior_painting: [
    { title: "Surface preparation", sectionType: "scope" },
    { title: "Painting work", sectionType: "scope" },
    { title: "Materials", sectionType: "materials" },
    { title: "Cleanup", sectionType: "scope" },
    { title: "Exclusions", sectionType: "exclusions" },
  ],
  bathroom_remodeling: [
    { title: "Demolition", sectionType: "scope" },
    { title: "Plumbing", sectionType: "scope" },
    { title: "Electrical", sectionType: "scope" },
    { title: "Tile and flooring", sectionType: "scope" },
    { title: "Fixtures", sectionType: "scope" },
    { title: "Painting", sectionType: "scope" },
    { title: "Cleanup", sectionType: "scope" },
    { title: "Exclusions", sectionType: "exclusions" },
  ],
  general_remodeling: [
    { title: "Preparation", sectionType: "scope" },
    { title: "Demolition", sectionType: "scope" },
    { title: "Construction work", sectionType: "scope" },
    { title: "Materials", sectionType: "materials" },
    { title: "Finishing", sectionType: "scope" },
    { title: "Cleanup", sectionType: "scope" },
    { title: "Exclusions", sectionType: "exclusions" },
  ],
};

const initialState: ActionResult = {};

export function StepScope({
  proposalId,
  version,
  sections,
  serviceType,
  canEdit,
}: {
  proposalId: string;
  version: ProposalVersion;
  sections: ProposalSection[];
  serviceType: string;
  canEdit: boolean;
}) {
  const [scopeState, scopeAction] = useActionState(updateProposalScopeAction, initialState);
  const [sectionState, sectionAction] = useActionState(addProposalSectionAction, initialState);
  const template = TEMPLATES[serviceType];

  return (
    <div className="stack">
      <div className="section-card stack">
        <h2>Job summary</h2>
        {scopeState.error ? <p className="error-banner">{scopeState.error}</p> : null}
        <form action={scopeAction} className="stack">
          <input type="hidden" name="proposalVersionId" value={version.id} />
          <input type="hidden" name="proposalId" value={proposalId} />
          <div className="field">
            <label htmlFor="summary">Short summary</label>
            <input id="summary" name="summary" type="text" maxLength={500} defaultValue={version.summary ?? ""} disabled={!canEdit} />
          </div>
          <div className="field">
            <label htmlFor="scopeIntro">Scope introduction</label>
            <textarea id="scopeIntro" name="scopeIntro" rows={3} defaultValue={version.scope_intro ?? ""} disabled={!canEdit} />
          </div>
          <div className="tenant-form" style={{ width: "100%" }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="estimatedStartDate">Estimated start date</label>
              <input
                id="estimatedStartDate"
                name="estimatedStartDate"
                type="date"
                defaultValue={version.estimated_start_date ?? ""}
                disabled={!canEdit}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="estimatedDurationDays">Estimated duration (days)</label>
              <input
                id="estimatedDurationDays"
                name="estimatedDurationDays"
                type="number"
                min={1}
                defaultValue={version.estimated_duration_days ?? ""}
                disabled={!canEdit}
              />
            </div>
          </div>
          {canEdit ? <SubmitButton pendingText="Saving…">Save and continue</SubmitButton> : null}
        </form>
      </div>

      <div className="section-card stack">
        <div className="page-header-heading">
          <h2>Scope sections</h2>
        </div>

        {sections.length === 0 ? (
          <p className="hint">No sections yet. Add one below, or use a template to start faster.</p>
        ) : (
          <ul className="stack" style={{ gap: 8 }}>
            {sections.map((s) => (
              <li key={s.id} className="card" style={{ maxWidth: "none" }}>
                <div className="page-header-heading">
                  <strong>{s.title}</strong>
                  <span className="badge">{s.section_type.replace(/_/g, " ")}</span>
                </div>
                {s.description ? <p className="hint">{s.description}</p> : null}
                {canEdit ? (
                  <form action={archiveProposalSectionAction}>
                    <input type="hidden" name="sectionId" value={s.id} />
                    <input type="hidden" name="proposalId" value={proposalId} />
                    <button type="submit" className="button-secondary">
                      Remove
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <>
            {template ? (
              <details>
                <summary>Use a template for this service type</summary>
                <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                  {template.map((t) => (
                    <form key={t.title} action={sectionAction}>
                      <input type="hidden" name="proposalVersionId" value={version.id} />
                      <input type="hidden" name="proposalId" value={proposalId} />
                      <input type="hidden" name="title" value={t.title} />
                      <input type="hidden" name="sectionType" value={t.sectionType} />
                      <button type="submit" className="button-secondary">
                        + {t.title}
                      </button>
                    </form>
                  ))}
                </div>
              </details>
            ) : null}

            {sectionState.error ? <p className="error-banner">{sectionState.error}</p> : null}
            <form action={sectionAction} className="stack">
              <input type="hidden" name="proposalVersionId" value={version.id} />
              <input type="hidden" name="proposalId" value={proposalId} />
              <div className="field">
                <label htmlFor="title">Custom section title</label>
                <input id="title" name="title" type="text" required placeholder="e.g. Surface preparation" />
              </div>
              <div className="field">
                <label htmlFor="description">Description</label>
                <textarea id="description" name="description" rows={2} />
              </div>
              <input type="hidden" name="sectionType" value="custom" />
              <SubmitButton pendingText="Adding…" className="button-secondary">
                + Add section
              </SubmitButton>
            </form>
          </>
        ) : null}
      </div>

      <div className="tenant-form" style={{ justifyContent: "space-between" }}>
        <Link href={`/proposals/${proposalId}`} className="button-secondary">
          Save draft
        </Link>
        <Link href={`/proposals/${proposalId}/edit?step=labor`} className="button-primary">
          Continue to Labor
        </Link>
      </div>
    </div>
  );
}
