import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireActiveTenant } from "../../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../../lib/auth/permissions";
import { getFullProposal } from "../../../../lib/proposals/data";
import { getProposalClientResponse } from "../../../../lib/portal/data";
import { uuidSchema } from "../../../../lib/validation/schemas";
import { ProposalDocument } from "../../../(protected)/proposals/[proposalId]/proposal-document";
import { PrintButton } from "../../../../components/print-button";

export const dynamic = "force-dynamic";

/**
 * Contractor export/print (Phase 3C). No app shell (see layout.tsx) — the
 * only controls on screen are `.no-print` (a "Back" link and the Print
 * button), hidden entirely from the actual print/PDF output.
 *
 * `?version=<id>` optionally selects a HISTORICAL version instead of the
 * proposal's current one (surfaced via "Print" links on the Version History
 * table — see docs/59-proposal-version-history.md) — validated by
 * getFullProposal() itself (`.eq("proposal_id", proposalId)` on the version
 * fetch), never trusted blindly. An invalid/foreign id resolves to the same
 * `notFound()` as a bad proposalId, never another proposal's content.
 */
export default async function ProposalPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ proposalId: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { tenant } = await requireActiveTenant();
  const canView = await hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSALS_VIEW);
  if (!canView) redirect("/proposals");

  const { proposalId } = await params;
  const { version: rawVersionId } = await searchParams;
  const versionId = rawVersionId && uuidSchema.safeParse(rawVersionId).success ? rawVersionId : undefined;

  const data = await getFullProposal(tenant.tenant_id, proposalId, versionId);
  if (!data) notFound();

  const clientResponse = await getProposalClientResponse(data.version.id);

  return (
    <div className="print-page-content">
      <div className="tenant-form no-print" style={{ justifyContent: "space-between" }}>
        <Link href={`/proposals/${proposalId}`} className="button-secondary">
          Back
        </Link>
        <PrintButton />
      </div>
      <p className="hint no-print">
        Create a clean printable version of this proposal. Use your browser&apos;s Save as PDF option to download it.
      </p>
      <div className="section-card">
        <ProposalDocument businessName={tenant.tenant_name} data={data} clientResponse={clientResponse} />
      </div>
    </div>
  );
}
