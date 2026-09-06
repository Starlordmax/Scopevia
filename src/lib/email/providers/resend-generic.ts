import "server-only";

import { validateResendConfig } from "./resend-config";
import type { GenericEmailInput } from "../types";

const RESEND_API_URL = "https://api.resend.com/emails";

/**
 * Real send via the Resend HTTP API for a generic, already-rendered email
 * (Phase 3D notifications) — the same plain `fetch` POST approach as
 * providers/resend.ts (the OTP path), reusing validateResendConfig()
 * unchanged. Throws on any failure; never reads/logs the response body or
 * the API key, only the HTTP status — see src/lib/notifications/proposals.ts
 * for how the caller turns that into a sanitized, stored error_code.
 */
export async function sendViaResendGeneric(input: GenericEmailInput): Promise<void> {
  const validated = validateResendConfig({
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
    replyTo: process.env.EMAIL_REPLY_TO,
  });
  if (!validated.ok) {
    throw new Error(validated.error);
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${validated.config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: validated.config.from,
      to: input.to,
      reply_to: validated.config.replyTo,
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
  });

  if (!response.ok) {
    throw new Error(`Email provider "resend" request failed with HTTP status ${response.status}.`);
  }
}
