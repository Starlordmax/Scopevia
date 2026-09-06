"use server";

import { requireUser } from "../lib/auth/session";
import { requirePermission } from "../lib/auth/permissions";
import { PERMISSIONS } from "../lib/auth/permission-keys";
import { createClient } from "../lib/supabase/server";
import { getFullProposal } from "../lib/proposals/data";
import { getBusinessProfile } from "../lib/business/data";
import { buildProposalContextSummary } from "../lib/ai/proposal-context";
import { buildProposalTextPrompt } from "../lib/ai/prompt";
import { generateProposalTextDraft } from "../lib/ai/openrouter";
import { buildFallbackProposalTextDraft } from "../lib/ai/fallback-templates";
import { uuidSchema } from "../lib/validation/schemas";
import { generateProposalTextRequestSchema, type AiProposalTextDraft } from "../lib/validation/ai-proposal-text";
import { zodIssuesToFieldErrors } from "../lib/validation/field-errors";

/** Per-user, per-tenant -- see count_recent_ai_generations(). Matches the brief's "e.g. 10 generations per hour" example. */
const RATE_LIMIT_PER_HOUR = 10;
const GENERIC_ERROR = "We couldn't generate a draft right now. Please try again.";

export type GenerateProposalTextResult =
  | { ok: true; draft: AiProposalTextDraft; usedFallback: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Called directly from a Client Component (like createQuickClientAction),
 * not bound to a <form action>, since it returns a structured draft, not
 * a simple ActionResult. Never called from the client with the API key
 * or any prompt text -- everything AI-related happens in this function
 * and the server-only modules it calls. See docs/79-openrouter-security.md.
 */
export async function generateProposalTextAction(input: {
  tenantId: string;
  proposalId: string;
  proposalVersionId: string;
  feature: string;
  tone?: string;
  length?: string;
  includeWarranty?: boolean;
  includePaymentTerms?: boolean;
  includeExclusions?: boolean;
  includeClientResponsibilities?: boolean;
}): Promise<GenerateProposalTextResult> {
  await requireUser();

  const tenantId = uuidSchema.safeParse(input.tenantId);
  if (!tenantId.success) return { ok: false, error: "Invalid request" };

  const parsed = generateProposalTextRequestSchema.safeParse({
    proposalId: input.proposalId,
    proposalVersionId: input.proposalVersionId,
    feature: input.feature,
    tone: input.tone || undefined,
    length: input.length || undefined,
    includeWarranty: input.includeWarranty,
    includePaymentTerms: input.includePaymentTerms,
    includeExclusions: input.includeExclusions,
    includeClientResponsibilities: input.includeClientResponsibilities,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors: zodIssuesToFieldErrors(parsed.error) };
  }

  try {
    await requirePermission(tenantId.data, PERMISSIONS.AI_GENERATE_PROPOSAL_TEXT);
  } catch {
    return { ok: false, error: "You don't have permission to use the AI writing assistant." };
  }

  const supabase = await createClient();

  // Rate-limit check BEFORE any provider call or expensive data load --
  // a rate-limited user never incurs a cost or a slow round trip.
  const { data: recentCount, error: countError } = await supabase.rpc("count_recent_ai_generations", {
    p_tenant_id: tenantId.data,
    p_window_minutes: 60,
  });
  if (countError) return { ok: false, error: GENERIC_ERROR };
  if ((recentCount ?? 0) >= RATE_LIMIT_PER_HOUR) {
    return { ok: false, error: `You've reached the limit of ${RATE_LIMIT_PER_HOUR} AI generations per hour. Please try again later.` };
  }

  const full = await getFullProposal(tenantId.data, parsed.data.proposalId, parsed.data.proposalVersionId);
  if (!full) return { ok: false, error: "Proposal not found." };

  // Same "editable" gate as the rest of the Terms & Pricing step (see
  // edit/page.tsx's `isDraft`) -- no generation for an archived proposal
  // or a version that's no longer a live draft (sent/accepted/declined).
  const isDraft = full.version.version_status === "draft" && full.proposal.status === "draft";
  if (!isDraft) {
    return { ok: false, error: "This proposal can no longer be edited." };
  }

  const businessProfile = await getBusinessProfile(tenantId.data);
  if (!businessProfile) return { ok: false, error: GENERIC_ERROR };

  const context = buildProposalContextSummary(full);
  const { system, user } = buildProposalTextPrompt(parsed.data, businessProfile, context);

  const result = await generateProposalTextDraft(system, user);

  if (result.ok) {
    await recordEvent(supabase, tenantId.data, parsed.data, result.model, "success", null, result.inputTokens, result.outputTokens);
    return { ok: true, draft: result.draft, usedFallback: false };
  }

  if (result.errorCode === "missing_api_key") {
    // Not a failure to log as an "error" attempt -- AI simply isn't
    // configured, so the fallback template is the expected path, not a
    // degraded one. Still logged (model: "fallback-template") so usage
    // is visible in ai_generation_events.
    const fallback = buildFallbackProposalTextDraft(businessProfile, context);
    await recordEvent(supabase, tenantId.data, parsed.data, "fallback-template", "success", null, null, null);
    return { ok: true, draft: fallback, usedFallback: true };
  }

  await recordEvent(supabase, tenantId.data, parsed.data, result.model, "error", result.errorCode, null, null);
  return { ok: false, error: result.message };
}

async function recordEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  request: { proposalId: string; proposalVersionId: string; feature: string },
  model: string,
  status: "success" | "error",
  errorCode: string | null,
  inputTokens: number | null,
  outputTokens: number | null
): Promise<void> {
  // Best-effort -- a logging failure must never block returning the
  // draft (or the error) the user is actually waiting on.
  try {
    await supabase.rpc("record_ai_generation_event", {
      p_tenant_id: tenantId,
      p_proposal_id: request.proposalId,
      p_proposal_version_id: request.proposalVersionId,
      p_feature: request.feature,
      p_model: model,
      p_status: status,
      // `as` casts for the same reason as update_proposal_pricing_zip
      // (docs/37): these params have SQL DEFAULT NULL, Postgres accepts
      // null, but the generated arg types come out non-nullable.
      p_error_code: errorCode as string,
      p_input_tokens: inputTokens as number,
      p_output_tokens: outputTokens as number,
    });
  } catch (error) {
    console.error("Failed to record AI generation event:", error);
  }
}
