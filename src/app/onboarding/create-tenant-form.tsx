"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createTenantAction } from "../../actions/tenant";
import type { ActionResult } from "../../actions/auth";
import { SubmitButton } from "../../components/submit-button";
import { slugify } from "../../lib/validation/schemas";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../components/form-field-error";

const initialState: ActionResult = {};

export function CreateTenantForm() {
  const [state, formAction] = useActionState(createTenantAction, initialState);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  useFocusFirstFieldError(state.fieldErrors);

  // React's <form action={...}> performs a native-like form reset after
  // every action response, success or failure -- for a CONTROLLED field
  // (both of these, so the auto-derived slug can react to typed name)
  // this can silently desync the DOM from React's own state without a
  // matching re-render (React only re-applies `value` when the state
  // it's derived from changes). Force-resyncing via a ref+effect after
  // every response is the reliable fix -- see
  // docs/74-custom-service-name-and-multistroke-drawing.md, "A real bug
  // found and fixed."
  const nameRef = useRef<HTMLInputElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (nameRef.current) nameRef.current.value = name;
    if (slugRef.current) slugRef.current.value = slug;
  }, [state, name, slug]);

  return (
    <form action={formAction} noValidate className="stack">
      {state.error ? <p className="error-banner">{state.error}</p> : null}

      <div className="field">
        <label htmlFor="name">Business name</label>
        <input
          ref={nameRef}
          id="name"
          name="name"
          type="text"
          value={name}
          onChange={(e) => {
            const value = e.target.value;
            setName(value);
            if (!slugTouched) setSlug(slugify(value));
          }}
          {...fieldErrorProps(state.fieldErrors, "name")}
        />
        <FieldError fieldErrors={state.fieldErrors} id="name" />
      </div>

      <div className="field">
        <label htmlFor="slug">Business URL</label>
        <input
          ref={slugRef}
          id="slug"
          name="slug"
          type="text"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(slugify(e.target.value));
          }}
          {...fieldErrorProps(state.fieldErrors, "slug")}
        />
        <FieldError fieldErrors={state.fieldErrors} id="slug" />
        <span className="hint">scopevia.app/{slug || "your-business"}</span>
      </div>

      <SubmitButton pendingText="Creating…">Create business</SubmitButton>
    </form>
  );
}
