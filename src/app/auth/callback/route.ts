import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { resolveSiteOrigin } from "../../../lib/auth/site-origin";
import { sanitizeNextPath } from "../../../lib/auth/safe-redirect";

/**
 * Exchanges a Supabase Auth PKCE `code` (email confirmation, password
 * recovery, magic link) for a session cookie, then redirects onward.
 *
 * The final redirect is built from the CANONICAL app URL
 * (`NEXT_PUBLIC_SITE_URL`/`APP_BASE_URL`, via resolveSiteOrigin() — the
 * same helper src/actions/auth.ts uses to build emailRedirectTo/redirectTo
 * in the first place) — deliberately NEVER from this request's own
 * `request.url` origin. Behind Render's proxy, a Node route handler's
 * `request.url` is not guaranteed to reflect the public-facing host the
 * browser actually used; using it here previously sent a user who had
 * just clicked a correctly-Render-hosted confirmation link back to
 * `localhost` on the final hop, even though Supabase itself had resolved
 * `redirect_to` correctly. See docs/68-auth-callback-localhost-redirect-fix.md.
 *
 * `next` is client-supplied (a query param on a link Supabase controls,
 * but still untrusted input by the time it reaches this handler) and is
 * sanitized to a same-origin relative path only — see
 * src/lib/auth/safe-redirect.ts.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeNextPath(searchParams.get("next"));
  const siteUrl = resolveSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_BASE_URL, request.headers.get("origin"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, siteUrl));
    }
  }

  return NextResponse.redirect(new URL("/sign-in?error=auth_callback_failed", siteUrl));
}
