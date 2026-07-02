"use client";

import { useActionState } from "react";
import { updateMembershipAction } from "../../../actions/tenant";
import type { ActionResult } from "../../../actions/auth";

const initialState: ActionResult = {};

const ROLE_OPTIONS = ["admin", "estimator", "sales", "field_worker", "viewer"] as const;

export function MemberRow({
  tenantId,
  membershipId,
  currentRoleKey,
  currentStatus,
  isSelf,
  isOwnerRow,
  canUpdate,
  canRemove,
}: {
  tenantId: string;
  membershipId: string;
  currentRoleKey: string;
  currentStatus: string;
  isSelf: boolean;
  isOwnerRow: boolean;
  canUpdate: boolean;
  canRemove: boolean;
}) {
  const [state, formAction] = useActionState(updateMembershipAction, initialState);

  // The database independently enforces both of these (see
  // update_membership() / protect_last_owner() / prevent_self_membership_modification()
  // in supabase/migrations/20260701120700_auth_and_tenant_functions.sql) —
  // disabling here is a UX courtesy, not the security boundary.
  const disabled = isSelf || isOwnerRow;

  if (disabled) {
    return <span className="hint">{isSelf ? "This is you" : "Owner-managed"}</span>;
  }

  // A pending invitation (status=invited) can only be accepted by the
  // invited user themselves (accept_invitation()) — update_membership()
  // explicitly rejects an admin forcing invited -> active (see
  // supabase/migrations/20260701121000_security_hardening.sql). The only
  // action available here is canceling the invitation before it's accepted.
  if (currentStatus === "invited") {
    if (!canRemove) return <span className="hint">Invitation pending</span>;
    return (
      <form action={formAction} className="stack" style={{ gap: 6 }}>
        {state.error ? <p className="error-banner">{state.error}</p> : null}
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="membershipId" value={membershipId} />
        <input type="hidden" name="status" value="removed" />
        <button type="submit" className="button-danger">
          Cancel invitation
        </button>
      </form>
    );
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      {state.error ? <p className="error-banner">{state.error}</p> : null}

      {canUpdate ? (
        <form action={formAction} className="tenant-form">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="membershipId" value={membershipId} />
          <select name="roleKey" defaultValue={currentRoleKey} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </form>
      ) : null}

      {canUpdate && currentStatus !== "removed" ? (
        <form action={formAction}>
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="membershipId" value={membershipId} />
          <input type="hidden" name="status" value={currentStatus === "active" ? "suspended" : "active"} />
          <button type="submit" className="button-secondary">
            {currentStatus === "active" ? "Suspend" : "Reactivate"}
          </button>
        </form>
      ) : null}

      {canRemove && currentStatus !== "removed" ? (
        <form action={formAction}>
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="membershipId" value={membershipId} />
          <input type="hidden" name="status" value="removed" />
          <button type="submit" className="button-danger">
            Remove
          </button>
        </form>
      ) : null}
    </div>
  );
}
