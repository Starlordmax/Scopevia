/**
 * Pure decision logic for picking the "active tenant" from an authoritative
 * tenant list plus a (possibly manipulated, stale, or absent) cookie value.
 * Deliberately has no "server-only" import and no dependency on
 * cookies()/Supabase, so it can be unit-tested directly — see
 * tests/unit/pick-active-tenant.test.ts, which specifically proves that an
 * arbitrary/foreign tenant id in the cookie can never produce access to a
 * tenant absent from `tenants`.
 *
 * `tenants` MUST already be the caller's authoritative, server-verified list
 * (e.g. the result of get_user_tenants()) — this function performs no
 * authorization itself, only a selection among already-authorized options.
 */
export function pickActiveTenant<T extends { tenant_id: string }>(
  tenants: T[],
  cookieTenantId: string | undefined
): T | null {
  const fromCookie = cookieTenantId ? tenants.find((t) => t.tenant_id === cookieTenantId) : undefined;
  return fromCookie ?? tenants[0] ?? null;
}
