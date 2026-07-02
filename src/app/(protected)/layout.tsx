import Link from "next/link";
import { requireUser } from "../../lib/auth/session";
import { requireActiveTenant } from "../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../lib/auth/permissions";
import { signOutAction } from "../../actions/auth";
import { switchTenantAction } from "../../actions/tenant";

// Every page under this layout reads the caller's session and tenant
// membership from the database on every request — there is no meaningful
// static version of any of them. Declared explicitly rather than relying on
// Next.js's runtime detection of dynamic APIs, which can be bypassed if an
// error (e.g. missing env vars) is thrown before a dynamic API call is
// actually reached during a trial static render.
export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { tenant, tenants } = await requireActiveTenant();

  const [canViewClients, canViewOpportunities, canViewProjects, canViewMembers] = await Promise.all([
    hasPermission(tenant.tenant_id, PERMISSIONS.CLIENTS_VIEW),
    hasPermission(tenant.tenant_id, PERMISSIONS.OPPORTUNITIES_VIEW),
    hasPermission(tenant.tenant_id, PERMISSIONS.PROJECTS_VIEW),
    hasPermission(tenant.tenant_id, PERMISSIONS.MEMBERS_VIEW),
  ]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <strong>Scopevia</strong>
          <div className="hint">{user.email}</div>
        </div>

        {tenants.length > 1 ? (
          <form action={switchTenantAction} className="tenant-form">
            <select name="tenantId" defaultValue={tenant.tenant_id} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
              {tenants.map((t) => (
                <option key={t.tenant_id} value={t.tenant_id}>
                  {t.tenant_name}
                </option>
              ))}
            </select>
          </form>
        ) : (
          <strong>{tenant.tenant_name}</strong>
        )}

        <nav>
          <Link href="/">Home</Link>
          {canViewClients ? <Link href="/clients">Clients</Link> : null}
          {canViewOpportunities ? <Link href="/pipeline">Pipeline</Link> : null}
          {canViewProjects ? <Link href="/projects">Projects</Link> : null}
          {canViewMembers ? <Link href="/members">Members</Link> : null}
          <Link href="/profile">Profile</Link>
        </nav>

        <form action={signOutAction}>
          <button type="submit" className="button-secondary">
            Sign out
          </button>
        </form>
      </header>

      <main className="app-main">{children}</main>
    </div>
  );
}
