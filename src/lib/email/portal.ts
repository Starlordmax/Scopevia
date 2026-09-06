import "server-only";

import { resolveEmailProvider } from "./provider-selection";
import { sendViaDevCapture } from "./providers/dev";
import { sendViaResend } from "./providers/resend";
import type { PortalCodeEmailInput } from "./types";

export type { PortalCodeEmailInput };

/**
 * Sends a client portal one-time access code to `input.email`. The single
 * call site every portal OTP request goes through — see
 * docs/55-client-portal-email-delivery.md for the full provider strategy.
 *
 * Dispatches on `EMAIL_PROVIDER` via resolveEmailProvider() (pure logic,
 * unit-tested directly — see src/lib/email/provider-selection.ts). Throws
 * on any failure: an unrecognized provider, a not-yet-implemented one
 * (`sendgrid`/`smtp`), `dev` refused in a real production deployment, a
 * misconfigured `resend` (missing API key/from address), or a real
 * send failure. The CALLER (src/actions/portal-visitor.ts) decides what,
 * if anything, reaches the browser — see that file for why a send failure
 * must never produce a browser-visible outcome different from a normal
 * request, to preserve the "no revelar si el email existe" guarantee.
 */
export async function sendPortalCodeEmail(input: PortalCodeEmailInput): Promise<void> {
  const resolved = resolveEmailProvider({
    emailProvider: process.env.EMAIL_PROVIDER,
    nodeEnv: process.env.NODE_ENV,
    allowDevProviderInProduction: process.env.EMAIL_ALLOW_DEV_PROVIDER_IN_PRODUCTION,
  });

  if (!resolved.ok) {
    throw new Error(resolved.error);
  }

  switch (resolved.provider) {
    case "dev":
      return sendViaDevCapture(input);
    case "resend":
      return sendViaResend(input);
    case "sendgrid":
    case "smtp":
      throw new Error(
        `Email provider "${resolved.provider}" is not implemented yet in sendPortalCodeEmail() (src/lib/email/portal.ts) — see docs/55-client-portal-email-delivery.md.`
      );
  }
}

/**
 * True if the resolved provider is `dev` — used ONLY to show a discreet,
 * contractor-facing notice ("Email provider is in development mode...")
 * on the internal proposal detail page. Never surfaced anywhere on the
 * public portal (`/p/[token]/**`).
 */
export function isUsingDevEmailProvider(): boolean {
  const resolved = resolveEmailProvider({
    emailProvider: process.env.EMAIL_PROVIDER,
    nodeEnv: process.env.NODE_ENV,
    allowDevProviderInProduction: process.env.EMAIL_ALLOW_DEV_PROVIDER_IN_PRODUCTION,
  });
  return resolved.ok && resolved.provider === "dev";
}
