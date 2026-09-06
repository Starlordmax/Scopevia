import "server-only";

import { createAdminClient } from "../supabase/admin";
import { createClient } from "../supabase/server";
import { getSignedMediaUrlsForPortal } from "../storage/media";
import type { FullProposal, ProposalMediaWithUrl } from "../proposals/data";
import type { Database } from "../../../types/database";

type ProposalMedia = Database["public"]["Tables"]["proposal_media"]["Row"];
type ProposalPortalLink = Database["public"]["Tables"]["proposal_portal_links"]["Row"];

export type ProposalClientResponse = {
  id: string;
  responseType: "accepted" | "declined";
  clientName: string | null;
  clientEmail: string;
  declineReason: string | null;
  respondedAt: string;
};

function mapClientResponseRow(row: {
  id: string;
  response_type: string;
  client_name: string | null;
  client_email: string;
  decline_reason: string | null;
  responded_at: string;
}): ProposalClientResponse {
  return {
    id: row.id,
    responseType: row.response_type as "accepted" | "declined",
    clientName: row.client_name,
    clientEmail: row.client_email,
    declineReason: row.decline_reason,
    respondedAt: row.responded_at,
  };
}

/**
 * Loads a proposal for the PUBLIC portal, scoped by three ids that
 * portal_get_session_context() has already authoritatively validated (a
 * revoked link or an archived/non-ready proposal never reaches this
 * function at all — see src/app/p/[token]/view/page.tsx). Uses the
 * service-role admin client because a portal visitor has no Supabase Auth
 * session for ordinary RLS to run against (see docs/53, "Why the admin
 * client here").
 *
 * Deliberately mirrors getFullProposal() (src/lib/proposals/data.ts) field
 * for field, since both feed the exact same ProposalDocument component —
 * see that component's header comment: "No internal IDs, storage paths, or
 * technical metadata are ever rendered here."
 */
export async function getFullProposalForPortal(proposalId: string, proposalVersionId: string): Promise<FullProposal | null> {
  const supabase = createAdminClient();

  const { data: proposal } = await supabase
    .from("proposals")
    .select("*, clients(display_name), client_contacts(first_name, last_name)")
    .eq("id", proposalId)
    .single();

  if (!proposal) return null;

  const [
    { data: version },
    { data: sections },
    { data: laborItems },
    { data: lineItems },
    { data: media },
    { data: measurementGroups },
    { data: measurements },
    { data: measurementShapes },
    { data: measurementMaterials },
  ] = await Promise.all([
    supabase.from("proposal_versions").select("*").eq("id", proposalVersionId).single(),
    supabase.from("proposal_sections").select("*").eq("proposal_version_id", proposalVersionId).is("archived_at", null).order("sort_order", { ascending: true }),
    supabase
      .from("proposal_labor_items")
      .select("*")
      .eq("proposal_version_id", proposalVersionId)
      .is("archived_at", null)
      .order("sort_order", { ascending: true }),
    supabase
      .from("proposal_line_items")
      .select("*")
      .eq("proposal_version_id", proposalVersionId)
      .is("archived_at", null)
      .order("sort_order", { ascending: true }),
    supabase
      .from("proposal_media")
      .select("*, media_assets(storage_path, caption)")
      .eq("proposal_version_id", proposalVersionId)
      .is("archived_at", null)
      .order("sort_order", { ascending: true }),
    supabase
      .from("proposal_measurement_groups")
      .select("*")
      .eq("proposal_version_id", proposalVersionId)
      .is("archived_at", null)
      .order("created_at", { ascending: true }),
    supabase
      .from("proposal_measurements")
      .select("*")
      .eq("proposal_version_id", proposalVersionId)
      .is("archived_at", null)
      .order("sort_order", { ascending: true }),
    supabase.from("proposal_measurement_shapes").select("*").eq("proposal_version_id", proposalVersionId),
    supabase.from("proposal_measurement_materials").select("*").eq("proposal_version_id", proposalVersionId),
  ]);

  if (!version) return null;

  const mediaRows = (media ?? []) as (ProposalMedia & { media_assets: { storage_path: string; caption: string } | null })[];
  const paths = mediaRows.map((m) => m.media_assets?.storage_path).filter((p): p is string => Boolean(p));
  // Same 5-minute signed URL convention as the internal preview (src/lib/storage/media.ts)
  // — computed fresh on every portal page load, never cached/reused past this request.
  const signedUrls = await getSignedMediaUrlsForPortal(paths);

  const withUrls: ProposalMediaWithUrl[] = mediaRows.map((m) => ({
    ...m,
    storagePath: m.media_assets?.storage_path ?? "",
    caption: m.caption || m.media_assets?.caption || "",
    signedUrl: m.media_assets?.storage_path ? (signedUrls[m.media_assets.storage_path] ?? null) : null,
  }));

  return {
    proposal,
    version,
    sections: sections ?? [],
    laborItems: laborItems ?? [],
    lineItems: lineItems ?? [],
    currentJobMedia: withUrls.filter((m) => m.usage_type === "current_job"),
    previousWorkMedia: withUrls.filter((m) => m.usage_type === "previous_work"),
    measurementGroups: measurementGroups ?? [],
    measurements: measurements ?? [],
    measurementShapes: measurementShapes ?? [],
    measurementMaterials: measurementMaterials ?? [],
  };
}

