"use client";

import { useActionState, useState } from "react";
import { createClientAction, updateClientAction } from "../../../actions/clients";
import type { ActionResult } from "../../../actions/auth";
import { SubmitButton } from "../../../components/submit-button";
import type { Database } from "../../../../types/database";

type Client = Database["public"]["Tables"]["clients"]["Row"];

const initialState: ActionResult = {};

export function ClientForm({ tenantId, client }: { tenantId: string; client?: Client }) {
  const isEdit = Boolean(client);
  const [state, formAction] = useActionState(isEdit ? updateClientAction : createClientAction, initialState);
  const [clientType, setClientType] = useState(client?.client_type ?? "individual");

  return (
    <form action={formAction} className="stack">
      {state.error ? <p className="error-banner">{state.error}</p> : null}
      <input type="hidden" name="tenantId" value={tenantId} />
      {client ? <input type="hidden" name="clientId" value={client.id} /> : null}

      <div className="field">
        <label htmlFor="clientType">Client type</label>
        <select id="clientType" name="clientType" value={clientType} onChange={(e) => setClientType(e.target.value)}>
          <option value="individual">Individual</option>
          <option value="business">Business</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="displayName">Display name</label>
        <input id="displayName" name="displayName" type="text" required defaultValue={client?.display_name} />
        <span className="hint">What you&apos;ll see in lists — e.g. &quot;Sarah Nguyen&quot; or &quot;Acme Property Management&quot;.</span>
      </div>

      {clientType === "business" ? (
        <div className="field">
          <label htmlFor="legalName">Legal name</label>
          <input id="legalName" name="legalName" type="text" defaultValue={client?.legal_name ?? ""} />
        </div>
      ) : (
        <div className="tenant-form" style={{ width: "100%" }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="firstName">First name</label>
            <input id="firstName" name="firstName" type="text" defaultValue={client?.first_name ?? ""} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="lastName">Last name</label>
            <input id="lastName" name="lastName" type="text" defaultValue={client?.last_name ?? ""} />
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" defaultValue={client?.email ?? ""} />
      </div>

      <div className="tenant-form" style={{ width: "100%" }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="phone">Phone</label>
          <input id="phone" name="phone" type="tel" defaultValue={client?.phone ?? ""} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="secondaryPhone">Secondary phone</label>
          <input id="secondaryPhone" name="secondaryPhone" type="tel" defaultValue={client?.secondary_phone ?? ""} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" defaultValue={client?.website ?? ""} />
      </div>

      <div className="field">
        <label htmlFor="preferredContactMethod">Preferred contact method</label>
        <select id="preferredContactMethod" name="preferredContactMethod" defaultValue={client?.preferred_contact_method ?? ""}>
          <option value="">No preference</option>
          <option value="email">Email</option>
          <option value="phone">Phone</option>
          <option value="text">Text</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="source">Source</label>
        <input id="source" name="source" type="text" placeholder="Referral, website, walk-in…" defaultValue={client?.source ?? ""} />
      </div>

      <label className="tenant-form" style={{ alignItems: "center" }}>
        <input type="checkbox" name="taxExempt" defaultChecked={client?.tax_exempt ?? false} style={{ width: "auto", minHeight: 0 }} />
        Tax exempt
      </label>

      <SubmitButton pendingText="Saving…">{isEdit ? "Save changes" : "Create client"}</SubmitButton>
    </form>
  );
}
