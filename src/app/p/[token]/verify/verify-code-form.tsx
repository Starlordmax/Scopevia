"use client";

import { useActionState } from "react";
import { verifyPortalOtpAction, requestPortalOtpAction, type PortalActionResult } from "../../../../actions/portal-visitor";
import { SubmitButton } from "../../../../components/submit-button";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../../../components/form-field-error";

const initialState: PortalActionResult = {};

export function VerifyCodeForm({ token, email }: { token: string; email: string }) {
  const [verifyState, verifyAction] = useActionState(verifyPortalOtpAction, initialState);
  const [resendState, resendAction] = useActionState(requestPortalOtpAction, initialState);
  useFocusFirstFieldError(verifyState.fieldErrors);

  return (
    <div className="stack">
      <form action={verifyAction} noValidate className="stack">
        {verifyState.error ? <p className="error-banner">{verifyState.error}</p> : null}

        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="email" value={email} />

        <div className="field">
          <label htmlFor="code">Access code</label>
          {/* No `required` -- see request-code-form.tsx's comment. */}
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="123456"
            {...fieldErrorProps(verifyState.fieldErrors, "code")}
          />
          <FieldError fieldErrors={verifyState.fieldErrors} id="code" />
          <p className="hint">Enter the 6-digit code we sent to your email.</p>
        </div>

        <SubmitButton pendingText="Verifying…">View proposal</SubmitButton>
      </form>

      <form action={resendAction} className="stack" style={{ gap: 4 }}>
        {resendState.error ? <p className="error-banner">{resendState.error}</p> : null}
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="email" value={email} />
        <button type="submit" className="button-secondary">
          Resend code
        </button>
      </form>
    </div>
  );
}
