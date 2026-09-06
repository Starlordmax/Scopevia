/**
 * Pure "does this deployment have what it needs" check — no server-only
 * dependency (takes `env` explicitly, matching the established pattern for
 * security/config-relevant pure logic in this codebase — see
 * resolveEmailProvider(), src/lib/email/provider-selection.ts), so it's
 * directly unit-testable. Wired into instrumentation.ts so a real
 * production/staging boot (Render running `next start`, which always sets
 * NODE_ENV=production) fails LOUDLY at startup rather than deploying
 * "successfully" and only breaking on a real visitor's first OTP request —
 * see docs/64-render-staging-deployment.md, "Fail fast, not fail quiet."
 *
 * Deliberately a no-op outside production (`npm run dev`) — local
 * development is expected to run with a subset of these unset.
 */

export type EnvValidationResult = { ok: true } | { ok: false; errors: string[] };

export function validateStagingEnv(env: NodeJS.ProcessEnv): EnvValidationResult {
  if (env.NODE_ENV !== "production") {
    return { ok: true };
  }

  const errors: string[] = [];

  if (!env.NEXT_PUBLIC_SUPABASE_URL) errors.push("NEXT_PUBLIC_SUPABASE_URL is required.");
  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) errors.push("NEXT_PUBLIC_SUPABASE_ANON_KEY is required.");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) errors.push("SUPABASE_SERVICE_ROLE_KEY is required.");
  if (!env.APP_BASE_URL) errors.push("APP_BASE_URL is required.");

  const emailProvider = (env.EMAIL_PROVIDER ?? "dev").trim().toLowerCase();
  const devAllowedInProduction = env.EMAIL_ALLOW_DEV_PROVIDER_IN_PRODUCTION === "true";

  if (emailProvider === "dev" && !devAllowedInProduction) {
    errors.push(
      'EMAIL_PROVIDER=dev (or unset) is not allowed in production without EMAIL_ALLOW_DEV_PROVIDER_IN_PRODUCTION="true" — and that override should never be set on a real staging/production deployment (it exists only for local/CI E2E runs). Set EMAIL_PROVIDER=resend for a public staging deployment.'
    );
  }
  if (emailProvider === "resend") {
    if (!env.RESEND_API_KEY) errors.push("RESEND_API_KEY is required when EMAIL_PROVIDER=resend.");
    if (!env.EMAIL_FROM) errors.push("EMAIL_FROM is required when EMAIL_PROVIDER=resend.");
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
