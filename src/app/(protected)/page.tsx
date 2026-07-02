import { requireUser } from "../../lib/auth/session";
import { requireActiveTenant } from "../../lib/auth/tenant";
import { getActiveRolePermissions } from "../../lib/auth/role-permissions";
import { hasPermission, PERMISSIONS } from "../../lib/auth/permissions";
import { createClient } from "../../lib/supabase/server";
import { getActivityFeed } from "../../lib/crm/activity-feed-data";
import { ActivityFeed } from "../../components/activity-feed";

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

  const [canViewClients, canViewOpportunities, canViewProjects, canViewActivities] = await Promise.all([
    hasPermission(tenant.tenant_id, PERMISSIONS.CLIENTS_VIEW),
    hasPermission(tenant.tenant_id, PERMISSIONS.OPPORTUNITIES_VIEW),
    hasPermission(tenant.tenant_id, PERMISSIONS.PROJECTS_VIEW),
    hasPermission(tenant.tenant_id, PERMISSIONS.ACTIVITIES_VIEW),
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
      <div>
        <h1>{tenant.tenant_name}</h1>
        <p className="hint">Welcome back, {user.email}.</p>
      </div>

      <div className="tenant-form" style={{ flexWrap: "wrap" }}>
        {canViewClients ? <MetricTile label="Clients" value={clientCount} /> : null}
        {canViewOpportunities ? <MetricTile label="Open opportunities" value={openOpportunityCount} /> : null}
        {canViewProjects ? <MetricTile label="Projects" value={projectCount} /> : null}
        {canViewOpportunities || canViewProjects ? (
          <MetricTile label="Upcoming inspections" value={upcomingOpportunityInspections + upcomingProjectInspections} />
        ) : null}
      </div>

      {canViewActivities ? (
        <div className="card stack">
          <h2 style={{ fontSize: "1rem" }}>Recent activity</h2>
          <ActivityFeed items={recentActivity} />
        </div>
      ) : null}

      <details className="card">
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

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="card" style={{ minWidth: 140, textAlign: "center" }}>
      <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>{value}</div>
      <div className="hint">{label}</div>
    </div>
  );
}
