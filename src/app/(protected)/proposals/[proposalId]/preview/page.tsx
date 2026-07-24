import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireActiveTenant } from "../../../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../../../lib/auth/permissions";
import { getFullProposal } from "../../../../../lib/proposals/data";
import { getBusinessBranding } from "../../../../../lib/branding/data";
import { ProposalDocument } from "../proposal-document";

export const dynamic = "force-dynamic";

export default async function ProposalPreviewPage({ params }: { params: Promise<{ proposalId: string }> }) {
  const { tenant } = await requireActiveTenant();
  const canView = await hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSALS_VIEW);
  if (!canView) redirect("/proposals");

  const { proposalId } = await params;
  const data = await getFullProposal(tenant.tenant_id, proposalId);
  if (!data) notFound();

  const branding = await getBusinessBranding(tenant.tenant_id);

  return (
    <div className="stack">
      <div className="tenant-form" style={{ justifyContent: "space-between" }}>
        <Link href={`/proposals/${proposalId}`} className="button-secondary">
          Back
        </Link>
      </div>
      <div className="section-card">
        <ProposalDocument businessName={tenant.tenant_name} logoUrl={branding.logoUrl} data={data} />
      </div>
    </div>
  );
}
