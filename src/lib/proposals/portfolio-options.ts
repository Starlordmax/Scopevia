import "server-only";

import { createClient } from "../supabase/server";

export type PortfolioOption = {
  mediaAssetId: string;
  portfolioProjectId: string;
  projectTitle: string;
  caption: string;
};

/** Flattened list of every active portfolio project's photos, for the Proposal Builder's "select from Portfolio" picker. */
export async function getPortfolioMediaOptions(tenantId: string, limit = 100): Promise<PortfolioOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("portfolio_project_media")
    .select("media_asset_id, caption, portfolio_projects!inner(id, title, tenant_id, archived_at)")
    .eq("tenant_id", tenantId)
    .is("portfolio_projects.archived_at", null)
    .order("sort_order", { ascending: true })
    .limit(limit);

  return (data ?? []).map((row) => ({
    mediaAssetId: row.media_asset_id,
    portfolioProjectId: row.portfolio_projects.id,
    projectTitle: row.portfolio_projects.title,
    caption: row.caption,
  }));
}
