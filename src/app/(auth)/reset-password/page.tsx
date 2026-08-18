"use client";

import { useActionState } from "react";
import { resetPasswordAction, type ActionResult } from "../../../actions/auth";
import { SubmitButton } from "../../../components/submit-button";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../../components/form-field-error";

const initialState: ActionResult = {};

export default function ResetPasswordPage() {
  const [state, formAction] = useActionState(resetPasswordAction, initialState);
  useFocusFirstFieldError(state.fieldErrors);

  return (
    <div className="card stack">
      <div>
        <h1>Choose a new password</h1>
        <p className="hint">You followed a valid password reset link.</p>
      </div>

      <form action={formAction} noValidate className="stack">
        {state.error ? <p className="error-banner">{state.error}</p> : null}

        <div className="field">
          <label htmlFor="password">New password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            {...fieldErrorProps(state.fieldErrors, "password")}
          />
          <FieldError fieldErrors={state.fieldErrors} id="password" />
        </div>

        <div className="field">
          <label htmlFor="confirmPassword">Confirm new password</label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            {...fieldErrorProps(state.fieldErrors, "confirmPassword")}
          />
          <FieldError fieldErrors={state.fieldErrors} id="confirmPassword" />
        </div>

        <SubmitButton pendingText="Saving…">Save new password</SubmitButton>
      </form>
    </div>
  );
}
