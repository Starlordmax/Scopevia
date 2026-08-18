"use client";

import { useActionState, useState } from "react";
import { acceptProposalAction, declineProposalAction, type PortalActionResult } from "../../../../actions/portal-visitor";
import { ConfirmSubmitButton } from "../../../../components/confirm-submit-button";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../../../components/form-field-error";

const initial: PortalActionResult = {};

export type ExistingResponse = {
  responseType: "accepted" | "declined";
} | null;

export function PortalResponseSection({ token, existingResponse }: { token: string; existingResponse: ExistingResponse }) {
  const [acceptState, acceptAction] = useActionState(acceptProposalAction, initial);
  const [declineState, declineAction] = useActionState(declineProposalAction, initial);
  const [mode, setMode] = useState<"none" | "accept" | "decline">("none");
  useFocusFirstFieldError(mode === "accept" ? acceptState.fieldErrors : mode === "decline" ? declineState.fieldErrors : undefined);

  if (existingResponse) {
    return (
      <div className="section-card stack" id="response">
        {existingResponse.responseType === "accepted" ? (
          <>
            <h3>Proposal accepted</h3>
            <p className="hint">Thank you. Your approval has been recorded and the contractor has been notified inside Scopevia.</p>
          </>
        ) : (
          <>
            <h3>Proposal declined</h3>
            <p className="hint">Your response has been recorded.</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="section-card stack" id="response">
      <h3>Ready to move forward?</h3>
      <p className="hint">Review the proposal details above. When you&apos;re ready, you can accept this proposal.</p>

      {mode === "none" ? (
        <div className="tenant-form">
          <button type="button" className="button-primary" onClick={() => setMode("accept")}>
            Accept proposal
          </button>
          <button type="button" className="button-secondary" onClick={() => setMode("decline")}>
            Decline
          </button>
        </div>
      ) : null}

      {mode === "accept" ? (
        <form action={acceptAction} noValidate className="stack">
          {acceptState.error ? <p className="error-banner">{acceptState.error}</p> : null}
          <input type="hidden" name="token" value={token} />

          <div className="field">
            <label htmlFor="clientName">Your name</label>
            {/* No `required` -- an empty submit must reach our own
                server-side validation and inline red-state UI. */}
            <input
              id="clientName"
              name="clientName"
              type="text"
              placeholder="Jane Doe"
              {...fieldErrorProps(acceptState.fieldErrors, "clientName")}
            />
            <FieldError fieldErrors={acceptState.fieldErrors} id="clientName" />
          </div>

          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input
              id="acceptedTerms"
              type="checkbox"
              name="acceptedTerms"
              style={{ marginTop: 4 }}
              aria-invalid={acceptState.fieldErrors?.acceptedTerms ? true : undefined}
              aria-describedby={acceptState.fieldErrors?.acceptedTerms ? "acceptedTerms-error" : undefined}
            />
            <span>I confirm that I have reviewed this proposal and approve the scope and pricing shown above.</span>
          </label>
          <FieldError fieldErrors={acceptState.fieldErrors} id="acceptedTerms" />

          <div className="tenant-form">
            <ConfirmSubmitButton
              className="button-primary"
              confirmMessage="Accept this proposal? This confirms you approve the scope and pricing shown."
              pendingText="Accepting…"
            >
              Accept proposal
            </ConfirmSubmitButton>
            <button type="button" className="button-secondary" onClick={() => setMode("none")}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {mode === "decline" ? (
        <form action={declineAction} noValidate className="stack">
          {declineState.error ? <p className="error-banner">{declineState.error}</p> : null}
          <input type="hidden" name="token" value={token} />
          <p className="hint">You can decline this proposal and optionally share a reason with the contractor.</p>

          <div className="field">
            <label htmlFor="declineReason">Reason (optional)</label>
            <textarea id="declineReason" name="declineReason" rows={3} />
          </div>

          <div className="tenant-form">
            <ConfirmSubmitButton className="button-danger" confirmMessage="Decline this proposal?" pendingText="Declining…">
              Decline proposal
            </ConfirmSubmitButton>
            <button type="button" className="button-secondary" onClick={() => setMode("none")}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
