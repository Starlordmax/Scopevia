import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { hashPortalSecret, hashIdentifier, portalSessionCookieName } from "../../../../lib/portal/tokens";
import { getFullProposalForPortal, getPortalResponse } from "../../../../lib/portal/data";
import { ProposalDocument } from "../../../(protected)/proposals/[proposalId]/proposal-document";
import { PortalResponseSection } from "./portal-response-section";
import { notifyProposalViewed } from "../../../../lib/notifications/proposals";

export const dynamic = "force-dynamic";

export default async function PortalViewPage({ params }: { params: Promise<{ token: string }> }) {
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
    supabase.from("tenants").select("name").eq("id", session.tenant_id).single(),
    getPortalResponse(session.proposal_version_id),
  ]);

  if (!proposalData) {
    redirect(`/p/${token}`);
  }

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
    <div className="portal-content">
      <div className="tenant-form no-print" style={{ justifyContent: "flex-end" }}>
        <Link href={`/p/${token}/print`} className="button-secondary">
          Print / Save as PDF
        </Link>
      </div>
      <div className="section-card">
        <ProposalDocument businessName={tenant?.name ?? "Your contractor"} data={proposalData} />
      </div>
      <PortalResponseSection token={token} existingResponse={existingResponse ? { responseType: existingResponse.responseType } : null} />
    </div>
  );
}
