import "server-only";

import { createClient } from "../supabase/server";
import { getSignedMediaUrls } from "../storage/media";

export type PortfolioOption = {
  mediaAssetId: string;
  portfolioProjectId: string;
  projectTitle: string;
  caption: string;
  thumbnailUrl: string | null;
};

/** Flattened list of every active portfolio project's photos, for the Proposal Builder's "select from Portfolio" picker. */
export async function getPortfolioMediaOptions(tenantId: string, limit = 100): Promise<PortfolioOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("portfolio_project_media")
    .select("media_asset_id, caption, media_assets(storage_path), portfolio_projects!inner(id, title, tenant_id, archived_at)")
    .eq("tenant_id", tenantId)
    .is("portfolio_projects.archived_at", null)
    .order("sort_order", { ascending: true })
    .limit(limit);

  const rows = data ?? [];
  const paths = rows.map((row) => row.media_assets?.storage_path).filter((p): p is string => Boolean(p));
  const signedUrls = await getSignedMediaUrls(paths);

  return rows.map((row) => {
    const path = row.media_assets?.storage_path;
    return {
      mediaAssetId: row.media_asset_id,
      portfolioProjectId: row.portfolio_projects.id,
      projectTitle: row.portfolio_projects.title,
      caption: row.caption,
      thumbnailUrl: path ? (signedUrls[path] ?? null) : null,
    };
  });
}
