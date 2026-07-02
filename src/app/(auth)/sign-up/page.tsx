"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUpAction, type ActionResult } from "../../../actions/auth";
import { SubmitButton } from "../../../components/submit-button";

const initialState: ActionResult = {};

export default function SignUpPage() {
  const [state, formAction] = useActionState(signUpAction, initialState);

  return (
    <div className="card stack">
      <div>
        <h1>Create your account</h1>
        <p className="hint">Takes about a minute.</p>
      </div>

      <form action={formAction} className="stack">
        {state.error ? <p className="error-banner">{state.error}</p> : null}

        <div className="field">
          <label htmlFor="fullName">Full name</label>
          <input id="fullName" name="fullName" type="text" autoComplete="name" />
        </div>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
          <span className="hint">At least 8 characters.</span>
        </div>

        <SubmitButton pendingText="Creating account…">Create account</SubmitButton>
      </form>

      <span className="hint">
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </span>
    </div>
  );
}
