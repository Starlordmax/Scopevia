import "server-only";

/**
 * Two independent layers of escaping are needed to safely drop a raw user
 * search term into a PostgREST `.or(...)` filter string built from several
 * `column.ilike.%term%` clauses:
 *
 *   1. SQL ILIKE wildcard escaping (`%`, `_`) — otherwise a term like "50%
 *      off" would match "50" followed by anything, not the literal string.
 *      Postgres's default LIKE/ILIKE escape character is backslash.
 *   2. PostgREST `.or()` filter-syntax escaping (`,`, `(`, `)`) — those
 *      characters are structural in the filter string itself (they separate
 *      conditions / group them), so a term containing e.g. a comma would
 *      otherwise inject an extra, attacker-uncontrolled condition boundary.
 *
 * Order matters: escape backslashes first in each layer, then that layer's
 * own special characters, and apply layer 1 before layer 2 (layer 2 must
 * also escape the backslashes layer 1 introduces).
 */
function escapeLikeWildcards(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function escapeOrFilterSyntax(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Builds a safe `%term%` ILIKE pattern, ready to embed in a PostgREST `.or()` string. */
export function containsPattern(term: string): string {
  return escapeOrFilterSyntax(`%${escapeLikeWildcards(term)}%`);
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function clampPageSize(pageSize: number): number {
  return Math.min(Math.max(1, pageSize), MAX_PAGE_SIZE);
}

export function rangeFor(page: number, pageSize: number): [number, number] {
  const size = clampPageSize(pageSize);
  const from = (Math.max(1, page) - 1) * size;
  return [from, from + size - 1];
}
