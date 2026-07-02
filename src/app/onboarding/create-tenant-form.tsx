"use client";

import { useActionState, useState } from "react";
import { createTenantAction } from "../../actions/tenant";
import type { ActionResult } from "../../actions/auth";
import { SubmitButton } from "../../components/submit-button";
import { slugify } from "../../lib/validation/schemas";

const initialState: ActionResult = {};

export function CreateTenantForm() {
  const [state, formAction] = useActionState(createTenantAction, initialState);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  return (
    <form action={formAction} className="stack">
      {state.error ? <p className="error-banner">{state.error}</p> : null}

      <div className="field">
        <label htmlFor="name">Business name</label>
        <input
          id="name"
          name="name"
          type="text"
          required
          value={name}
          onChange={(e) => {
            const value = e.target.value;
            setName(value);
            if (!slugTouched) setSlug(slugify(value));
          }}
        />
      </div>

      <div className="field">
        <label htmlFor="slug">Business URL</label>
        <input
          id="slug"
          name="slug"
          type="text"
          required
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(slugify(e.target.value));
          }}
        />
        <span className="hint">scopevia.app/{slug || "your-business"}</span>
      </div>

      <SubmitButton pendingText="Creating…">Create business</SubmitButton>
    </form>
  );
}
