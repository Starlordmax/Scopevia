/**
 * Pure URL construction for the "Open in Scopevia" link inside a
 * notification email — no server-only dependency, so it's directly
 * unit-testable (see tests/unit/internal-url.test.ts). Takes `baseUrl`
 * explicitly (the caller passes `process.env.APP_BASE_URL`) rather than
 * reading `process.env` itself, matching the established pattern for
 * security/config-relevant pure logic in this codebase (e.g.
 * resolveEmailProvider()).
 *
 * Missing/blank APP_BASE_URL returns null — the caller sends the
 * notification WITHOUT a link rather than blocking it entirely (see
 * docs/62-proposal-email-notifications.md, "APP_BASE_URL"). Never falls
 * back to a hardcoded localhost URL — a misconfigured production
 * deployment must never silently email a contractor a broken
 * http://localhost:3000 link.
 */
export function buildInternalProposalUrl(baseUrl: string | undefined, proposalId: string): string | null {
  const trimmed = (baseUrl ?? "").trim();
  if (trimmed === "") return null;
  return `${trimmed.replace(/\/+$/, "")}/proposals/${proposalId}`;
}
