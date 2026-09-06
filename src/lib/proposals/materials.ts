import "server-only";

import { createClient } from "../supabase/server";
import { DEFAULT_PAGE_SIZE } from "../search";
import type { Database } from "../../../types/database";

export type MaterialCatalogSearchResult = Database["public"]["Functions"]["search_material_catalog"]["Returns"][number];

/**
 * Browse/search the material catalog for the Materials & Costs step —
 * always scoped to tenantId via search_material_catalog() (see
 * docs/42-material-catalog-by-zip.md). zipCode drives the best-available
 * price per result (find_material_zip_price()'s 3-tier fallback); a
 * result with unit_price_cents null means "no price available for this
 * ZIP" and must never be silently treated as free/zero.
 */
/**
 * Raw searchParams values (an unfilled search box, or the <select>'s "All
 * categories" option) arrive as "", not undefined -- and "" ?? null is
 * still "", not null. The SQL side treats an empty p_category as "match
 * category = ''" (never true) rather than "no filter", so every empty
 * filter must be normalized to null here, the one place all three funnel
 * through, or a cleared search box would silently return zero results.
 */
function emptyToNull(value: string | null | undefined): string | null {
  return value ? value : null;
}

export type MaterialCatalogPage = {
  items: MaterialCatalogSearchResult[];
  /** True total matching row count (via the RPC's count(*) over()), not just this page's length. */
  totalCount: number;
  /** items.length < totalCount -- whether a "Load more" click would return additional rows. */
  hasMore: boolean;
};

/**
 * Paginated: defaults to the first DEFAULT_PAGE_SIZE (20) rows. The
 * Materials & Costs step's "Load more" button re-requests with a larger
 * `limit` (not a true incremental offset) so the visible list is always
 * "the first N results so far" -- simple, stateless, no client-side
 * accumulation needed, and avoids any row-shifting risk if the
 * underlying data changes between clicks. See
 * docs/51-material-catalog-pagination.md.
 */
export async function searchMaterialCatalog(
  tenantId: string,
  filters: { zipCode?: string | null; searchText?: string; category?: string; limit?: number; offset?: number }
): Promise<MaterialCatalogPage> {
  // `as string` casts for the same reason as update_proposal_scope
  // (docs/37): these params have SQL DEFAULT NULL, Postgres accepts null,
  // but the generated arg types come out non-nullable.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_material_catalog", {
    p_tenant_id: tenantId,
    p_zip_code: emptyToNull(filters.zipCode) as string,
    p_search_text: emptyToNull(filters.searchText) as string,
    p_category: emptyToNull(filters.category) as string,
    p_limit: filters.limit ?? DEFAULT_PAGE_SIZE,
    p_offset: filters.offset ?? 0,
  });
  if (error) throw error;
  const items = data ?? [];
  const totalCount = items[0]?.total_count ?? 0;
  return { items, totalCount, hasMore: items.length < totalCount };
}
