"use client";

import { useActionState } from "react";
import { verifyPortalOtpAction, requestPortalOtpAction, type PortalActionResult } from "../../../../actions/portal-visitor";
import { SubmitButton } from "../../../../components/submit-button";

const initialState: PortalActionResult = {};

export function VerifyCodeForm({ token, email }: { token: string; email: string }) {
  const [verifyState, verifyAction] = useActionState(verifyPortalOtpAction, initialState);
  const [resendState, resendAction] = useActionState(requestPortalOtpAction, initialState);

  return (
    <div className="stack">
      <form action={verifyAction} className="stack">
        {verifyState.error ? <p className="error-banner">{verifyState.error}</p> : null}

        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="email" value={email} />

        <div className="field">
          <label htmlFor="code">Access code</label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            placeholder="123456"
          />
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
