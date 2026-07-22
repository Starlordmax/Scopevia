import { createAdminClient } from "../../../lib/supabase/admin";
import { hashPortalSecret } from "../../../lib/portal/tokens";
import { RequestCodeForm } from "./request-code-form";

export const dynamic = "force-dynamic";

const INVALID_LINK_MESSAGES: Record<string, string> = {
  not_found: "We couldn't find that link. Please check the URL your contractor sent you.",
  revoked: "This link has been revoked. Please ask your contractor for a new one.",
  expired: "This link has expired. Please ask your contractor for a new one.",
  unavailable: "This proposal is no longer available to view.",
};

export default async function PortalLandingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tokenHash = hashPortalSecret(token);

  const supabase = createAdminClient();
  const { data: linkInfo } = await supabase.rpc("portal_get_link_info", { p_token_hash: tokenHash }).single();

  if (!linkInfo || !linkInfo.is_valid) {
    const message = INVALID_LINK_MESSAGES[linkInfo?.status_reason ?? "not_found"] ?? INVALID_LINK_MESSAGES.not_found;
    return (
      <div className="portal-content-narrow">
        <div className="card stack">
          <h1>Link not available</h1>
          <p className="hint">{message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="portal-content-narrow">
      <div className="portal-header">
        <span className="portal-header-business">{linkInfo.business_name}</span>
        <p className="hint">{linkInfo.proposal_title}</p>
      </div>

      <div className="card stack">
        <div>
          <h1>Secure client portal</h1>
          <p className="hint">This proposal is private and can only be viewed by authorized recipients.</p>
        </div>

        <RequestCodeForm token={token} />
      </div>
    </div>
  );
}
