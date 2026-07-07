import Link from "next/link";
import { Images, Archive } from "lucide-react";
import { requireActiveTenant } from "../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../lib/auth/permissions";
import { createClient } from "../../../lib/supabase/server";
import { containsPattern, rangeFor, DEFAULT_PAGE_SIZE } from "../../../lib/search";
import { SearchForm } from "../../../components/search-form";
import { Pagination } from "../../../components/pagination";
import { PageHeader } from "../../../components/page-header";
import { EmptyState } from "../../../components/empty-state";

export const dynamic = "force-dynamic";

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; archived?: string }>;
}) {
  const { tenant } = await requireActiveTenant();
  const canView = await hasPermission(tenant.tenant_id, PERMISSIONS.PORTFOLIO_VIEW);
  if (!canView) {
    return (
      <div className="stack">
        <h1>Portfolio</h1>
        <p className="hint">Your current role ({tenant.role_name}) does not include access to this page.</p>
      </div>
    );
  }

  const canCreate = await hasPermission(tenant.tenant_id, PERMISSIONS.PORTFOLIO_CREATE);

  const { q, page: pageRaw, archived } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? "1", 10) || 1);
  const showArchived = archived === "1";
  const [from, to] = rangeFor(page, DEFAULT_PAGE_SIZE);

  const supabase = await createClient();
  let query = supabase
    .from("portfolio_projects")
    .select("id, title, service_type, location_label, portfolio_project_media(media_asset_id)", { count: "exact" })
    .eq("tenant_id", tenant.tenant_id);

  query = showArchived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (q) query = query.ilike("title", containsPattern(q));

  const { data: projects, count, error } = await query.order("created_at", { ascending: false }).range(from, to);

  return (
    <div className="stack">
      <PageHeader
        icon={Images}
        title="Portfolio"
        description="Showcase your previous work to reuse in future proposals."
        action={
          canCreate ? (
            <Link href="/portfolio/new" className="button-primary">
              + New portfolio item
            </Link>
          ) : null
        }
      />

      <SearchForm placeholder="Search by title…" defaultValue={q ?? ""} />

      <div className="hint">
        <Link href={showArchived ? "/portfolio" : "/portfolio?archived=1"}>
          {showArchived ? "← Back to active portfolio" : "View archived portfolio items"}
        </Link>
      </div>

      {error ? <p className="error-banner">{error.message}</p> : null}

      {!projects || projects.length === 0 ? (
        <div className="section-card">
          {q ? (
            <EmptyState icon={Images} title="No matches" description="No portfolio items match your search." />
          ) : showArchived ? (
            <EmptyState icon={Archive} title="No archived portfolio items" description="Portfolio items you archive will show up here." />
          ) : (
            <EmptyState
              icon={Images}
              title="No portfolio items yet"
              description="Add photos of your previous work here so you can quickly showcase them in future proposals."
              action={
                canCreate ? (
                  <Link href="/portfolio/new" className="button-primary">
                    + New portfolio item
                  </Link>
                ) : undefined
              }
            />
          )}
        </div>
      ) : (
        <div className="metrics-grid">
          {projects.map((p) => (
            <Link key={p.id} href={`/portfolio/${p.id}`} className="card" style={{ maxWidth: "none" }}>
              <strong>{p.title}</strong>
              <p className="hint">{p.service_type.replace(/_/g, " ")}</p>
              {p.location_label ? <p className="hint">{p.location_label}</p> : null}
              <span className="badge">{p.portfolio_project_media?.length ?? 0} photo(s)</span>
            </Link>
          ))}
        </div>
      )}

      <Pagination page={page} pageSize={DEFAULT_PAGE_SIZE} totalCount={count ?? 0} searchParams={{ q, archived }} />
    </div>
  );
}
