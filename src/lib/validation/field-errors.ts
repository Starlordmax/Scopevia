import type { ZodError } from "zod";

/**
 * Converts a failed Zod parse into a flat `{ fieldName: message }` map —
 * one message per top-level field (the first issue Zod reported for that
 * field wins, matching how a form shows one error per input). Used by
 * every Server Action that needs inline, per-field validation instead of
 * a single generic error banner — see
 * docs/74-custom-service-name-and-multistroke-drawing.md, "Validation UX."
 *
 * `path[0]` is used as the field key even for nested/discriminated-union
 * schemas — every schema this is used with is a flat object (or a
 * discriminated union of flat objects), so a top-level field name is
 * always the right key to match a form's `name`/`id` attribute.
 */
export function zodIssuesToFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in fieldErrors)) {
      fieldErrors[key] = issue.message;
    }
  }
  return fieldErrors;
}

/**
 * Best-effort attribution of a friendly RPC error message to a single
 * form field, for the validation an SQL function performs that a Zod
 * schema can't (e.g. "is this shape actually closed" or a
 * database-level re-check of something already validated client-side).
 * `mapping` is an ordered list of `[substring, fieldName]` pairs, checked
 * in order — the first match wins. Returns `undefined` (fall back to the
 * existing generic error banner) when nothing matches, so a message this
 * function doesn't recognize is never silently swallowed.
 */
export function attributeRpcErrorToField(message: string, mapping: [string, string][]): string | undefined {
  for (const [substring, field] of mapping) {
    if (message.includes(substring)) return field;
  }
  return undefined;
}
