"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signInAction, type ActionResult } from "../../../actions/auth";
import { SubmitButton } from "../../../components/submit-button";

const initialState: ActionResult = {};

export default function SignInPage() {
  const [state, formAction] = useActionState(signInAction, initialState);

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
          <input id="email" name="email" type="email" autoComplete="email" required />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
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
