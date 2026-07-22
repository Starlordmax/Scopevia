"use client";

import { useActionState } from "react";
import { requestPortalOtpAction, type PortalActionResult } from "../../../actions/portal-visitor";
import { SubmitButton } from "../../../components/submit-button";

const initialState: PortalActionResult = {};

export function RequestCodeForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(requestPortalOtpAction, initialState);

  return (
    <form action={formAction} className="stack">
      {state.error ? <p className="error-banner">{state.error}</p> : null}

      <input type="hidden" name="token" value={token} />

      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
        <p className="hint">Enter the email address where you received this proposal.</p>
      </div>

      <SubmitButton pendingText="Sending…">Send access code</SubmitButton>
    </form>
  );
}
