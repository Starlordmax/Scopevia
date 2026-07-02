"use client";

import { useActionState } from "react";
import { inviteMemberAction } from "../../../actions/tenant";
import type { ActionResult } from "../../../actions/auth";
import { SubmitButton } from "../../../components/submit-button";

const initialState: ActionResult = {};

const ROLE_OPTIONS = ["admin", "estimator", "sales", "field_worker", "viewer"] as const;

export function InviteMemberForm({ tenantId }: { tenantId: string }) {
  const [state, formAction] = useActionState(inviteMemberAction, initialState);

  return (
    <form action={formAction} className="stack">
      {state.error ? <p className="error-banner">{state.error}</p> : null}
      <input type="hidden" name="tenantId" value={tenantId} />

      <div className="field">
        <label htmlFor="invite-email">Email</label>
        <input id="invite-email" name="email" type="email" required />
      </div>

      <div className="field">
        <label htmlFor="invite-role">Role</label>
        <select id="invite-role" name="roleKey" defaultValue="viewer">
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <SubmitButton pendingText="Adding…">Add member</SubmitButton>
    </form>
  );
}
