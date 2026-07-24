import Link from "next/link";
import { markProposalReadyAction } from "../../../../../actions/proposals";
import { ProposalDocument } from "../proposal-document";
import type { FullProposal } from "../../../../../lib/proposals/data";

export function StepReview({
  proposalId,
  businessName,
  logoUrl,
  data,
  canMarkReady,
}: {
  proposalId: string;
  businessName: string;
  logoUrl?: string | null;
  data: FullProposal;
  canMarkReady: boolean;
}) {
  return (
    <div className="stack">
      <div className="section-card">
        <ProposalDocument businessName={businessName} logoUrl={logoUrl} data={data} />
      </div>

      <div className="tenant-form" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <Link href={`/proposals/${proposalId}/edit?step=pricing`} className="button-secondary">
          Back to edit
        </Link>
        <div className="tenant-form">
          <Link href={`/proposals/${proposalId}`} className="button-secondary">
            Save draft
          </Link>
          <button type="button" className="button-secondary" disabled title="Sending will be available in the Client Portal phase">
            Send
          </button>
          {canMarkReady ? (
            <form action={markProposalReadyAction}>
              <input type="hidden" name="proposalId" value={proposalId} />
              <button type="submit" className="button-primary">
                Mark ready
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
