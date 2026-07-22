"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "../lib/supabase/admin";
import {
  generatePortalOtpCode,
  generatePortalSessionToken,
  hashPortalSecret,
  hashIdentifier,
  portalSessionCookieName,
  portalSessionCookieOptions,
} from "../lib/portal/tokens";
import { sendPortalCodeEmail } from "../lib/email/portal";
import { notifyProposalAccepted, notifyProposalDeclined } from "../lib/notifications/proposals";
import { portalRequestOtpSchema, portalVerifyOtpSchema, acceptProposalSchema, declineProposalSchema } from "../lib/validation/portal";

// A code is valid for 10 minutes — long enough to check an inbox, short
// enough that a leaked/forwarded code stops working quickly.
const OTP_TTL_MINUTES = 10;

export type PortalActionResult = { error?: string };

/**
 * Requests a one-time access code for a client portal link. Always redirects
 * to the verify step on a non-error outcome — the caller never learns
 * whether the submitted email actually matched the proposal's client/contact
 * email (brief: "no revelar si el email existe"); portal_request_otp() only
 * sends a real code when it did, but the redirect (and the verify page's
 * static copy) is identical either way.
 */
export async function requestPortalOtpAction(_prev: PortalActionResult, formData: FormData): Promise<PortalActionResult> {
  const parsed = portalRequestOtpSchema.safeParse({
    token: formData.get("token"),
    email: formData.get("email"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Enter a valid email address." };

  const { token, email } = parsed.data;
  const tokenHash = hashPortalSecret(token);
  const supabase = createAdminClient();

  const { data: linkInfo } = await supabase.rpc("portal_get_link_info", { p_token_hash: tokenHash }).single();
  if (!linkInfo || !linkInfo.is_valid) {
    return { error: "This link is no longer valid." };
  }

  const code = generatePortalOtpCode();
  const codeHash = hashPortalSecret(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

  const hdrs = await headers();
  const ipHash = hashIdentifier(hdrs.get("x-forwarded-for"));
  const userAgentHash = hashIdentifier(hdrs.get("user-agent"));

  const { data, error } = await supabase
    .rpc("portal_request_otp", {
      p_token_hash: tokenHash,
      p_email: email,
      p_code_hash: codeHash,
      p_expires_at: expiresAt,
      p_ip_hash: ipHash as string,
      p_user_agent_hash: userAgentHash as string,
    })
    .single();

  if (error || !data) return { error: "We couldn't send the access code right now. Please try again in a moment." };

  if (data.outcome === "rate_limited") {
    return { error: "Too many requests. Please wait a few minutes and try again." };
  }
  if (data.outcome === "invalid_link") {
    return { error: "This link is no longer valid." };
  }

  if (data.email_matched) {
    // A send failure here must NEVER produce a browser-visible outcome
    // different from the normal "ok" path — anything else (a distinct
    // error message, a different redirect) would let an attacker infer
    // "this specific email IS authorized, but delivery failed," which is
    // exactly the enumeration leak "no revelar si el email existe" exists
    // to prevent. The failure is logged server-side only (never the raw
    // code/API key/response body — see sendPortalCodeEmail() and each
    // provider) and otherwise swallowed; the visitor sees the identical
    // "check your email" experience either way.
    try {
      await sendPortalCodeEmail({
        email,
        code,
        proposalTitle: linkInfo.proposal_title,
        businessName: linkInfo.business_name,
      });
    } catch (err) {
      console.error("[portal] sendPortalCodeEmail failed", err instanceof Error ? err.message : err);
    }
  }

  redirect(`/p/${token}/verify?email=${encodeURIComponent(email)}`);
}

/**
 * Verifies a one-time code and, on success, sets an httpOnly portal session
 * cookie (never a Supabase Auth session — see docs/53, "No Supabase Auth for
 * clients") and redirects to the proposal view.
 */
export async function verifyPortalOtpAction(_prev: PortalActionResult, formData: FormData): Promise<PortalActionResult> {
  const parsed = portalVerifyOtpSchema.safeParse({
    token: formData.get("token"),
    email: formData.get("email"),
    code: formData.get("code"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Enter the 6-digit code from your email." };

  const { token, email, code } = parsed.data;
  const tokenHash = hashPortalSecret(token);
  const codeHash = hashPortalSecret(code);
  const sessionToken = generatePortalSessionToken();
  const sessionTokenHash = hashPortalSecret(sessionToken);
  const sessionExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .rpc("portal_verify_otp", {
      p_token_hash: tokenHash,
      p_email: email,
      p_code_hash: codeHash,
      p_session_token_hash: sessionTokenHash,
      p_session_expires_at: sessionExpiresAt,
    })
    .single();

  if (error || !data) return { error: "Something went wrong. Please try again." };

  switch (data.outcome) {
    case "invalid_link":
      return { error: "This link is no longer valid." };
    case "expired":
      return { error: "This code has expired. Request a new one." };
    case "too_many_attempts":
      return { error: "Too many incorrect attempts. Request a new code." };
    case "wrong_code":
      return { error: "That code is incorrect. Please try again." };
    case "verified":
      break;
    default:
      return { error: "Something went wrong. Please try again." };
  }

  const cookieStore = await cookies();
  cookieStore.set(portalSessionCookieName(tokenHash), sessionToken, portalSessionCookieOptions(token));

  redirect(`/p/${token}/view`);
}

/** Reads the httpOnly portal session cookie for `token`, hashed and ready for an RPC call — null if absent. */
async function getPortalSessionTokenHash(token: string): Promise<string | null> {
  const tokenHash = hashPortalSecret(token);
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(portalSessionCookieName(tokenHash))?.value;
  return sessionToken ? hashPortalSecret(sessionToken) : null;
}

/**
 * The proposal title/number and tenant (business) name needed to render a
 * notification email — not part of submit_proposal_client_response()'s own
 * domain output, so fetched separately via the admin client, the same
 * "one extra lookup after the RPC" pattern /p/[token]/view/page.tsx
 * already uses for the tenant name.
 */
async function getNotificationContext(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  proposalId: string
): Promise<{ proposalTitle: string; proposalNumber: number; businessName: string } | null> {
  const [{ data: proposal }, { data: tenant }] = await Promise.all([
    admin.from("proposals").select("title, proposal_number").eq("id", proposalId).single(),
    admin.from("tenants").select("name").eq("id", tenantId).single(),
  ]);
  if (!proposal || !tenant) return null;
  return { proposalTitle: proposal.title, proposalNumber: proposal.proposal_number, businessName: tenant.name };
}

/**
 * Records the client's ACCEPT decision (Phase 3B). The client is already
 * authenticated (holds a verified portal session) by the time this runs —
 * unlike requestPortalOtpAction, there is no "no revelar si el email
 * existe" concern here, so errors can be specific and direct.
 */
export async function acceptProposalAction(_prev: PortalActionResult, formData: FormData): Promise<PortalActionResult> {
  const parsed = acceptProposalSchema.safeParse({
    token: formData.get("token"),
    clientName: formData.get("clientName"),
    acceptedTerms: formData.get("acceptedTerms") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check your response and try again." };

  const { token, clientName } = parsed.data;
  const sessionTokenHash = await getPortalSessionTokenHash(token);
  if (!sessionTokenHash) return { error: "Your session has expired. Please request a new access code." };

  const hdrs = await headers();
  const ipHash = hashIdentifier(hdrs.get("x-forwarded-for"));
  const userAgentHash = hashIdentifier(hdrs.get("user-agent"));

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .rpc("submit_proposal_client_response", {
      p_session_token_hash: sessionTokenHash,
      p_response_type: "accepted",
      p_client_name: clientName,
      p_decline_reason: null as unknown as string,
      p_accepted_terms: true,
      p_ip_hash: ipHash as string,
      p_user_agent_hash: userAgentHash as string,
    })
    .single();

  if (error) return { error: friendlyResponseError(error.message) };
  if (!data) return { error: "We couldn't record your response right now. Please try again in a moment." };

  if (data.outcome === "invalid_session") return { error: "Your session is no longer valid. Please request a new access code." };
  if (data.outcome === "already_responded") return { error: "This proposal has already received a response." };

  if (data.tenant_id && data.proposal_id && data.proposal_version_id && data.client_email && data.responded_at) {
    const context = await getNotificationContext(supabase, data.tenant_id, data.proposal_id);
    if (context) {
      await notifyProposalAccepted({
        tenantId: data.tenant_id,
        proposalId: data.proposal_id,
        proposalVersionId: data.proposal_version_id,
        clientName,
        clientEmail: data.client_email,
        respondedAt: data.responded_at,
        ...context,
      });
    }
  }

  revalidatePath(`/p/${token}/view`);
  return {};
}

/** Records the client's DECLINE decision (Phase 3B) — a reason is optional. */
export async function declineProposalAction(_prev: PortalActionResult, formData: FormData): Promise<PortalActionResult> {
  const parsed = declineProposalSchema.safeParse({
    token: formData.get("token"),
    declineReason: formData.get("declineReason") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check your response and try again." };

  const { token, declineReason } = parsed.data;
  const sessionTokenHash = await getPortalSessionTokenHash(token);
  if (!sessionTokenHash) return { error: "Your session has expired. Please request a new access code." };

  const hdrs = await headers();
  const ipHash = hashIdentifier(hdrs.get("x-forwarded-for"));
  const userAgentHash = hashIdentifier(hdrs.get("user-agent"));

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .rpc("submit_proposal_client_response", {
      p_session_token_hash: sessionTokenHash,
      p_response_type: "declined",
      p_client_name: null as unknown as string,
      p_decline_reason: (declineReason ?? null) as string,
      p_accepted_terms: false,
      p_ip_hash: ipHash as string,
      p_user_agent_hash: userAgentHash as string,
    })
    .single();

  if (error) return { error: friendlyResponseError(error.message) };
  if (!data) return { error: "We couldn't record your response right now. Please try again in a moment." };

  if (data.outcome === "invalid_session") return { error: "Your session is no longer valid. Please request a new access code." };
  if (data.outcome === "already_responded") return { error: "This proposal has already received a response." };

  if (data.tenant_id && data.proposal_id && data.proposal_version_id && data.client_email) {
    const context = await getNotificationContext(supabase, data.tenant_id, data.proposal_id);
    if (context) {
      await notifyProposalDeclined({
        tenantId: data.tenant_id,
        proposalId: data.proposal_id,
        proposalVersionId: data.proposal_version_id,
        clientEmail: data.client_email,
        declineReason: declineReason ?? null,
        ...context,
      });
    }
  }

  revalidatePath(`/p/${token}/view`);
  return {};
}

/** submit_proposal_client_response() raises a plain human-readable message for its two validation exceptions — pass those through, sanitize anything else. */
function friendlyResponseError(raw: string): string {
  if (/^You must confirm|^Your name is required/.test(raw)) return raw;
  return "We couldn't record your response right now. Please try again in a moment.";
}