/**
 * Lists a proposal's portal links for the CONTRACTOR-facing detail page.
 * Uses the caller's own session (RLS: proposal_portal_links_select, gated on
 * proposal_portal_links.view) — never the admin client, since this is an
 * authenticated tenant member looking at their own tenant's data.
 */
export async function getProposalPortalLinks(proposalId: string): Promise<ProposalPortalLink[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("proposal_portal_links").select("*").eq("proposal_id", proposalId).order("created_at", { ascending: false });
  return data ?? [];
}

const CLIENT_RESPONSE_COLUMNS = "id, response_type, client_name, client_email, decline_reason, responded_at";

/**
 * The PUBLIC-portal read: is there already a final response for this exact
 * version? Used by /p/[token]/view to decide whether to show the accept/
 * decline form or the final "Proposal accepted/declined" state. Admin
 * client — same reasoning as getFullProposalForPortal() above.
 */
export async function getPortalResponse(proposalVersionId: string): Promise<ProposalClientResponse | null> {
  const supabase = createAdminClient();
  const { data } = await supabase.from("proposal_client_responses").select(CLIENT_RESPONSE_COLUMNS).eq("proposal_version_id", proposalVersionId).maybeSingle();
  return data ? mapClientResponseRow(data) : null;
}

/**
 * The CONTRACTOR-facing read, for the proposal detail page's "Client
 * response" card. Scoped to a single proposal_version_id, not the whole
 * proposal (Phase 3B.1: a proposal can have several versions over its
 * lifetime, each with at most one response — proposal_client_responses'
 * own unique(proposal_version_id) constraint — so "the" response for a
 * proposal is ambiguous without pinning it to a version; callers pass the
 * CURRENT version's id to show the response tied to what's active right
 * now). Uses the caller's own session (RLS: proposal_client_responses_select,
 * gated on proposals.view) — never the admin client.
 */
export async function getProposalClientResponse(proposalVersionId: string): Promise<ProposalClientResponse | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("proposal_client_responses").select(CLIENT_RESPONSE_COLUMNS).eq("proposal_version_id", proposalVersionId).maybeSingle();
  return data ? mapClientResponseRow(data) : null;
}

export type ProposalVersionHistoryEntry = {
  id: string;
  versionNumber: number;
  versionStatus: string;
  createdAt: string;
  lockedAt: string | null;
  isCurrent: boolean;
  response: ProposalClientResponse | null;
  latestPortalLinkStatus: "active" | "expired" | "revoked" | "none";
};

/**
 * Every version a proposal has ever had (newest first), each paired with
 * its own response (if any) and its most recent portal link's display
 * status — for the "Version history" section on the proposal detail page
 * (Phase 3B.1). Never exposes a raw version/link id to the page beyond what
 * React needs as a list key; nothing here is rendered as a UUID in the UI.
 */
export async function getProposalVersionHistory(proposalId: string): Promise<ProposalVersionHistoryEntry[]> {
  const supabase = await createClient();

  const [{ data: proposal }, { data: versions }, { data: responses }, { data: links }] = await Promise.all([
    supabase.from("proposals").select("current_version_id").eq("id", proposalId).maybeSingle(),
    supabase
      .from("proposal_versions")
      .select("id, version_number, version_status, created_at, locked_at")
      .eq("proposal_id", proposalId)
      .order("version_number", { ascending: false }),
    supabase.from("proposal_client_responses").select(`${CLIENT_RESPONSE_COLUMNS}, proposal_version_id`).eq("proposal_id", proposalId),
    supabase
      .from("proposal_portal_links")
      .select("proposal_version_id, status, expires_at, created_at")
      .eq("proposal_id", proposalId)
      .order("created_at", { ascending: false }),
  ]);

  const responseByVersion = new Map((responses ?? []).map((r) => [r.proposal_version_id, mapClientResponseRow(r)]));

  const latestLinkByVersion = new Map<string, { status: string; expires_at: string }>();
  for (const link of links ?? []) {
    if (!latestLinkByVersion.has(link.proposal_version_id)) {
      latestLinkByVersion.set(link.proposal_version_id, link);
    }
  }

  return (versions ?? []).map((v) => {
    const link = latestLinkByVersion.get(v.id);
    let latestPortalLinkStatus: ProposalVersionHistoryEntry["latestPortalLinkStatus"] = "none";
    if (link) {
      if (link.status === "revoked") latestPortalLinkStatus = "revoked";
      else if (new Date(link.expires_at) <= new Date()) latestPortalLinkStatus = "expired";
      else latestPortalLinkStatus = "active";
    }

    return {
      id: v.id,
      versionNumber: v.version_number,
      versionStatus: v.version_status,
      createdAt: v.created_at,
      lockedAt: v.locked_at,
      isCurrent: v.id === proposal?.current_version_id,
      response: responseByVersion.get(v.id) ?? null,
      latestPortalLinkStatus,
    };
  });
}
