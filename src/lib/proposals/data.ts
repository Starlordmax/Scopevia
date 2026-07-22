import "server-only";

import { createClient } from "../supabase/server";
import { getSignedMediaUrls } from "../storage/media";
import type { Database } from "../../../types/database";

type Proposal = Database["public"]["Tables"]["proposals"]["Row"];
type ProposalVersion = Database["public"]["Tables"]["proposal_versions"]["Row"];
type ProposalSection = Database["public"]["Tables"]["proposal_sections"]["Row"];
type ProposalLaborItem = Database["public"]["Tables"]["proposal_labor_items"]["Row"];
type ProposalLineItem = Database["public"]["Tables"]["proposal_line_items"]["Row"];
type ProposalMedia = Database["public"]["Tables"]["proposal_media"]["Row"];
type ProposalMeasurementGroup = Database["public"]["Tables"]["proposal_measurement_groups"]["Row"];
type ProposalMeasurement = Database["public"]["Tables"]["proposal_measurements"]["Row"];
type ProposalMeasurementShape = Database["public"]["Tables"]["proposal_measurement_shapes"]["Row"];
type ProposalMeasurementMaterial = Database["public"]["Tables"]["proposal_measurement_materials"]["Row"];

export type ProposalMediaWithUrl = ProposalMedia & {
  signedUrl: string | null;
  storagePath: string;
  caption: string;
};

export type FullProposal = {
  proposal: Proposal & { clients: { display_name: string } | null; client_contacts: { first_name: string; last_name: string | null } | null };
  version: ProposalVersion;
  sections: ProposalSection[];
  laborItems: ProposalLaborItem[];
  lineItems: ProposalLineItem[];
  currentJobMedia: ProposalMediaWithUrl[];
  previousWorkMedia: ProposalMediaWithUrl[];
  measurementGroups: ProposalMeasurementGroup[];
  measurements: ProposalMeasurement[];
  measurementShapes: ProposalMeasurementShape[];
  measurementMaterials: ProposalMeasurementMaterial[];
};

/**
 * Loads a proposal plus one of its versions and all editable/previewable
 * content, scoped to a tenant (always call with the ACTIVE tenant id, never
 * trust the id alone — see docs/35-phase-2a-rls-verification.md on stale
 * cross-tenant URLs). Returns null if not found in this tenant.
 *
 * `versionId` is optional and defaults to the proposal's CURRENT version —
 * used by the builder/preview/detail pages, which only ever care about
 * "now." When supplied (Phase 3B.1's Version History "View"/"Print" links,
 * Phase 3C's contractor export route), it's validated with
 * `.eq("proposal_id", proposalId)` on the version fetch itself: a version id
 * that doesn't actually belong to THIS proposal (a stray id, a typo, or a
 * deliberate cross-proposal probe) simply resolves to no row, and the whole
 * function returns null exactly like a not-found proposal — never a
 * different proposal's content. This is on top of (not instead of) RLS,
 * which already confines `proposal_versions` reads to the caller's own
 * tenant.
 */
export async function getFullProposal(tenantId: string, proposalId: string, versionId?: string): Promise<FullProposal | null> {
  const supabase = await createClient();

  const { data: proposal } = await supabase
    .from("proposals")
    .select("*, clients(display_name), client_contacts(first_name, last_name)")
    .eq("id", proposalId)
    .eq("tenant_id", tenantId)
    .single();

  if (!proposal) return null;

  const targetVersionId = versionId ?? proposal.current_version_id;
  if (!targetVersionId) return null;

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
    supabase.from("proposal_versions").select("*").eq("id", targetVersionId).eq("proposal_id", proposalId).single(),
    supabase
      .from("proposal_sections")
      .select("*")
      .eq("proposal_version_id", targetVersionId)
      .is("archived_at", null)
      .order("sort_order", { ascending: true }),
    supabase
      .from("proposal_labor_items")
      .select("*")
      .eq("proposal_version_id", targetVersionId)
      .is("archived_at", null)
      .order("sort_order", { ascending: true }),
    supabase
      .from("proposal_line_items")
      .select("*")
      .eq("proposal_version_id", targetVersionId)
      .is("archived_at", null)
      .order("sort_order", { ascending: true }),
    supabase
      .from("proposal_media")
      .select("*, media_assets(storage_path, caption)")
      .eq("proposal_version_id", targetVersionId)
      .is("archived_at", null)
      .order("sort_order", { ascending: true }),
    supabase
      .from("proposal_measurement_groups")
      .select("*")
      .eq("proposal_version_id", targetVersionId)
      .is("archived_at", null)
      .order("created_at", { ascending: true }),
    supabase
      .from("proposal_measurements")
      .select("*")
      .eq("proposal_version_id", targetVersionId)
      .is("archived_at", null)
      .order("sort_order", { ascending: true }),
    supabase.from("proposal_measurement_shapes").select("*").eq("proposal_version_id", targetVersionId),
    supabase.from("proposal_measurement_materials").select("*").eq("proposal_version_id", targetVersionId),
  ]);

  if (!version) return null;

  const mediaRows = (media ?? []) as (ProposalMedia & { media_assets: { storage_path: string; caption: string } | null })[];
  const paths = mediaRows.map((m) => m.media_assets?.storage_path).filter((p): p is string => Boolean(p));
  const signedUrls = await getSignedMediaUrls(paths);

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
