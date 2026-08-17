"use client";

import { useEffect } from "react";

/**
 * Shared inline field-validation primitives — every form wired for
 * per-field red states (Measurements step, New Proposal's custom service
 * name) uses these instead of inventing its own. See
 * docs/74-custom-service-name-and-multistroke-drawing.md, "Validation UX."
 *
 * Convention: a field error's key in `fieldErrors` is the input's `id`
 * (and usually its `name` too) — `fieldErrorProps`/`FieldError` both key
 * off that same id.
 */

/** Spread onto an input/select/textarea: red border via `.field-input-error`, plus aria-invalid/aria-describedby pointing at the paired <FieldError>. */
export function fieldErrorProps(fieldErrors: Record<string, string> | undefined, id: string) {
  const message = fieldErrors?.[id];
  if (!message) return {};
  return {
    className: "field-input-error",
    "aria-invalid": true as const,
    "aria-describedby": `${id}-error`,
  };
}

/** The red message shown under an invalid field — renders nothing when there's no error for `id`. */
export function FieldError({ fieldErrors, id }: { fieldErrors: Record<string, string> | undefined; id: string }) {
  const message = fieldErrors?.[id];
  if (!message) return null;
  return (
    <p id={`${id}-error`} className="field-error-text" role="alert">
      {message}
    </p>
  );
}

/**
 * Moves focus to the first invalid field once `fieldErrors` arrives from
 * a Server Action round-trip — "no depender solo de toast," the user's
 * cursor lands directly on what needs fixing. Looks up by id first (the
 * `fieldErrorProps`/`FieldError` convention above), falling back to
 * `[name="..."]` for the rare field whose form `name` differs from its
 * `id`.
 */
export function useFocusFirstFieldError(fieldErrors: Record<string, string> | undefined) {
  useEffect(() => {
    if (!fieldErrors) return;
    const firstKey = Object.keys(fieldErrors)[0];
    if (!firstKey) return;
    const el =
      (document.getElementById(firstKey) as HTMLElement | null) ??
      (document.querySelector(`[name="${firstKey}"]`) as HTMLElement | null);
    el?.focus();
  }, [fieldErrors]);
}
