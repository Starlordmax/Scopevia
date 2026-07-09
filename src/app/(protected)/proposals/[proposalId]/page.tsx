import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Eye, FileEdit } from "lucide-react";
import { requireActiveTenant } from "../../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../../lib/auth/permissions";
import { getFullProposal } from "../../../../lib/proposals/data";
import { formatCents } from "../../../../lib/proposals/format";
import { proposalBadgeClass } from "../../../../lib/crm/status-badge";
import { PageHeader } from "../../../../components/page-header";
import { ConfirmSubmitButton } from "../../../../components/confirm-submit-button";
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
        </div>
      </div>

      {proposal.opportunity_id ? (
        <p className="hint">
          Linked to <Link href={`/opportunities/${proposal.opportunity_id}`}>this opportunity</Link>.
        </p>
      ) : null}

      {(((proposal.status === "draft" || proposal.status === "ready") && canArchive) || (proposal.status === "archived" && canRestore)) ? (
        <details className="section-card">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Danger zone</summary>
          <div className="stack" style={{ marginTop: 12 }}>
            {(proposal.status === "draft" || proposal.status === "ready") && canArchive ? (
              <div className="tenant-form" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>Delete this proposal</strong>
                  <p className="hint">
                    This removes it from your active proposals. You can restore it later from archived proposals — nothing is permanently
                    deleted.
                  </p>
                </div>
                <form action={archiveProposalAction}>
                  <input type="hidden" name="proposalId" value={proposalId} />
                  <ConfirmSubmitButton
                    className="button-danger"
                    confirmMessage="Delete this proposal? This will remove it from your active proposals. You can restore it later from archived proposals."
                    pendingText="Deleting…"
                  >
                    Delete proposal
                  </ConfirmSubmitButton>
                </form>
              </div>
            ) : null}
            {proposal.status === "archived" && canRestore ? (
              <div className="tenant-form" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>Restore this proposal</strong>
                  <p className="hint">Moves it back to your active proposals.</p>
                </div>
                <form action={restoreProposalAction}>
                  <input type="hidden" name="proposalId" value={proposalId} />
                  <ConfirmSubmitButton
                    className="button-secondary"
                    confirmMessage="Restore this proposal? This will move it back to your active proposals."
                    pendingText="Restoring…"
                  >
                    Restore proposal
                  </ConfirmSubmitButton>
                </form>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
