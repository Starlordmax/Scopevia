"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../lib/supabase/server";
import { requireUser } from "../lib/auth/session";
import { uuidSchema } from "../lib/validation/schemas";
import { generatePortalLinkToken, hashPortalSecret } from "../lib/portal/tokens";
import { friendlyRpcErrorMessage } from "../lib/errors/friendly-message";

// A generated link is valid for 14 days from creation — long enough that a
// contractor doesn't have to regenerate it mid-review, short enough that a
// stale/forgotten link doesn't stay live indefinitely. Revoking it early is
// always available regardless of this TTL.
const PORTAL_LINK_TTL_DAYS = 14;

export type CreatePortalLinkResult = { error?: string; url?: string; expiresAt?: string };

/**
 * Creates a client portal link. Generates the raw token here (never in SQL —
 * see src/lib/portal/tokens.ts) and sends only its hash to
 * create_proposal_portal_link(); the raw token is returned to the caller
 * exactly once, to display and copy, and is never stored anywhere.
 */
export async function createProposalPortalLinkAction(_prev: CreatePortalLinkResult, formData: FormData): Promise<CreatePortalLinkResult> {
  await requireUser();

  const tenantId = uuidSchema.safeParse(formData.get("tenantId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!tenantId.success || !proposalId.success) return { error: "Invalid request" };

  const rawToken = generatePortalLinkToken();
  const tokenHash = hashPortalSecret(rawToken);
  const expiresAt = new Date(Date.now() + PORTAL_LINK_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const supabase = await createClient();
  const { error } = await supabase
    .rpc("create_proposal_portal_link", {
      p_tenant_id: tenantId.data,
      p_proposal_id: proposalId.data,
      p_token_hash: tokenHash,
      p_expires_at: expiresAt,
    })
    .single();

  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  revalidatePath(`/proposals/${proposalId.data}`);

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return { url: `${origin}/p/${rawToken}`, expiresAt };
}

export async function revokeProposalPortalLinkAction(formData: FormData): Promise<void> {
  await requireUser();

  const portalLinkId = uuidSchema.safeParse(formData.get("portalLinkId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!portalLinkId.success || !proposalId.success) return;

  const supabase = await createClient();
  await supabase.rpc("revoke_proposal_portal_link", { p_portal_link_id: portalLinkId.data });

  revalidatePath(`/proposals/${proposalId.data}`);
}
