"use client";

import { useActionState } from "react";
import { resetPasswordAction, type ActionResult } from "../../../actions/auth";
import { SubmitButton } from "../../../components/submit-button";

const initialState: ActionResult = {};

export default function ResetPasswordPage() {
  const [state, formAction] = useActionState(resetPasswordAction, initialState);

  return (
    <div className="card stack">
      <div>
        <h1>Choose a new password</h1>
        <p className="hint">You followed a valid password reset link.</p>
      </div>

      <form action={formAction} className="stack">
        {state.error ? <p className="error-banner">{state.error}</p> : null}

        <div className="field">
          <label htmlFor="password">New password</label>
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        </div>

        <div className="field">
          <label htmlFor="confirmPassword">Confirm new password</label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>

        <SubmitButton pendingText="Saving…">Save new password</SubmitButton>
      </form>
    </div>
  );
}
