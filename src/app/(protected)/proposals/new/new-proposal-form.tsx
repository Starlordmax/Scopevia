"use client";

import { useActionState, useMemo } from "react";
import Link from "next/link";
import { createProposalDirectAction, createProposalFromOpportunityAction } from "../../../../actions/proposals";
import type { ActionResult } from "../../../../actions/auth";
import { SubmitButton } from "../../../../components/submit-button";
import { ClientSelect } from "./client-select";
import type { ClientOption } from "../../../../lib/crm/client-options";
import type { ContactOption } from "../../../../lib/crm/contact-options";
import type { OpportunityOption } from "../../../../lib/crm/opportunity-options";

const SERVICE_TYPES: { value: string; label: string }[] = [
  { value: "interior_painting", label: "Interior painting" },
  { value: "exterior_painting", label: "Exterior painting" },
  { value: "bathroom_remodeling", label: "Bathroom remodeling" },
  { value: "general_remodeling", label: "General remodeling" },
  { value: "flooring", label: "Flooring" },
  { value: "custom", label: "Custom" },
];

const initialState: ActionResult = {};

export function NewProposalForm({
  tenantId,
  clients,
  opportunities,
  contacts,
  defaultClientId,
  defaultOpportunityId,
}: {
  tenantId: string;
  clients: ClientOption[];
  opportunities: OpportunityOption[];
  contacts: ContactOption[];
  defaultClientId?: string;
  defaultOpportunityId?: string;
}) {
  const fromOpportunity = Boolean(defaultOpportunityId);
  const [state, formAction] = useActionState(
    fromOpportunity ? createProposalFromOpportunityAction : createProposalDirectAction,
    initialState
  );
  // Stable per page-load — a resubmit (double click, back-button retry)
  // reuses the same key so create_proposal_direct()/create_proposal_from_opportunity()
  // return the already-created proposal instead of a duplicate.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  return (
    <form action={formAction} className="stack">
      {state.error ? <p className="error-banner">{state.error}</p> : null}
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      {fromOpportunity ? (
        <input type="hidden" name="opportunityId" value={defaultOpportunityId} />
      ) : (
        <>
          <div className="field">
            <label htmlFor="clientId">Client</label>
            <ClientSelect clients={clients} defaultClientId={defaultClientId} />
            {clients.length === 0 ? (
              <span className="hint">
                No clients yet — <Link href="/clients/new">create one first</Link>.
              </span>
            ) : null}
          </div>

          {defaultClientId && opportunities.length > 0 ? (
            <div className="field">
              <label htmlFor="opportunityId">Opportunity (optional)</label>
              <select id="opportunityId" name="opportunityId" defaultValue="">
                <option value="">None — create one automatically</option>
                {opportunities.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </select>
              <span className="hint">If left blank, a lightweight opportunity is created for you automatically.</span>
            </div>
          ) : null}

          {defaultClientId && contacts.length > 0 ? (
            <div className="field">
              <label htmlFor="clientContactId">Contact (optional)</label>
              <select id="clientContactId" name="clientContactId" defaultValue="">
                <option value="">No specific contact</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </>
      )}

      <div className="field">
        <label htmlFor="title">Proposal title</label>
        <input id="title" name="title" type="text" required placeholder="e.g. Exterior repaint — Smith residence" />
      </div>

      <div className="field">
        <label htmlFor="serviceType">Service type</label>
        <select id="serviceType" name="serviceType" required defaultValue="">
          <option value="" disabled>
            Select a service type…
          </option>
          {SERVICE_TYPES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="tenant-form" style={{ justifyContent: "flex-end" }}>
        <Link href="/proposals" className="button-secondary">
          Cancel
        </Link>
        <SubmitButton pendingText="Creating…">Save and continue</SubmitButton>
      </div>
    </form>
  );
}
