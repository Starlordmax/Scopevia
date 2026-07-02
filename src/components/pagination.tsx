import Link from "next/link";

/** Server-rendered prev/next pagination that preserves the current query string. */
export function Pagination({
  page,
  pageSize,
  totalCount,
  searchParams,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  searchParams: Record<string, string | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  if (totalPages <= 1) return null;

  function hrefForPage(p: number): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value && key !== "page") params.set(key, value);
    }
    params.set("page", String(p));
    return `?${params.toString()}`;
  }

  return (
    <div className="tenant-form" style={{ justifyContent: "space-between", width: "100%" }}>
      {page > 1 ? (
        <Link href={hrefForPage(page - 1)} className="button-secondary">
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="hint">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={hrefForPage(page + 1)} className="button-secondary">
          Next →
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}
