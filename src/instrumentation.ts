/**
 * Next.js instrumentation hook — `register()` runs once when the server
 * process starts, before it accepts any traffic. Used here purely to fail
 * fast on a misconfigured production/staging deployment (Render) — see
 * docs/64-render-staging-deployment.md. Never runs any Supabase/network
 * call itself; just checks that required env vars are present.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { validateStagingEnv } = await import("./lib/env-validation");
  const result = validateStagingEnv(process.env);

  if (!result.ok) {
    const message = ["Scopevia refused to start: missing/invalid environment configuration.", ...result.errors.map((e) => `  - ${e}`)].join("\n");
    console.error(message);
    throw new Error(message);
  }
}
