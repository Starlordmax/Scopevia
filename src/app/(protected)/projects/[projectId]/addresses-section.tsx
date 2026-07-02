"use client";

import { useActionState, useState } from "react";
import {
  createProjectAddressAction,
  setPrimaryProjectAddressAction,
  archiveProjectAddressAction,
} from "../../../../actions/projects";
import type { ActionResult } from "../../../../actions/auth";
import { SubmitButton } from "../../../../components/submit-button";
import type { Database } from "../../../../../types/database";

type Address = Database["public"]["Tables"]["project_addresses"]["Row"];

const initialState: ActionResult = {};

export function AddressesSection({
  projectId,
  addresses,
  canUpdate,
}: {
  projectId: string;
  addresses: Address[];
  canUpdate: boolean;
}) {
  const [createState, createAction] = useActionState(createProjectAddressAction, initialState);
  const [showForm, setShowForm] = useState(addresses.length === 0);

  return (
    <div className="stack">
      {addresses.length === 0 ? (
        <p className="hint">No work-site address yet.</p>
      ) : (
        <ul className="stack" style={{ gap: 10, listStyle: "none", padding: 0, margin: 0 }}>
          {addresses.map((a) => (
            <li key={a.id} className="card" style={{ padding: 12 }}>
              <div>
                {a.address_line_1}
                {a.address_line_2 ? `, ${a.address_line_2}` : ""}
                {a.is_primary ? <span className="badge"> Primary</span> : null}
                {a.archived_at ? <span className="badge"> Archived</span> : null}
              </div>
              <div className="hint">
                {a.city}, {a.state} {a.postal_code}
              </div>
              {a.access_instructions ? <div className="hint">Access: {a.access_instructions}</div> : null}

              {canUpdate && !a.archived_at ? (
                <div className="tenant-form" style={{ marginTop: 8 }}>
                  {!a.is_primary ? (
                    <form action={setPrimaryProjectAddressAction}>
                      <input type="hidden" name="addressId" value={a.id} />
                      <input type="hidden" name="projectId" value={projectId} />
                      <button type="submit" className="button-secondary">
                        Make primary
                      </button>
                    </form>
                  ) : null}
                  <form action={archiveProjectAddressAction}>
                    <input type="hidden" name="addressId" value={a.id} />
                    <input type="hidden" name="projectId" value={projectId} />
                    <button type="submit" className="button-danger">
                      Archive
                    </button>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canUpdate ? (
        showForm ? (
          <form action={createAction} className="stack">
            {createState.error ? <p className="error-banner">{createState.error}</p> : null}
            <input type="hidden" name="projectId" value={projectId} />
            <div className="field">
              <label htmlFor="addressLine1">Address line 1</label>
              <input id="addressLine1" name="addressLine1" type="text" required />
            </div>
            <div className="field">
              <label htmlFor="addressLine2">Address line 2</label>
              <input id="addressLine2" name="addressLine2" type="text" />
            </div>
            <div className="tenant-form" style={{ width: "100%" }}>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="city">City</label>
                <input id="city" name="city" type="text" required />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="state">State</label>
                <input id="state" name="state" type="text" required maxLength={40} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="postalCode">Postal code</label>
                <input id="postalCode" name="postalCode" type="text" required />
              </div>
            </div>
            <div className="field">
              <label htmlFor="accessInstructions">Access instructions</label>
              <input id="accessInstructions" name="accessInstructions" type="text" placeholder="Gate code, parking, dog on premises…" />
            </div>
            <label className="tenant-form" style={{ alignItems: "center" }}>
              <input type="checkbox" name="isPrimary" defaultChecked={addresses.length === 0} style={{ width: "auto", minHeight: 0 }} />
              Primary address
            </label>
            <SubmitButton pendingText="Adding…">Add address</SubmitButton>
          </form>
        ) : (
          <button type="button" className="button-secondary" onClick={() => setShowForm(true)}>
            + Add address
          </button>
        )
      ) : null}
    </div>
  );
}
