/**
 * Pure config validation for the Resend provider — no server-only
 * dependency, so it's directly unit-testable (see
 * tests/unit/email-provider-selection.test.ts) even though the actual
 * HTTP send (providers/resend.ts) is server-only.
 */

export type ResendConfig = { apiKey: string; from: string; replyTo?: string };

export type ResendConfigInput = {
  apiKey: string | undefined;
  from: string | undefined;
  replyTo: string | undefined;
};

export type ResendConfigResult = { ok: true; config: ResendConfig } | { ok: false; error: string };

export function validateResendConfig(input: ResendConfigInput): ResendConfigResult {
  const missing: string[] = [];
  if (!input.apiKey) missing.push("RESEND_API_KEY");
  if (!input.from) missing.push("EMAIL_FROM");

  if (missing.length > 0) {
    return { ok: false, error: `Email provider "resend" is not fully configured (missing ${missing.join(", ")}).` };
  }

  return { ok: true, config: { apiKey: input.apiKey as string, from: input.from as string, replyTo: input.replyTo || undefined } };
}
