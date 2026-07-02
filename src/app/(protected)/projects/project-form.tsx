"use client";

import { useActionState } from "react";
import { createProjectAction, updateProjectAction } from "../../../actions/projects";
import type { ActionResult } from "../../../actions/auth";
import { SubmitButton } from "../../../components/submit-button";
import type { ClientOption } from "../../../lib/crm/client-options";
import type { AssignableMember } from "../../../lib/crm/assignable-members";
import type { Database } from "../../../../types/database";

type Project = Database["public"]["Tables"]["projects"]["Row"];
type Contact = { id: string; name: string };

const initialState: ActionResult = {};

export function ProjectForm({
  tenantId,
  clients,
  members,
  contacts,
  defaultClientId,
  project,
}: {
  tenantId: string;
  clients: ClientOption[];
  members: AssignableMember[];
  contacts: Contact[];
  defaultClientId?: string;
  project?: Project;
}) {
  const isEdit = Boolean(project);
  const [state, formAction] = useActionState(isEdit ? updateProjectAction : createProjectAction, initialState);

  return (
    <form action={formAction} className="stack">
      {state.error ? <p className="error-banner">{state.error}</p> : null}
      <input type="hidden" name="tenantId" value={tenantId} />
      {project ? <input type="hidden" name="projectId" value={project.id} /> : null}

      {!isEdit ? (
        <div className="field">
          <label htmlFor="clientId">Client</label>
          <select id="clientId" name="clientId" required defaultValue={defaultClientId ?? ""}>
            <option value="" disabled>
              Select a client…
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="name">Project name</label>
        <input id="name" name="name" type="text" required defaultValue={project?.name} />
      </div>

      <div className="field">
        <label htmlFor="serviceType">Service type</label>
        <input id="serviceType" name="serviceType" type="text" placeholder="Interior painting, roof repair…" defaultValue={project?.service_type ?? ""} />
      </div>

      <div className="field">
        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={project?.description ?? ""}
          style={{ font: "inherit", padding: 10, borderRadius: 8, border: "1px solid var(--color-border)" }}
        />
      </div>

      {isEdit && contacts.length > 0 ? (
        <div className="field">
          <label htmlFor="primaryContactId">Primary contact</label>
          <select id="primaryContactId" name="primaryContactId" defaultValue={project?.primary_contact_id ?? ""}>
            <option value="">None</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="assignedTo">Assigned to</label>
        <select id="assignedTo" name="assignedTo" defaultValue={project?.assigned_to ?? ""}>
          <option value="">Unassigned</option>
          {members.map((m) => (
            <option key={m.membershipId} value={m.membershipId}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="tentativeStartDate">Tentative start date</label>
        <input id="tentativeStartDate" name="tentativeStartDate" type="date" defaultValue={project?.tentative_start_date ?? ""} />
      </div>

      <SubmitButton pendingText="Saving…">{isEdit ? "Save changes" : "Create project"}</SubmitButton>
    </form>
  );
}
