"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signInAction, type ActionResult } from "../../../actions/auth";
import { SubmitButton } from "../../../components/submit-button";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../../components/form-field-error";

const initialState: ActionResult = {};

export default function SignInPage() {
  const [state, formAction] = useActionState(signInAction, initialState);
  useFocusFirstFieldError(state.fieldErrors);

  return (
    <div className="card stack">
      <div>
        <h1>Scopevia</h1>
        <p className="hint">Sign in to your account</p>
      </div>

      <form action={formAction} className="stack">
        {state.error ? <p className="error-banner">{state.error}</p> : null}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" {...fieldErrorProps(state.fieldErrors, "email")} />
          <FieldError fieldErrors={state.fieldErrors} id="email" />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            {...fieldErrorProps(state.fieldErrors, "password")}
          />
          <FieldError fieldErrors={state.fieldErrors} id="password" />
        </div>

        <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
      </form>

      <div className="stack" style={{ gap: 4 }}>
        <Link href="/forgot-password">Forgot your password?</Link>
        <span className="hint">
          New to Scopevia? <Link href="/sign-up">Create an account</Link>
        </span>
      </div>
    </div>
  );
}
