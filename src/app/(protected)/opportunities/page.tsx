import Link from "next/link";
import { Kanban as KanbanIcon, Archive } from "lucide-react";
import { requireActiveTenant } from "../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../lib/auth/permissions";
import { createClient } from "../../../lib/supabase/server";
import { containsPattern, rangeFor, DEFAULT_PAGE_SIZE } from "../../../lib/search";
import { SearchForm } from "../../../components/search-form";
import { Pagination } from "../../../components/pagination";
import { PageHeader } from "../../../components/page-header";
import { EmptyState } from "../../../components/empty-state";
import { opportunityBadgeClass } from "../../../lib/crm/status-badge";

export const dynamic = "force-dynamic";

function formatMoney(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; archived?: string }>;
}) {
  const { tenant } = await requireActiveTenant();
  const canView = await hasPermission(tenant.tenant_id, PERMISSIONS.OPPORTUNITIES_VIEW);
  if (!canView) {
    return (
      <div className="stack">
        <h1>Opportunities</h1>
        <p className="hint">Your current role ({tenant.role_name}) does not include access to this page.</p>
      </div>
    );
  }

  const canCreate = await hasPermission(tenant.tenant_id, PERMISSIONS.OPPORTUNITIES_CREATE);

  const { q, page: pageRaw, archived } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? "1", 10) || 1);
  const showArchived = archived === "1";
  const [from, to] = rangeFor(page, DEFAULT_PAGE_SIZE);

  const supabase = await createClient();
  let query = supabase
    .from("opportunities")
    .select("id, title, status, estimated_value_cents, expected_close_date, clients(display_name)", { count: "exact" })
    .eq("tenant_id", tenant.tenant_id);

  query = showArchived ? query.eq("status", "archived") : query.neq("status", "archived");
  if (q) query = query.ilike("title", containsPattern(q));

  const { data: opportunities, count, error } = await query.order("created_at", { ascending: false }).range(from, to);

  return (
    <div className="stack">
      <PageHeader
        icon={KanbanIcon}
        title="Opportunities"
        action={
          canCreate ? (
            <Link href="/opportunities/new" className="button-primary">
              + New
            </Link>
          ) : null
        }
      />

      <SearchForm placeholder="Search by title…" defaultValue={q ?? ""} />

      <div className="hint">
        <Link href={showArchived ? "/opportunities" : "/opportunities?archived=1"}>
          {showArchived ? "← Back to active opportunities" : "View archived opportunities"}
        </Link>
      </div>

      {error ? <p className="error-banner">{error.message}</p> : null}

      {!opportunities || opportunities.length === 0 ? (
        <div className="section-card">
          {q ? (
            <EmptyState icon={KanbanIcon} title="No matches" description="No opportunities match your search. Try a different title." />
          ) : showArchived ? (
            <EmptyState icon={Archive} title="No archived opportunities" description="Opportunities you archive after winning or losing them will show up here." />
          ) : (
            <EmptyState
              icon={KanbanIcon}
              title="No opportunities yet"
              description="An opportunity tracks a potential job from first contact through to a scheduled inspection or an accepted proposal."
              action={
                canCreate ? (
                  <Link href="/opportunities/new" className="button-primary">
                    + New
                  </Link>
                ) : undefined
              }
            />
          )}
        </div>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Client</th>
                <th>Status</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {opportunities.map((o) => (
                <tr key={o.id}>
                  <td data-label="Title">
                    <Link href={`/opportunities/${o.id}`}>{o.title}</Link>
                  </td>
                  <td data-label="Client">{o.clients?.display_name ?? "—"}</td>
                  <td data-label="Status">
                    <span className={`badge ${opportunityBadgeClass(o.status)}`.trim()}>{o.status.replace(/_/g, " ")}</span>
                  </td>
                  <td data-label="Value">{formatMoney(o.estimated_value_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pageSize={DEFAULT_PAGE_SIZE} totalCount={count ?? 0} searchParams={{ q, archived }} />
    </div>
  );
}
