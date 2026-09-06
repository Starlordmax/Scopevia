"use client";

import { useActionState } from "react";
import Link from "next/link";
import { forgotPasswordAction, type ActionResult } from "../../../actions/auth";
import { SubmitButton } from "../../../components/submit-button";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../../components/form-field-error";

const initialState: ActionResult = {};

export default function ForgotPasswordPage() {
  const [state, formAction] = useActionState(forgotPasswordAction, initialState);
  useFocusFirstFieldError(state.fieldErrors);

  return (
    <div className="card stack">
      <div>
        <h1>Reset your password</h1>
        <p className="hint">We&apos;ll email you a link to choose a new one.</p>
      </div>

      <form action={formAction} noValidate className="stack">
        {state.error ? <p className="error-banner">{state.error}</p> : null}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" {...fieldErrorProps(state.fieldErrors, "email")} />
          <FieldError fieldErrors={state.fieldErrors} id="email" />
        </div>

        <SubmitButton pendingText="Sending…">Send reset link</SubmitButton>
      </form>

      <Link href="/sign-in">Back to sign in</Link>
    </div>
  );
}
