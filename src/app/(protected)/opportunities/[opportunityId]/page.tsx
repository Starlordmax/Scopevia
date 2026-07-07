import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireActiveTenant } from "../../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../../lib/auth/permissions";
import { createClient } from "../../../../lib/supabase/server";
import { getActivityFeed } from "../../../../lib/crm/activity-feed-data";
import { getNotes } from "../../../../lib/crm/notes-data";
import { ActivityFeed } from "../../../../components/activity-feed";
import { NotesSection } from "../../../../components/notes-section";
import { OpportunityStatusActions } from "./status-actions";
import { archiveOpportunityAction, restoreOpportunityAction } from "../../../../actions/opportunities";
import { opportunityBadgeClass, proposalBadgeClass } from "../../../../lib/crm/status-badge";
import { formatCents } from "../../../../lib/proposals/format";
import type { OpportunityStatus } from "../../../../../types/enums";

export const dynamic = "force-dynamic";

function formatMoney(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export default async function OpportunityDetailPage({ params }: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await params;
  const { tenant } = await requireActiveTenant();

  const canView = await hasPermission(tenant.tenant_id, PERMISSIONS.OPPORTUNITIES_VIEW);
  if (!canView) redirect("/opportunities");

  const supabase = await createClient();
  const { data: opportunity } = await supabase
    .from("opportunities")
    .select("*, clients(id, display_name)")
    .eq("id", opportunityId)
    .eq("tenant_id", tenant.tenant_id)
    .single();
  if (!opportunity) notFound();

  const [canChangeStatus, canArchive, canRestore, notesView, notesCreate, notesUpdate, notesArchive, activitiesView, canViewProposals, canCreateProposal] =
    await Promise.all([
      hasPermission(tenant.tenant_id, PERMISSIONS.OPPORTUNITIES_CHANGE_STATUS),
      hasPermission(tenant.tenant_id, PERMISSIONS.OPPORTUNITIES_ARCHIVE),
      hasPermission(tenant.tenant_id, PERMISSIONS.OPPORTUNITIES_RESTORE),
      hasPermission(tenant.tenant_id, PERMISSIONS.NOTES_VIEW),
      hasPermission(tenant.tenant_id, PERMISSIONS.NOTES_CREATE),
      hasPermission(tenant.tenant_id, PERMISSIONS.NOTES_UPDATE),
      hasPermission(tenant.tenant_id, PERMISSIONS.NOTES_ARCHIVE),
      hasPermission(tenant.tenant_id, PERMISSIONS.ACTIVITIES_VIEW),
      hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSALS_VIEW),
      hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSALS_CREATE),
    ]);

  const { data: activeProposal } = canViewProposals
    ? await supabase
        .from("proposals")
        .select("id, proposal_number, title, status, updated_at, proposal_versions!proposals_current_version_id_fkey(total_cents)")
        .eq("tenant_id", tenant.tenant_id)
        .eq("opportunity_id", opportunityId)
        .is("archived_at", null)
        .maybeSingle()
    : { data: null };

  const [notes, activity] = await Promise.all([
    notesView ? getNotes({ opportunityId }) : Promise.resolve([]),
    activitiesView ? getActivityFeed({ opportunityId }) : Promise.resolve([]),
  ]);

  const canBeArchived = opportunity.status === "won" || opportunity.status === "lost";
  const isArchived = opportunity.status === "archived";

  return (
    <div className="stack">
      <div className="tenant-form" style={{ justifyContent: "space-between", width: "100%" }}>
        <div>
          <h1>{opportunity.title}</h1>
          <span className="hint">
            {opportunity.clients ? <Link href={`/clients/${opportunity.clients.id}`}>{opportunity.clients.display_name}</Link> : "—"}
          </span>
        </div>
        <span className={`badge ${opportunityBadgeClass(opportunity.status)}`.trim()}>{opportunity.status.replace(/_/g, " ")}</span>
      </div>

      <div className="section-card stack">
        <div>Estimated value: {formatMoney(opportunity.estimated_value_cents)}</div>
        {opportunity.probability !== null ? <div>Probability: {opportunity.probability}%</div> : null}
        {opportunity.expected_close_date ? <div>Expected close: {opportunity.expected_close_date}</div> : null}
        {opportunity.inspection_scheduled_at ? (
          <div>Inspection: {new Date(opportunity.inspection_scheduled_at).toLocaleString()}</div>
        ) : null}
        {opportunity.lost_reason ? <div>Lost reason: {opportunity.lost_reason}</div> : null}
        {opportunity.source ? <div>Source: {opportunity.source}</div> : null}
      </div>

      {canChangeStatus && !isArchived ? (
        <div className="section-card">
          <OpportunityStatusActions opportunityId={opportunityId} status={opportunity.status as OpportunityStatus} />
        </div>
      ) : null}

      {canViewProposals ? (
        <div className="section-card stack">
          <h2>Proposal</h2>
          {activeProposal ? (
            (() => {
              const version = Array.isArray(activeProposal.proposal_versions)
                ? activeProposal.proposal_versions[0]
                : activeProposal.proposal_versions;
              return (
                <div className="page-header-heading">
                  <div>
                    <span className={`badge ${proposalBadgeClass(activeProposal.status)}`.trim()}>{activeProposal.status}</span>{" "}
                    <span className="hint">
                      #{activeProposal.proposal_number} · {version ? formatCents(version.total_cents) : "—"} · updated{" "}
                      {new Date(activeProposal.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                  <Link href={`/proposals/${activeProposal.id}`} className="button-primary">
                    Open proposal
                  </Link>
                </div>
              );
            })()
          ) : canCreateProposal && !isArchived ? (
            <Link href={`/proposals/new?clientId=${opportunity.client_id}&opportunityId=${opportunityId}`} className="button-primary">
              Create proposal
            </Link>
          ) : (
            <p className="hint">No proposal yet.</p>
          )}
        </div>
      ) : null}

      <div className="tenant-form">
        {canArchive && canBeArchived && !isArchived ? (
          <form action={archiveOpportunityAction}>
            <input type="hidden" name="opportunityId" value={opportunityId} />
            <button type="submit" className="button-danger">
              Archive
            </button>
          </form>
        ) : null}
        {canRestore && isArchived ? (
          <form action={restoreOpportunityAction}>
            <input type="hidden" name="opportunityId" value={opportunityId} />
            <button type="submit" className="button-secondary">
              Restore
            </button>
          </form>
        ) : null}
      </div>

      {notesView ? (
        <div className="section-card stack">
          <h2>Notes</h2>
          <NotesSection
            tenantId={tenant.tenant_id}
            opportunityId={opportunityId}
            notes={notes}
            canCreate={notesCreate}
            canUpdate={notesUpdate}
            canArchive={notesArchive}
          />
        </div>
      ) : null}

      {activitiesView ? (
        <div className="section-card stack">
          <h2>Activity</h2>
          <ActivityFeed items={activity} />
        </div>
      ) : null}
    </div>
  );
}
