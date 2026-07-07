import Link from "next/link";
import { FileText, Users, Plus, Kanban } from "lucide-react";
import { requireUser } from "../../lib/auth/session";
import { requireActiveTenant } from "../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../lib/auth/permissions";
import { createClient } from "../../lib/supabase/server";
import { getActivityFeed } from "../../lib/crm/activity-feed-data";
import { formatCents } from "../../lib/proposals/format";
import { proposalBadgeClass } from "../../lib/crm/status-badge";
import { ActivityFeed } from "../../components/activity-feed";
import { PageHeader } from "../../components/page-header";
import { EmptyState } from "../../components/empty-state";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();
  const { tenant } = await requireActiveTenant();

  const [canViewProposals, canCreateProposal, canCreateClient, canViewActivities] = await Promise.all([
    hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSALS_VIEW),
    hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSALS_CREATE),
    hasPermission(tenant.tenant_id, PERMISSIONS.CLIENTS_CREATE),
    hasPermission(tenant.tenant_id, PERMISSIONS.ACTIVITIES_VIEW),
  ]);

  const supabase = await createClient();

  async function countByStatus(status: string) {
    const { count } = await supabase
      .from("proposals")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenant.tenant_id)
      .eq("status", status);
    return count ?? 0;
  }

  const threeDaysAgoDate = new Date();
  threeDaysAgoDate.setDate(threeDaysAgoDate.getDate() - 3);
  const threeDaysAgo = threeDaysAgoDate.toISOString();

  const [draftCount, readyCount, sentCount, acceptedCount, recentProposals, needsFollowUpCount, recentActivity] = canViewProposals
    ? await Promise.all([
        countByStatus("draft"),
        countByStatus("ready"),
        countByStatus("sent"),
        countByStatus("accepted"),
        supabase
          .from("proposals")
          .select("id, proposal_number, title, status, updated_at, clients(display_name), proposal_versions!proposals_current_version_id_fkey(total_cents)")
          .eq("tenant_id", tenant.tenant_id)
          .neq("status", "archived")
          .order("updated_at", { ascending: false })
          .limit(5)
          .then((r) => r.data ?? []),
        // A real, computed signal (not invented): a proposal that's been
        // ready for 3+ days without moving forward is worth a nudge — see
        // docs/34-proposal-builder-ux.md, "Dashboard, needs follow-up."
        supabase
          .from("proposals")
          .select("*", { count: "exact", head: true })
          .eq("tenant_id", tenant.tenant_id)
          .eq("status", "ready")
          .lt("updated_at", threeDaysAgo)
          .then((r) => r.count ?? 0),
        canViewActivities ? getActivityFeed({ tenantId: tenant.tenant_id, limit: 8 }) : Promise.resolve([]),
      ])
    : [0, 0, 0, 0, [], 0, []];

  const totalQuotedCents = recentProposals.reduce((sum, p) => {
    const version = Array.isArray(p.proposal_versions) ? p.proposal_versions[0] : p.proposal_versions;
    return sum + (version?.total_cents ?? 0);
  }, 0);

  return (
    <div className="stack">
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${user.email}.`}
        secondary={
          <Link href="/pipeline" className="button-secondary">
            View pipeline
          </Link>
        }
        action={
          canCreateProposal ? (
            <Link href="/proposals/new" className="button-primary">
              <Plus className="icon" size={16} aria-hidden="true" />
              New proposal
            </Link>
          ) : canCreateClient ? (
            <Link href="/clients/new" className="button-primary">
              <Plus className="icon" size={16} aria-hidden="true" />
              New client
            </Link>
          ) : null
        }
      />

      {canViewProposals ? (
        <>
          <div className="metrics-grid">
            <MetricTile icon={FileText} label="Draft proposals" value={draftCount} href="/proposals" />
            <MetricTile icon={FileText} label="Ready proposals" value={readyCount} href="/proposals" />
            <MetricTile icon={FileText} label="Sent proposals" value={sentCount} href="/proposals" />
            <MetricTile icon={FileText} label="Accepted proposals" value={acceptedCount} href="/proposals" />
            <MetricTile icon={FileText} label="Total quoted value" value={formatCents(totalQuotedCents)} />
            <MetricTile icon={FileText} label="Needs follow-up" value={needsFollowUpCount} href="/proposals?status=ready" />
          </div>

          <div className="section-card stack">
            <h2>Recent proposals</h2>
            {recentProposals.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No proposals yet"
                description="Create your first proposal to describe the job, calculate labor, showcase previous work, and present a professional price to your customer."
                action={
                  canCreateProposal ? (
                    <Link href="/proposals/new" className="button-primary">
                      Create proposal
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <div className="table-card">
                <table>
                  <thead>
                    <tr>
                      <th>Number</th>
                      <th>Title</th>
                      <th>Client</th>
                      <th>Total</th>
                      <th>Status</th>
                      <th>Updated</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {recentProposals.map((p) => {
                      const version = Array.isArray(p.proposal_versions) ? p.proposal_versions[0] : p.proposal_versions;
                      return (
                        <tr key={p.id}>
                          <td data-label="Number">#{p.proposal_number}</td>
                          <td data-label="Title">
                            <Link href={`/proposals/${p.id}`}>{p.title}</Link>
                          </td>
                          <td data-label="Client">{p.clients?.display_name ?? "—"}</td>
                          <td data-label="Total">{version ? formatCents(version.total_cents) : "—"}</td>
                          <td data-label="Status">
                            <span className={`badge ${proposalBadgeClass(p.status)}`.trim()}>{p.status}</span>
                          </td>
                          <td data-label="Updated">{new Date(p.updated_at).toLocaleDateString()}</td>
                          <td data-label="">
                            <Link href={p.status === "archived" ? `/proposals/${p.id}` : `/proposals/${p.id}/edit`} className="button-secondary">
                              {p.status === "archived" ? "View" : "Continue editing"}
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="metrics-grid">
          <MetricTile icon={Users} label="Clients" href="/clients" />
          <MetricTile icon={Kanban} label="Pipeline" href="/pipeline" />
        </div>
      )}

      {canViewActivities ? (
        <div className="section-card stack">
          <h2>Recent activity</h2>
          <ActivityFeed items={recentActivity} />
        </div>
      ) : null}
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
  value?: number | string;
  href?: string;
}) {
  const content = (
    <>
      <span className="metric-tile-icon">
        <Icon size={20} aria-hidden="true" />
      </span>
      <div>
        {value !== undefined ? <div className="metric-tile-value">{value}</div> : null}
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
