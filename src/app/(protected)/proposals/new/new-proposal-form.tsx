"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createProposalDirectAction, createProposalFromOpportunityAction } from "../../../../actions/proposals";
import type { ActionResult } from "../../../../actions/auth";
import { SubmitButton } from "../../../../components/submit-button";
import { ClientSelect } from "./client-select";
import { QuickCreateClientModal } from "./quick-create-client-modal";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../../../components/form-field-error";
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
  const searchParams = useSearchParams();
  const justCreatedClient = searchParams.get("created") === "1";
  // Stable per page-load — a resubmit (double click, back-button retry)
  // reuses the same key so create_proposal_direct()/create_proposal_from_opportunity()
  // return the already-created proposal instead of a duplicate.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);
  const [title, setTitle] = useState("");
  const [serviceType, setServiceType] = useState("");
  useFocusFirstFieldError(state.fieldErrors);

  // React's <form action={...}> performs a native-like form reset after
  // EVERY action response (success or failure) -- for an uncontrolled
  // field this is invisible (it was already going to reset), but for a
  // CONTROLLED field (`title`/`serviceType`, needed so the Custom
  // service name field can react to the current selection) the native
  // reset clobbers the DOM's live value directly without React
  // necessarily re-rendering it back on the same tick, since React only
  // re-applies `value` when the state it's derived from actually
  // changes -- and `serviceType`/`title` themselves never changed, only
  // the DOM was mutated out from under them.
  //
  // A `key`-based forced remount (this file's earlier approach) turned
  // out to race unpredictably with exactly *when* the browser's own
  // reset fires relative to React's re-render/commit -- sometimes the
  // remount ran first and the reset undid it again afterward, silently
  // submitting the FIRST enabled <option> ("Interior painting") instead
  // of "custom" on a resubmit. Forcing the DOM value directly via a ref,
  // in a `useEffect` that always runs *after* commit (and therefore
  // after any reset tied to the same submission's event handling), is
  // the reliable fix: it doesn't matter what the browser already did to
  // the DOM, this always re-asserts the correct value as the last word.
  const titleRef = useRef<HTMLInputElement>(null);
  const serviceTypeRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (titleRef.current) titleRef.current.value = title;
    if (serviceTypeRef.current) serviceTypeRef.current.value = serviceType;
  }, [state, title, serviceType]);

  return (
    <form action={formAction} className="stack">
      {state.error ? <p className="error-banner">{state.error}</p> : null}
      {justCreatedClient ? <p className="success-banner">Client created and selected.</p> : null}
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      {fromOpportunity ? (
        <input type="hidden" name="opportunityId" value={defaultOpportunityId} />
      ) : (
        <>
          <div className="field">
            <label htmlFor="clientId">Client</label>
            <div className="tenant-form" style={{ alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <ClientSelect clients={clients} defaultClientId={defaultClientId} />
              </div>
              <QuickCreateClientModal tenantId={tenantId} />
            </div>
            {clients.length === 0 ? (
              <span className="hint">
                No clients yet — <Link href="/clients/new">create one first</Link>, or use{" "}
                <strong>+ New client</strong> above.
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
        {/* Controlled + force-synced via titleRef's effect above -- see
            that comment. An uncontrolled text input has no "selected"
            HTML attribute for a native form reset to fall back to
            (unlike ClientSelect's <option selected>), so without this
            it would revert to a bare empty string on every failed
            submission, silently discarding whatever the user had
            already typed. */}
        <input
          ref={titleRef}
          id="title"
          name="title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Exterior repaint — Smith residence"
        />
      </div>

      <div className="field">
        <label htmlFor="serviceType">Service type</label>
        <select
          ref={serviceTypeRef}
          id="serviceType"
          name="serviceType"
          required
          value={serviceType}
          onChange={(e) => setServiceType(e.target.value)}
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
      </div>

      {serviceType === "custom" ? (
        <div className="field">
          <label htmlFor="customServiceName">Custom service name</label>
          <input
            id="customServiceName"
            name="customServiceName"
            type="text"
            // Deliberately no `required` -- an empty submit must reach our
            // own server-side validation and inline red-state UI (see
            // fieldErrorProps/FieldError above), not the browser's native
            // constraint-validation popup, which bypasses the Server
            // Action entirely and never shows our styled error.
            maxLength={160}
            placeholder="e.g. Deck repair, Patio extension, Custom remodel"
            {...fieldErrorProps(state.fieldErrors, "customServiceName")}
          />
          <FieldError fieldErrors={state.fieldErrors} id="customServiceName" />
        </div>
      ) : null}

      <div className="tenant-form" style={{ justifyContent: "flex-end" }}>
        <Link href="/proposals" className="button-secondary">
          Cancel
        </Link>
        <SubmitButton pendingText="Creating…">Save and continue</SubmitButton>
      </div>
    </form>
  );
}
