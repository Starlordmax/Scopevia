import Link from "next/link";
import { Briefcase, Archive } from "lucide-react";
import { requireActiveTenant } from "../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../lib/auth/permissions";
import { createClient } from "../../../lib/supabase/server";
import { containsPattern, rangeFor, DEFAULT_PAGE_SIZE } from "../../../lib/search";
import { SearchForm } from "../../../components/search-form";
import { Pagination } from "../../../components/pagination";
import { PageHeader } from "../../../components/page-header";
import { EmptyState } from "../../../components/empty-state";
import { projectBadgeClass } from "../../../lib/crm/status-badge";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; archived?: string }>;
}) {
  const { tenant } = await requireActiveTenant();
  const canView = await hasPermission(tenant.tenant_id, PERMISSIONS.PROJECTS_VIEW);
  if (!canView) {
    return (
      <div className="stack">
        <h1>Projects</h1>
        <p className="hint">Your current role ({tenant.role_name}) does not include access to this page.</p>
      </div>
    );
  }

  const canCreate = await hasPermission(tenant.tenant_id, PERMISSIONS.PROJECTS_CREATE);

  const { q, page: pageRaw, archived } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? "1", 10) || 1);
  const showArchived = archived === "1";
  const [from, to] = rangeFor(page, DEFAULT_PAGE_SIZE);

  const supabase = await createClient();
  let query = supabase
    .from("projects")
    .select("id, name, status, clients(display_name)", { count: "exact" })
    .eq("tenant_id", tenant.tenant_id);

  query = showArchived ? query.eq("status", "archived") : query.neq("status", "archived");
  if (q) query = query.ilike("name", containsPattern(q));

  const { data: projects, count, error } = await query.order("created_at", { ascending: false }).range(from, to);

  return (
    <div className="stack">
      <PageHeader
        icon={Briefcase}
        title="Projects"
        action={
          canCreate ? (
            <Link href="/projects/new" className="button-primary">
              + New project
            </Link>
          ) : null
        }
      />

      <SearchForm placeholder="Search by project name…" defaultValue={q ?? ""} />

      <div className="hint">
        <Link href={showArchived ? "/projects" : "/projects?archived=1"}>
          {showArchived ? "← Back to active projects" : "View archived projects"}
        </Link>
      </div>

      {error ? <p className="error-banner">{error.message}</p> : null}

      {!projects || projects.length === 0 ? (
        <div className="section-card">
          {q ? (
            <EmptyState icon={Briefcase} title="No matches" description="No projects match your search. Try a different project name." />
          ) : showArchived ? (
            <EmptyState icon={Archive} title="No archived projects" description="Projects you archive after cancelling or finishing the scoping work will show up here." />
          ) : (
            <EmptyState
              icon={Briefcase}
              title="No projects yet"
              description="A project is the actual work at a client's site — created directly, or converted from a qualified opportunity once it's ready for an estimate."
              action={
                canCreate ? (
                  <Link href="/projects/new" className="button-primary">
                    + New project
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
                <th>Name</th>
                <th>Client</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td data-label="Name">
                    <Link href={`/projects/${p.id}`}>{p.name}</Link>
                  </td>
                  <td data-label="Client">{p.clients?.display_name ?? "—"}</td>
                  <td data-label="Status">
                    <span className={`badge ${projectBadgeClass(p.status)}`.trim()}>{p.status.replace(/_/g, " ")}</span>
                  </td>
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
