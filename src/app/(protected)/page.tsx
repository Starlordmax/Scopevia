import Link from "next/link";
import { Users, Kanban, Briefcase, CalendarClock, Plus } from "lucide-react";
import { requireUser } from "../../lib/auth/session";
import { requireActiveTenant } from "../../lib/auth/tenant";
import { getActiveRolePermissions } from "../../lib/auth/role-permissions";
import { hasPermission, PERMISSIONS } from "../../lib/auth/permissions";
import { createClient } from "../../lib/supabase/server";
import { getActivityFeed } from "../../lib/crm/activity-feed-data";
import { ActivityFeed } from "../../components/activity-feed";
import { PageHeader } from "../../components/page-header";

async function countRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: "clients" | "projects",
  tenantId: string
) {
  const { count } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .is("archived_at", null);
  return count ?? 0;
}

export default async function HomePage() {
  const user = await requireUser();
  const { tenant, tenants } = await requireActiveTenant();
  const permissions = await getActiveRolePermissions(tenant.role_key);

  const [canViewClients, canViewOpportunities, canViewProjects, canViewActivities, canCreateOpportunity] = await Promise.all([
    hasPermission(tenant.tenant_id, PERMISSIONS.CLIENTS_VIEW),
    hasPermission(tenant.tenant_id, PERMISSIONS.OPPORTUNITIES_VIEW),
    hasPermission(tenant.tenant_id, PERMISSIONS.PROJECTS_VIEW),
    hasPermission(tenant.tenant_id, PERMISSIONS.ACTIVITIES_VIEW),
    hasPermission(tenant.tenant_id, PERMISSIONS.OPPORTUNITIES_CREATE),
  ]);

  const supabase = await createClient();
  const now = new Date().toISOString();

  const [clientCount, openOpportunityCount, projectCount, upcomingOpportunityInspections, upcomingProjectInspections, recentActivity] =
    await Promise.all([
      canViewClients ? countRows(supabase, "clients", tenant.tenant_id) : Promise.resolve(0),
      canViewOpportunities
        ? supabase
            .from("opportunities")
            .select("*", { count: "exact", head: true })
            .eq("tenant_id", tenant.tenant_id)
            .not("status", "in", "(won,lost,archived)")
            .then((r) => r.count ?? 0)
        : Promise.resolve(0),
      canViewProjects ? countRows(supabase, "projects", tenant.tenant_id) : Promise.resolve(0),
      canViewOpportunities
        ? supabase
            .from("opportunities")
            .select("*", { count: "exact", head: true })
            .eq("tenant_id", tenant.tenant_id)
            .eq("status", "inspection_scheduled")
            .gte("inspection_scheduled_at", now)
            .then((r) => r.count ?? 0)
        : Promise.resolve(0),
      canViewProjects
        ? supabase
            .from("projects")
            .select("*", { count: "exact", head: true })
            .eq("tenant_id", tenant.tenant_id)
            .eq("status", "inspection_pending")
            .gte("inspection_scheduled_at", now)
            .then((r) => r.count ?? 0)
        : Promise.resolve(0),
      canViewActivities ? getActivityFeed({ tenantId: tenant.tenant_id, limit: 10 }) : Promise.resolve([]),
    ]);

  return (
    <div className="stack">
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${user.email}.`}
        action={
          canCreateOpportunity ? (
            <Link href="/opportunities/new" className="button-primary">
              <Plus className="icon" size={16} aria-hidden="true" />
              New opportunity
            </Link>
          ) : null
        }
      />

      <div className="metrics-grid">
        {canViewClients ? <MetricTile icon={Users} label="Clients" value={clientCount} href="/clients" /> : null}
        {canViewOpportunities ? (
          <MetricTile icon={Kanban} label="Open opportunities" value={openOpportunityCount} href="/pipeline" />
        ) : null}
        {canViewProjects ? <MetricTile icon={Briefcase} label="Projects" value={projectCount} href="/projects" /> : null}
        {canViewOpportunities || canViewProjects ? (
          <MetricTile
            icon={CalendarClock}
            label="Upcoming inspections"
            value={upcomingOpportunityInspections + upcomingProjectInspections}
          />
        ) : null}
      </div>

      {canViewActivities ? (
        <div className="section-card stack">
          <h2>Recent activity</h2>
          <ActivityFeed items={recentActivity} />
        </div>
      ) : null}

      <details className="card" style={{ maxWidth: "none" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Account &amp; access details</summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <div>
            <span className="hint">Current role</span>
            <p>{tenant.role_name}</p>
          </div>
          <div>
            <span className="hint">Membership count</span>
            <p>
              You belong to {tenants.length} tenant{tenants.length === 1 ? "" : "s"}.
            </p>
          </div>
          <div>
            <span className="hint">Available permissions for this role</span>
            <ul>{permissions.length === 0 ? <li className="hint">None</li> : permissions.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        </div>
      </details>
    </div>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" | "false" }>;
  label: string;
  value: number;
  href?: string;
}) {
  const content = (
    <>
      <span className="metric-tile-icon">
        <Icon size={20} aria-hidden="true" />
      </span>
      <div>
        <div className="metric-tile-value">{value}</div>
        <div className="metric-tile-label">{label}</div>
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="metric-tile" style={{ textDecoration: "none", color: "inherit" }}>
        {content}
      </Link>
    );
  }

  return <div className="metric-tile">{content}</div>;
}
