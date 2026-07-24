import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { hashPortalSecret, hashIdentifier, portalSessionCookieName } from "../../../../lib/portal/tokens";
import { getFullProposalForPortal, getPortalResponse } from "../../../../lib/portal/data";
import { getSignedBrandingUrlForPortal } from "../../../../lib/storage/branding";
import { ProposalDocument } from "../../../(protected)/proposals/[proposalId]/proposal-document";
import { PrintButton } from "../../../../components/print-button";
import { notifyProposalViewed } from "../../../../lib/notifications/proposals";

export const dynamic = "force-dynamic";

/**
 * Client Portal export/print (Phase 3C). Reuses the EXACT same session
 * validation as /p/[token]/view (portal_get_session_context) — the visitor
 * never supplies a proposal/version id themselves; both come from the
 * already-authenticated session, which resolves to the LINK's own bound
 * version (Phase 3B.1's historical-version fix), never blindly "whatever is
 * current." An old, revoked-for-editing link still exports exactly the
 * version its client originally saw and responded to — see
 * docs/61-export-version-safety.md.
 *
 * No accept/decline controls here on purpose — this is a read-only export
 * view; the actual response flow stays on /view.
 */
export default async function PortalPrintPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tokenHash = hashPortalSecret(token);

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(portalSessionCookieName(tokenHash))?.value;
  if (!sessionToken) {
    redirect(`/p/${token}`);
  }

  const sessionTokenHash = hashPortalSecret(sessionToken);
  const hdrs = await headers();
  const ipHash = hashIdentifier(hdrs.get("x-forwarded-for"));
  const userAgentHash = hashIdentifier(hdrs.get("user-agent"));

  const supabase = createAdminClient();
  const { data: session } = await supabase
    .rpc("portal_get_session_context", {
      p_session_token_hash: sessionTokenHash,
      p_ip_hash: ipHash as string,
      p_user_agent_hash: userAgentHash as string,
    })
    .single();

  if (!session || session.outcome !== "ok" || !session.proposal_id || !session.proposal_version_id || !session.tenant_id) {
    redirect(`/p/${token}`);
  }

  const [proposalData, { data: tenant }, existingResponse] = await Promise.all([
    getFullProposalForPortal(session.proposal_id, session.proposal_version_id),
    supabase.from("tenants").select("name, logo_storage_path").eq("id", session.tenant_id).single(),
    getPortalResponse(session.proposal_version_id),
  ]);

  if (!proposalData) {
    redirect(`/p/${token}`);
  }

  const logoUrl = tenant?.logo_storage_path ? await getSignedBrandingUrlForPortal(tenant.logo_storage_path) : null;

  if (session.is_first_view && session.client_email) {
    await notifyProposalViewed({
      tenantId: session.tenant_id,
      proposalId: session.proposal_id,
      proposalVersionId: session.proposal_version_id,
      proposalTitle: proposalData.proposal.title,
      proposalNumber: proposalData.proposal.proposal_number,
      businessName: tenant?.name ?? "Your contractor",
      clientEmail: session.client_email,
    });
  }

  return (
    <div className="print-page-content">
      <div className="tenant-form no-print" style={{ justifyContent: "space-between" }}>
        <Link href={`/p/${token}/view`} className="button-secondary">
          Back
        </Link>
        <PrintButton />
      </div>
      <p className="hint no-print">
        Create a clean printable version of this proposal. Use your browser&apos;s Save as PDF option to download it.
      </p>
      <div className="section-card">
        <ProposalDocument businessName={tenant?.name ?? "Your contractor"} logoUrl={logoUrl} data={proposalData} clientResponse={existingResponse} />
      </div>
    </div>
  );
}
