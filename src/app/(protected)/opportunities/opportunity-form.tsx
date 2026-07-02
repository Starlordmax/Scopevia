"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createOpportunityAction, updateOpportunityAction } from "../../../actions/opportunities";
import type { ActionResult } from "../../../actions/auth";
import { SubmitButton } from "../../../components/submit-button";
import type { ClientOption } from "../../../lib/crm/client-options";
import type { AssignableMember } from "../../../lib/crm/assignable-members";
import type { Database } from "../../../../types/database";

type Opportunity = Database["public"]["Tables"]["opportunities"]["Row"];

const initialState: ActionResult = {};

export function OpportunityForm({
  tenantId,
  clients,
  members,
  defaultClientId,
  opportunity,
}: {
  tenantId: string;
  clients: ClientOption[];
  members: AssignableMember[];
  defaultClientId?: string;
  opportunity?: Opportunity;
}) {
  const isEdit = Boolean(opportunity);
  const [state, formAction] = useActionState(isEdit ? updateOpportunityAction : createOpportunityAction, initialState);

  return (
    <form action={formAction} className="stack">
      {state.error ? <p className="error-banner">{state.error}</p> : null}
      <input type="hidden" name="tenantId" value={tenantId} />
      {opportunity ? <input type="hidden" name="opportunityId" value={opportunity.id} /> : null}

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
          {clients.length === 0 ? (
            <span className="hint">
              No clients yet — <Link href="/clients/new">create one first</Link>.
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="title">Title</label>
        <input id="title" name="title" type="text" required defaultValue={opportunity?.title} />
      </div>

      <div className="field">
        <label htmlFor="source">Source</label>
        <input id="source" name="source" type="text" placeholder="Referral, website, walk-in…" defaultValue={opportunity?.source ?? ""} />
      </div>

      <div className="tenant-form" style={{ width: "100%" }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="estimatedValue">Estimated value ($)</label>
          <input
            id="estimatedValue"
            name="estimatedValue"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={opportunity?.estimated_value_cents != null ? (opportunity.estimated_value_cents / 100).toFixed(2) : ""}
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="probability">Probability (%)</label>
          <input id="probability" name="probability" type="number" min={0} max={100} defaultValue={opportunity?.probability ?? ""} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="expectedCloseDate">Expected close date</label>
        <input id="expectedCloseDate" name="expectedCloseDate" type="date" defaultValue={opportunity?.expected_close_date ?? ""} />
      </div>

      <div className="field">
        <label htmlFor="assignedTo">Assigned to</label>
        <select id="assignedTo" name="assignedTo" defaultValue={opportunity?.assigned_to ?? ""}>
          <option value="">Unassigned</option>
          {members.map((m) => (
            <option key={m.membershipId} value={m.membershipId}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      <SubmitButton pendingText="Saving…">{isEdit ? "Save changes" : "Create opportunity"}</SubmitButton>
    </form>
  );
}
