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

/**
 * Turns a raw snake_case/lowercase enum value (a status, section type, or
 * measurement type straight from the database) into a human-readable label
 * -- e.g. "floor_area" -> "Floor area", "inspection_scheduled" -> "Inspection
 * scheduled". Sentence case (only the first letter capitalized), not Title
 * Case, since these are short status phrases read as a sentence fragment,
 * not standalone titles. Purely a display transform -- the raw value remains
 * the source of truth everywhere else (permission checks, RPC calls, badge-
 * color mapping in status-badge.ts all still switch on the original string).
 */
export function formatLabel(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
