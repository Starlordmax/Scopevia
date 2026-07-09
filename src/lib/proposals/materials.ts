import "server-only";

import { createClient } from "../supabase/server";
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

export async function searchMaterialCatalog(
  tenantId: string,
  filters: { zipCode?: string | null; searchText?: string; category?: string }
): Promise<MaterialCatalogSearchResult[]> {
  // `as string` casts for the same reason as update_proposal_scope
  // (docs/37): these params have SQL DEFAULT NULL, Postgres accepts null,
  // but the generated arg types come out non-nullable.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_material_catalog", {
    p_tenant_id: tenantId,
    p_zip_code: emptyToNull(filters.zipCode) as string,
    p_search_text: emptyToNull(filters.searchText) as string,
    p_category: emptyToNull(filters.category) as string,
  });
  if (error) throw error;
  return data ?? [];
}
