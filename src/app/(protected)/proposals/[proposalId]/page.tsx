import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Eye, FileEdit } from "lucide-react";
import { requireActiveTenant } from "../../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../../lib/auth/permissions";
import { getFullProposal } from "../../../../lib/proposals/data";
import { formatCents } from "../../../../lib/proposals/format";
import { proposalBadgeClass } from "../../../../lib/crm/status-badge";
import { PageHeader } from "../../../../components/page-header";
import { markProposalReadyAction, returnProposalToDraftAction, archiveProposalAction, restoreProposalAction } from "../../../../actions/proposals";

export const dynamic = "force-dynamic";

export default async function ProposalDetailPage({ params }: { params: Promise<{ proposalId: string }> }) {
  const { tenant } = await requireActiveTenant();
  const canView = await hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSALS_VIEW);
  if (!canView) redirect("/proposals");

  const { proposalId } = await params;
  const data = await getFullProposal(tenant.tenant_id, proposalId);
  if (!data) notFound();

  const [canMarkReady, canArchive, canRestore] = await Promise.all([
    hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSALS_MARK_READY),
    hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSALS_ARCHIVE),
    hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSALS_RESTORE),
  ]);

  const { proposal, version } = data;

  return (
    <div className="stack">
      <PageHeader
        icon={FileEdit}
        title={proposal.title}
        description={`Proposal #${proposal.proposal_number} for ${proposal.clients?.display_name ?? "client"}`}
        action={
          proposal.status !== "archived" ? (
            <Link href={`/proposals/${proposalId}/edit?step=scope`} className="button-primary">
              Continue editing
            </Link>
          ) : null
        }
        secondary={
          <Link href={`/proposals/${proposalId}/preview`} className="button-secondary">
            <Eye size={16} aria-hidden="true" /> Preview
          </Link>
        }
      />

      <div className="section-card stack">
        <div className="page-header-heading">
          <span className={`badge ${proposalBadgeClass(proposal.status)}`}>{proposal.status}</span>
          <span className="hint">Updated {new Date(proposal.updated_at).toLocaleString()}</span>
        </div>

        <div className="metrics-grid">
          <div className="metric-tile">
            <div className="metric-tile-value">{formatCents(version.total_cents)}</div>
            <div className="metric-tile-label">Total</div>
          </div>
          <div className="metric-tile">
            <div className="metric-tile-value">{formatCents(version.labor_total_cents)}</div>
            <div className="metric-tile-label">Labor</div>
          </div>
          <div className="metric-tile">
            <div className="metric-tile-value">{formatCents(version.line_items_subtotal_cents)}</div>
            <div className="metric-tile-label">Materials &amp; costs</div>
          </div>
        </div>

        <div className="tenant-form">
          {proposal.status === "draft" && canMarkReady ? (
            <form action={markProposalReadyAction}>
              <input type="hidden" name="proposalId" value={proposalId} />
              <button type="submit" className="button-primary">
                Mark ready
              </button>
            </form>
          ) : null}
          {proposal.status === "ready" && canMarkReady ? (
            <form action={returnProposalToDraftAction}>
              <input type="hidden" name="proposalId" value={proposalId} />
              <button type="submit" className="button-secondary">
                Return to draft
              </button>
            </form>
          ) : null}
          {(proposal.status === "draft" || proposal.status === "ready") && canArchive ? (
            <form action={archiveProposalAction}>
              <input type="hidden" name="proposalId" value={proposalId} />
              <button type="submit" className="button-danger">
                Archive
              </button>
            </form>
          ) : null}
          {proposal.status === "archived" && canRestore ? (
            <form action={restoreProposalAction}>
              <input type="hidden" name="proposalId" value={proposalId} />
              <button type="submit" className="button-secondary">
                Restore
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {proposal.opportunity_id ? (
        <p className="hint">
          Linked to <Link href={`/opportunities/${proposal.opportunity_id}`}>this opportunity</Link>.
        </p>
      ) : null}
    </div>
  );
}
