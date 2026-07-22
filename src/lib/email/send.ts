import "server-only";

import { resolveEmailProvider, type EmailProviderName } from "./provider-selection";
import { sendViaDevCaptureGeneric } from "./providers/dev-generic";
import { sendViaResendGeneric } from "./providers/resend-generic";
import type { GenericEmailInput } from "./types";

export type { GenericEmailInput };

/**
 * Sends a generic, already-rendered email to exactly one recipient — the
 * single call site every Phase 3D notification goes through
 * (src/lib/notifications/proposals.ts). Deliberately separate from
 * sendPortalCodeEmail() (src/lib/email/portal.ts): that function stays
 * exactly as it was, narrow and OTP-specific, so nothing about this phase
 * touches the already-battle-tested access-code delivery path.
 *
 * Dispatches on `EMAIL_PROVIDER` via the SAME resolveEmailProvider() the
 * OTP path uses (pure, unit-tested, unchanged) — identical production
 * safety guarantee: `dev` is refused in a real production deployment
 * unless EMAIL_ALLOW_DEV_PROVIDER_IN_PRODUCTION="true" is explicitly set.
 * Throws on any failure — the caller decides how to record/log it (see
 * docs/63-notification-delivery-security.md, "Delivery failure never
 * blocks the client").
 */
export async function sendEmail(input: GenericEmailInput): Promise<void> {
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
      return sendViaDevCaptureGeneric(input);
    case "resend":
      return sendViaResendGeneric(input);
    case "sendgrid":
    case "smtp":
      throw new Error(`Email provider "${resolved.provider}" is not implemented yet in sendEmail() (src/lib/email/send.ts).`);
  }
}

const KNOWN_PROVIDER_NAMES: EmailProviderName[] = ["dev", "resend", "sendgrid", "smtp"];

/**
 * The CONFIGURED provider name, for labeling a proposal_notification_deliveries
 * row — independent of whether that provider is actually ALLOWED to run right
 * now (the dev-in-production gate is a send-time safety decision, enforced
 * only by sendEmail() itself; this is purely a label, so a misconfigured
 * EMAIL_PROVIDER shows up as what was actually configured, not a silent
 * "dev" fallback that would misrepresent why the send failed).
 */
export function configuredEmailProviderName(): EmailProviderName {
  const raw = (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  const provider = raw === "" ? "dev" : raw;
  return (KNOWN_PROVIDER_NAMES as string[]).includes(provider) ? (provider as EmailProviderName) : "dev";
}
