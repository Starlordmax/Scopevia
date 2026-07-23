/**
 * Pure "is this `next` param safe to redirect to" check — no server-only
 * dependency, directly unit-testable. Used by /auth/callback (email
 * confirmation, password reset) to prevent an open-redirect: a
 * `?next=` query param is entirely client-supplied, so it must never be
 * used verbatim as a redirect target.
 *
 * Only a same-origin, relative path is accepted:
 * - Must start with a single `/` (a real relative path).
 * - Must NOT start with `//` — a browser resolves `//evil.com` as
 *   protocol-relative, i.e. an absolute URL to a different host once
 *   combined with a base via `new URL()` — the exact open-redirect vector
 *   this function exists to block.
 * - Must NOT contain `://` anywhere — defense in depth against a value
 *   like `/\evil.com` or other scheme-smuggling tricks some browsers have
 *   historically normalized in surprising ways.
 *
 * Anything that fails these checks (missing, malformed, or an attempted
 * external URL) falls back to `/sign-in` — never the raw input, and never
 * silently allowed through.
 */
export function sanitizeNextPath(rawNext: string | null | undefined): string {
  const fallback = "/sign-in";
  if (!rawNext) return fallback;
  if (!rawNext.startsWith("/")) return fallback;
  if (rawNext.startsWith("//")) return fallback;
  if (rawNext.includes("://")) return fallback;
  return rawNext;
}
