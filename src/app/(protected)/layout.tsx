import Link from "next/link";
import { CircleUserRound, LogOut } from "lucide-react";
import { requireUser } from "../../lib/auth/session";
import { requireActiveTenant } from "../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../lib/auth/permissions";
import { signOutAction } from "../../actions/auth";
import { TenantSwitcher } from "./tenant-switcher";
import { SidebarNav } from "./sidebar-nav";
import { BottomNav } from "./bottom-nav";
import { buildNavItems } from "./nav-items";

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

  const [canViewProposals, canViewClients, canViewOpportunities, canViewProjects, canViewPortfolio, canViewMembers, canViewProposalSettings] =
    await Promise.all([
      hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSALS_VIEW),
      hasPermission(tenant.tenant_id, PERMISSIONS.CLIENTS_VIEW),
      hasPermission(tenant.tenant_id, PERMISSIONS.OPPORTUNITIES_VIEW),
      hasPermission(tenant.tenant_id, PERMISSIONS.PROJECTS_VIEW),
      hasPermission(tenant.tenant_id, PERMISSIONS.PORTFOLIO_VIEW),
      hasPermission(tenant.tenant_id, PERMISSIONS.MEMBERS_VIEW),
      hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSAL_SETTINGS_VIEW),
    ]);

  const navItems = buildNavItems({
    canViewProposals,
    canViewClients,
    canViewOpportunities,
    canViewProjects,
    canViewPortfolio,
    canViewMembers,
    canViewProposalSettings,
  });

  return (
    <div className="app-shell">
      <SidebarNav items={navItems.main} adminItems={navItems.admin} />

      <div className="app-body">
        <header className="topbar">
          <div className="topbar-context">
            {tenants.length > 1 ? (
              <TenantSwitcher tenants={tenants} activeTenantId={tenant.tenant_id} />
            ) : (
              <strong>{tenant.tenant_name}</strong>
            )}
          </div>

          <div className="topbar-account">
            <span className="hint">{user.email}</span>
            <Link href="/profile" className="button-secondary" aria-label="Profile" title="Profile">
              <CircleUserRound className="icon" size={18} aria-hidden="true" />
            </Link>
            <form action={signOutAction}>
              <button type="submit" className="button-secondary">
                <LogOut className="icon" size={16} aria-hidden="true" />
                Sign out
              </button>
            </form>
          </div>
        </header>

        <main className="app-main">{children}</main>

        <BottomNav items={navItems.bottomNav} />
      </div>
    </div>
  );
}
