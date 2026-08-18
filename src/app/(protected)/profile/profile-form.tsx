"use client";

import { useActionState } from "react";
import { updateProfileAction } from "../../../actions/profile";
import type { ActionResult } from "../../../actions/auth";
import { SubmitButton } from "../../../components/submit-button";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../../components/form-field-error";

const initialState: ActionResult = {};

export function ProfileForm({
  email,
  fullName,
  locale,
  timezone,
}: {
  email: string;
  fullName: string;
  locale: string;
  timezone: string;
}) {
  const [state, formAction] = useActionState(updateProfileAction, initialState);
  useFocusFirstFieldError(state.fieldErrors);

  return (
    <form action={formAction} noValidate className="stack">
      {state.error ? <p className="error-banner">{state.error}</p> : null}

      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={email} disabled />
        <span className="hint">Your email is used to sign in and can&apos;t be changed here.</span>
      </div>

      <div className="field">
        <label htmlFor="fullName">Full name</label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          defaultValue={fullName}
          {...fieldErrorProps(state.fieldErrors, "fullName")}
        />
        <FieldError fieldErrors={state.fieldErrors} id="fullName" />
      </div>

      <div className="field">
        <label htmlFor="locale">Locale</label>
        <input id="locale" name="locale" type="text" defaultValue={locale} {...fieldErrorProps(state.fieldErrors, "locale")} />
        <FieldError fieldErrors={state.fieldErrors} id="locale" />
      </div>

      <div className="field">
        <label htmlFor="timezone">Timezone</label>
        <input
          id="timezone"
          name="timezone"
          type="text"
          defaultValue={timezone}
          {...fieldErrorProps(state.fieldErrors, "timezone")}
        />
        <FieldError fieldErrors={state.fieldErrors} id="timezone" />
      </div>

      <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
    </form>
  );
}
