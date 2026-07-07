/**
 * Pure formatting helper with zero server dependencies — deliberately
 * separate from lib/proposals/data.ts (which has `import "server-only"` and
 * pulls in the Supabase server client), so Client Components (the builder's
 * step-*.tsx files) can format money without dragging server-only code into
 * the browser bundle.
 *
 * The locale is pinned explicitly to "en-US" — `toLocaleString(undefined, …)`
 * resolves to whatever ICU locale the CURRENT runtime defaults to, which
 * differs between a Server Component (Node's default locale) and a Client
 * Component (the browser's locale), producing inconsistent output for the
 * identical function ("USD 2,400.00" server-rendered vs "$30.00"
 * client-rendered) — found via a real E2E run
 * (tests/e2e/proposals.spec.ts), not code review. Phase 2A is USD/en-US
 * only in any case (see docs/39, tenant_proposal_settings.currency_code),
 * so pinning the locale costs nothing and removes the inconsistency.
 */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
