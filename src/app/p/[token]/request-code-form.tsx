"use client";

import { useActionState } from "react";
import { requestPortalOtpAction, type PortalActionResult } from "../../../actions/portal-visitor";
import { SubmitButton } from "../../../components/submit-button";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../../components/form-field-error";

const initialState: PortalActionResult = {};

export function RequestCodeForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(requestPortalOtpAction, initialState);
  useFocusFirstFieldError(state.fieldErrors);

  return (
    <form action={formAction} noValidate className="stack">
      {state.error ? <p className="error-banner">{state.error}</p> : null}

      <input type="hidden" name="token" value={token} />

      <div className="field">
        <label htmlFor="email">Email</label>
        {/* No `required` -- an empty/invalid submit must reach our own
            server-side validation and inline red-state UI, not the
            browser's native popup. */}
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          {...fieldErrorProps(state.fieldErrors, "email")}
        />
        <FieldError fieldErrors={state.fieldErrors} id="email" />
        <p className="hint">Enter the email address where you received this proposal.</p>
      </div>

      <SubmitButton pendingText="Sending…">Send access code</SubmitButton>
    </form>
  );
}
