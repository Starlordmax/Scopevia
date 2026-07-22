/**
 * Pure decision logic for "which email provider, and is that choice even
 * allowed" — deliberately factored out of src/lib/email/portal.ts (which
 * has `import "server-only"` and therefore can't be imported from a plain
 * Vitest unit test, the same constraint documented on src/lib/portal/
 * tokens.ts) so this specific, security-relevant branch is unit-testable
 * in isolation. Takes every input explicitly rather than reading
 * `process.env` itself — see tests/unit/email-provider-selection.test.ts.
 */

export type EmailProviderName = "dev" | "resend" | "sendgrid" | "smtp";

const KNOWN_PROVIDERS: EmailProviderName[] = ["dev", "resend", "sendgrid", "smtp"];

export type ResolveEmailProviderInput = {
  emailProvider: string | undefined;
  nodeEnv: string | undefined;
  allowDevProviderInProduction: string | undefined;
};

export type ResolveEmailProviderResult = { ok: true; provider: EmailProviderName } | { ok: false; error: string };

/**
 * `EMAIL_PROVIDER` unset (or `""`) defaults to `"dev"` — the local
 * dev/test capture path (see providers/dev.ts). An unrecognized value is
 * rejected outright rather than silently falling back to `dev`, since a
 * typo'd provider name must never quietly downgrade to "just log it."
 *
 * The one deliberately strict rule (brief: "En producción, no permitir
 * dev provider salvo que exista una variable explícita de override muy
 * clara y peligrosa"): `dev` is refused when `NODE_ENV === "production"`
 * UNLESS `EMAIL_ALLOW_DEV_PROVIDER_IN_PRODUCTION` is the exact string
 * `"true"`. This is NOT the same mistake as gating the whole feature on
 * `NODE_ENV` alone (the bug fixed in Phase 3A, see docs/54) — here
 * `NODE_ENV` is only ONE of two conditions, and the override exists
 * specifically so a `next start` build used for local/CI E2E testing
 * (this repo's own `.env.local`, gitignored, never a real deployment) can
 * explicitly opt back in, while a real production deployment that never
 * sets this dangerous variable stays blocked by default.
 */
export function resolveEmailProvider(input: ResolveEmailProviderInput): ResolveEmailProviderResult {
  const raw = (input.emailProvider ?? "").trim().toLowerCase();
  const provider = (raw === "" ? "dev" : raw) as EmailProviderName;

  if (!KNOWN_PROVIDERS.includes(provider)) {
    return { ok: false, error: `Unknown EMAIL_PROVIDER "${raw}". Expected one of: ${KNOWN_PROVIDERS.join(", ")}.` };
  }

  const allowDevInProduction = input.allowDevProviderInProduction === "true";

  if (provider === "dev" && input.nodeEnv === "production" && !allowDevInProduction) {
    return {
      ok: false,
      error:
        'EMAIL_PROVIDER=dev (or unset) is not allowed when NODE_ENV=production, unless EMAIL_ALLOW_DEV_PROVIDER_IN_PRODUCTION="true" is explicitly set. A real customer must never have their access code merely logged to a server console.',
    };
  }

  return { ok: true, provider };
}
