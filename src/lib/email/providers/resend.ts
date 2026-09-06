import "server-only";

import { renderPortalCodeEmail } from "../templates/portal-code";
import { validateResendConfig } from "./resend-config";
import type { PortalCodeEmailInput } from "../types";

const RESEND_API_URL = "https://api.resend.com/emails";

/**
 * Real send via the Resend HTTP API — a plain `fetch` POST, not the
 * `resend` npm package, to avoid a new dependency for a single API call
 * (per the brief's "sin meter complejidad innecesaria"). Throws on any
 * failure; the caller (src/lib/email/portal.ts) is responsible for
 * catching and deciding what, if anything, reaches the browser — this
 * function itself never sanitizes for the client, only for logs (see the
 * error message below, which never includes the API key or the raw
 * response body).
 */
export async function sendViaResend(input: PortalCodeEmailInput): Promise<void> {
  const validated = validateResendConfig({
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
    replyTo: process.env.EMAIL_REPLY_TO,
  });
  if (!validated.ok) {
    throw new Error(validated.error);
  }

  const { subject, text, html } = renderPortalCodeEmail(input);

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${validated.config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: validated.config.from,
      to: input.email,
      reply_to: validated.config.replyTo,
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    // Deliberately does not read or log the response body (could echo
    // back request details) or the API key — only the HTTP status.
    throw new Error(`Email provider "resend" request failed with HTTP status ${response.status}.`);
  }
}
