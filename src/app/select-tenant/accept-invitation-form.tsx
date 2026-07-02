"use client";

import { useActionState } from "react";
import { acceptInvitationAction } from "../../actions/tenant";
import type { ActionResult } from "../../actions/auth";
import { SubmitButton } from "../../components/submit-button";

const initialState: ActionResult = {};

export function AcceptInvitationForm({ membershipId }: { membershipId: string }) {
  const [state, formAction] = useActionState(acceptInvitationAction, initialState);

  return (
    <form action={formAction} className="stack" style={{ gap: 4 }}>
      <input type="hidden" name="membershipId" value={membershipId} />
      {state.error ? <p className="error-banner">{state.error}</p> : null}
      <SubmitButton pendingText="Joining…" className="button-primary">
        Accept
      </SubmitButton>
    </form>
  );
}
