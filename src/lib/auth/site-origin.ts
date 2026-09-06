/**
 * Pure "which origin do auth redirect URLs (email confirmation, password
 * reset) point at" resolution — no server-only dependency, so directly
 * unit-testable. Takes `envSiteUrl`/`originHeader` explicitly rather than
 * reading `process.env`/`headers()` itself, matching the established
 * pattern for this kind of security/config-relevant pure logic (see
 * resolveEmailProvider(), buildInternalProposalUrl()).
 *
 * `NEXT_PUBLIC_SITE_URL` wins whenever it's set — deliberately, since a
 * request's `Origin` header is not something this app should treat as the
 * authoritative source for a value baked into an auth email (see the
 * root-cause writeup for why: Supabase Auth actually derives the real
 * confirmation link from its own Dashboard "Site URL"/"Redirect URLs"
 * config, not from anything this function returns — this only affects the
 * `emailRedirectTo`/`redirectTo` Scopevia ASKS Supabase to use, which must
 * still be present in Supabase's Redirect URLs allow-list to take effect).
 * The `Origin` header is a fallback for local/preview environments where
 * the env var might not be set; a hardcoded `localhost` is the last
 * resort, purely for zero-config local dev.
 */
export function resolveSiteOrigin(envSiteUrl: string | undefined, originHeader: string | null): string {
  const trimmedEnv = (envSiteUrl ?? "").trim().replace(/\/+$/, "");
  if (trimmedEnv !== "") return trimmedEnv;

  const trimmedHeader = (originHeader ?? "").trim().replace(/\/+$/, "");
  if (trimmedHeader !== "") return trimmedHeader;

  return "http://localhost:3000";
}
