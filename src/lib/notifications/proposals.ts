import "server-only";

import { createAdminClient } from "../supabase/admin";
import { sendEmail, configuredEmailProviderName } from "../email/send";
import { buildInternalProposalUrl } from "./internal-url";
import { buildDedupeKey, sanitizeErrorForStorage } from "./dedupe-key";
import {
  renderProposalViewedEmail,
  renderProposalAcceptedEmail,
  renderProposalDeclinedEmail,
  renderAcceptedConfirmationToClientEmail,
  renderDeclinedConfirmationToClientEmail,
  type RenderedEmail,
} from "../email/templates/proposal-notification";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../types/database";

/**
 * Email notifications for Client Portal events (Phase 3D) — see
 * docs/62-proposal-email-notifications.md for the full design. Every
 * exported function here NEVER throws: a delivery failure (bad provider
 * config, a network error, an unexpected DB error) is caught, logged
 * server-side, and recorded in proposal_notification_deliveries with
 * status='failed' — it never reverts the event that triggered it, never
 * blocks the client's own flow, and never bubbles up to break a page
 * render or a Server Action's response. Dispatch is synchronous (awaited
 * by the caller), a deliberate choice over Next.js's after() — see
 * docs/62, "Why synchronous, not after()."
 */

type BaseProposalContext = {
  tenantId: string;
  proposalId: string;
  proposalVersionId: string;
  proposalTitle: string;
  proposalNumber: number;
  businessName: string;
};

type EventType =
  | "proposal_viewed"
  | "proposal_accepted"
  | "proposal_declined"
  | "accepted_confirmation_to_client"
  | "declined_confirmation_to_client";

type AdminClient = SupabaseClient<Database>;

/**
 * Inserts a proposal_notification_deliveries row FIRST (status='pending'),
 * and only actually sends the email if that insert succeeds — a
 * unique_violation on dedupe_key means an identical (event, version,
 * recipient) attempt already exists, so the send is skipped entirely. This
 * is the sole duplicate-email guard (see the table's own migration
 * comment) — the same "insert first, let the unique constraint decide"
 * discipline this codebase already uses for
 * proposal_client_responses.unique(proposal_version_id).
 */
async function recordAndSend(
  admin: AdminClient,
  eventType: EventType,
  base: Pick<BaseProposalContext, "tenantId" | "proposalId" | "proposalVersionId">,
  recipientEmail: string,
  rendered: RenderedEmail
): Promise<void> {
  const dedupeKey = buildDedupeKey(eventType, base.proposalVersionId, recipientEmail);
  const provider = configuredEmailProviderName();

  const { error: insertError } = await admin.from("proposal_notification_deliveries").insert({
    tenant_id: base.tenantId,
    proposal_id: base.proposalId,
    proposal_version_id: base.proposalVersionId,
    event_type: eventType,
    recipient_email: recipientEmail,
    status: "pending",
    provider,
    dedupe_key: dedupeKey,
  });

  if (insertError) {
    if (insertError.code !== "23505") {
      console.error(`[notifications] failed to record delivery for ${eventType}`, insertError.code);
    }
    return;
  }

  try {
    await sendEmail({ to: recipientEmail, subject: rendered.subject, text: rendered.text, html: rendered.html });
    await admin.from("proposal_notification_deliveries").update({ status: "sent", sent_at: new Date().toISOString() }).eq("dedupe_key", dedupeKey);
  } catch (err) {
    const errorCode = sanitizeErrorForStorage(err);
    console.error(`[notifications] failed to send ${eventType} email`, errorCode);
    await admin
      .from("proposal_notification_deliveries")
      .update({ status: "failed", failed_at: new Date().toISOString(), error_code: errorCode })
      .eq("dedupe_key", dedupeKey);
  }
}

/** Owner/Admin/Estimator/Sales active members of the tenant — see get_proposal_notification_recipients() for the exact rule. */
async function notifyTeam(admin: AdminClient, base: BaseProposalContext, eventType: EventType, rendered: RenderedEmail): Promise<void> {
  const { data: recipients, error } = await admin.rpc("get_proposal_notification_recipients", { p_tenant_id: base.tenantId });
  if (error) {
    console.error("[notifications] failed to resolve recipients", error.code);
    return;
  }
  if (!recipients || recipients.length === 0) return;

  await Promise.all(recipients.filter((r) => r.email).map((r) => recordAndSend(admin, eventType, base, r.email as string, rendered)));
}

export type NotifyProposalViewedParams = BaseProposalContext & { clientEmail: string };

export async function notifyProposalViewed(params: NotifyProposalViewedParams): Promise<void> {
  try {
    const admin = createAdminClient();
    const internalProposalUrl = buildInternalProposalUrl(process.env.APP_BASE_URL, params.proposalId);
    const rendered = renderProposalViewedEmail({
      proposalTitle: params.proposalTitle,
      proposalNumber: params.proposalNumber,
      businessName: params.businessName,
      internalProposalUrl,
      clientEmail: params.clientEmail,
    });
    await notifyTeam(admin, params, "proposal_viewed", rendered);
  } catch (err) {
    console.error("[notifications] notifyProposalViewed failed", err instanceof Error ? err.message : err);
  }
}

export type NotifyProposalAcceptedParams = BaseProposalContext & { clientName: string; clientEmail: string; respondedAt: string };

export async function notifyProposalAccepted(params: NotifyProposalAcceptedParams): Promise<void> {
  try {
    const admin = createAdminClient();
    const internalProposalUrl = buildInternalProposalUrl(process.env.APP_BASE_URL, params.proposalId);
    const rendered = renderProposalAcceptedEmail({
      proposalTitle: params.proposalTitle,
      proposalNumber: params.proposalNumber,
      businessName: params.businessName,
      internalProposalUrl,
      clientName: params.clientName,
      clientEmail: params.clientEmail,
      respondedAt: params.respondedAt,
    });
    await notifyTeam(admin, params, "proposal_accepted", rendered);

    const confirmation = renderAcceptedConfirmationToClientEmail({ proposalTitle: params.proposalTitle, businessName: params.businessName });
    await recordAndSend(admin, "accepted_confirmation_to_client", params, params.clientEmail, confirmation);
  } catch (err) {
    console.error("[notifications] notifyProposalAccepted failed", err instanceof Error ? err.message : err);
  }
}

export type NotifyProposalDeclinedParams = BaseProposalContext & { clientEmail: string; declineReason: string | null };

export async function notifyProposalDeclined(params: NotifyProposalDeclinedParams): Promise<void> {
  try {
    const admin = createAdminClient();
    const internalProposalUrl = buildInternalProposalUrl(process.env.APP_BASE_URL, params.proposalId);
    const rendered = renderProposalDeclinedEmail({
      proposalTitle: params.proposalTitle,
      proposalNumber: params.proposalNumber,
      businessName: params.businessName,
      internalProposalUrl,
      clientEmail: params.clientEmail,
      declineReason: params.declineReason,
    });
    await notifyTeam(admin, params, "proposal_declined", rendered);

    const confirmation = renderDeclinedConfirmationToClientEmail({ proposalTitle: params.proposalTitle, businessName: params.businessName });
    await recordAndSend(admin, "declined_confirmation_to_client", params, params.clientEmail, confirmation);
  } catch (err) {
    console.error("[notifications] notifyProposalDeclined failed", err instanceof Error ? err.message : err);
  }
}
