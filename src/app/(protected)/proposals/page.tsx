import Link from "next/link";
import { FileText, Archive } from "lucide-react";
import { requireActiveTenant } from "../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../lib/auth/permissions";
import { createClient } from "../../../lib/supabase/server";
import { containsPattern, rangeFor, DEFAULT_PAGE_SIZE } from "../../../lib/search";
import { formatCents, formatLabel } from "../../../lib/proposals/format";
import { proposalBadgeClass } from "../../../lib/crm/status-badge";
import { SearchForm } from "../../../components/search-form";
import { Pagination } from "../../../components/pagination";
import { PageHeader } from "../../../components/page-header";
import { EmptyState } from "../../../components/empty-state";

export const dynamic = "force-dynamic";

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; view?: string; status?: string }>;
}) {
  const { tenant } = await requireActiveTenant();
  const canView = await hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSALS_VIEW);
  if (!canView) {
    return (
      <div className="stack">
        <h1>Proposals</h1>
        <p className="hint">Your current role ({tenant.role_name}) does not include access to this page.</p>
      </div>
    );
  }

  const canCreate = await hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSALS_CREATE);

  const { q, page: pageRaw, view: rawView, status } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? "1", 10) || 1);
  // "active"/"archived"/"all" — an explicit status= (e.g. the dashboard's
  // "Needs follow-up" link to ?status=ready) always wins over the view
  // toggle, so the two filters never contradict each other by both
  // constraining the same status column.
  const view = rawView === "archived" ? "archived" : rawView === "all" ? "all" : "active";
  const [from, to] = rangeFor(page, DEFAULT_PAGE_SIZE);

  const supabase = await createClient();
  let query = supabase
    .from("proposals")
    .select("id, proposal_number, title, service_type, status, updated_at, clients(display_name), proposal_versions!proposals_current_version_id_fkey(total_cents)", {
      count: "exact",
    })
    .eq("tenant_id", tenant.tenant_id);

  if (status) {
    query = query.eq("status", status);
  } else if (view === "active") {
    query = query.neq("status", "archived");
  } else if (view === "archived") {
    query = query.eq("status", "archived");
  }
  if (q) query = query.ilike("title", containsPattern(q));

  const { data: proposals, count, error } = await query.order("updated_at", { ascending: false }).range(from, to);

  return (
    <div className="stack">
      <PageHeader
        icon={FileText}
        title="Proposals"
        action={
          canCreate ? (
            <Link href="/proposals/new" className="button-primary">
              + New proposal
            </Link>
          ) : null
        }
      />

      <SearchForm placeholder="Search by title…" defaultValue={q ?? ""} />

      <nav className="tenant-form" aria-label="Filter by status">
        <Link href="/proposals" className={view === "active" ? "button-primary" : "button-secondary"}>
          Active
        </Link>
        <Link href="/proposals?view=archived" className={view === "archived" ? "button-primary" : "button-secondary"}>
          Archived
        </Link>
        <Link href="/proposals?view=all" className={view === "all" ? "button-primary" : "button-secondary"}>
          All
        </Link>
      </nav>

      {error ? <p className="error-banner">We couldn&apos;t load this page right now. Please try refreshing.</p> : null}

      {!proposals || proposals.length === 0 ? (
        <div className="section-card">
          {q ? (
            <EmptyState icon={FileText} title="No matches" description="No proposals match your search. Try a different title." />
          ) : view === "archived" ? (
            <EmptyState icon={Archive} title="No archived proposals" description="Proposals you delete show up here — you can restore them any time." />
          ) : (
            <EmptyState
              icon={FileText}
              title="No proposals yet"
              description="Create your first proposal to describe the job, calculate labor, showcase previous work, and present a professional price to your customer."
              action={
                canCreate ? (
                  <Link href="/proposals/new" className="button-primary">
                    Create proposal
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
                <th>Number</th>
                <th>Title</th>
                <th>Client</th>
                <th>Total</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map((p) => {
                const version = Array.isArray(p.proposal_versions) ? p.proposal_versions[0] : p.proposal_versions;
                return (
                  <tr key={p.id}>
                    <td data-label="Number">#{p.proposal_number}</td>
                    <td data-label="Title">
                      <Link href={`/proposals/${p.id}`}>{p.title}</Link>
                    </td>
                    <td data-label="Client">{p.clients?.display_name ?? "—"}</td>
                    <td data-label="Total">{version ? formatCents(version.total_cents) : "—"}</td>
                    <td data-label="Status">
                      <span className={`badge ${proposalBadgeClass(p.status)}`.trim()}>{formatLabel(p.status)}</span>
                    </td>
                    <td data-label="Updated">{new Date(p.updated_at).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pageSize={DEFAULT_PAGE_SIZE} totalCount={count ?? 0} searchParams={{ q, view: rawView, status }} />
    </div>
  );
}
