"use client";

import { switchTenantAction } from "../../actions/tenant";

/**
 * Extracted as its own Client Component because event handlers (onChange)
 * cannot be attached to a plain host element rendered directly inside a
 * Server Component — layout.tsx has no "use client" directive. Before this
 * fix, any signed-in user belonging to 2+ tenants crashed the ENTIRE
 * protected app with a 500 on every page, since this select rendered
 * unconditionally whenever tenants.length > 1. See
 * docs/25-phase-1-e2e-verification.md.
 */
export function TenantSwitcher({
  tenants,
  activeTenantId,
}: {
  tenants: { tenant_id: string; tenant_name: string }[];
  activeTenantId: string;
}) {
  return (
    <form action={switchTenantAction} className="tenant-form">
      <select
        name="tenantId"
        aria-label="Switch business"
        defaultValue={activeTenantId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {tenants.map((t) => (
          <option key={t.tenant_id} value={t.tenant_id}>
            {t.tenant_name}
          </option>
        ))}
      </select>
    </form>
  );
}
