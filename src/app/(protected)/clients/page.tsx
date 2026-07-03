import Link from "next/link";
import { Users, Archive } from "lucide-react";
import { requireActiveTenant } from "../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../lib/auth/permissions";
import { createClient } from "../../../lib/supabase/server";
import { containsPattern, rangeFor, DEFAULT_PAGE_SIZE } from "../../../lib/search";
import { SearchForm } from "../../../components/search-form";
import { Pagination } from "../../../components/pagination";
import { PageHeader } from "../../../components/page-header";
import { EmptyState } from "../../../components/empty-state";

export const dynamic = "force-dynamic";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; archived?: string }>;
}) {
  const { tenant } = await requireActiveTenant();
  const canView = await hasPermission(tenant.tenant_id, PERMISSIONS.CLIENTS_VIEW);
  if (!canView) {
    return (
      <div className="stack">
        <h1>Clients</h1>
        <p className="hint">Your current role ({tenant.role_name}) does not include access to this page.</p>
      </div>
    );
  }

  const canCreate = await hasPermission(tenant.tenant_id, PERMISSIONS.CLIENTS_CREATE);

  const { q, page: pageRaw, archived } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? "1", 10) || 1);
  const showArchived = archived === "1";
  const [from, to] = rangeFor(page, DEFAULT_PAGE_SIZE);

  const supabase = await createClient();
  let query = supabase
    .from("clients")
    .select("id, client_type, display_name, email, phone, archived_at", { count: "exact" })
    .eq("tenant_id", tenant.tenant_id);

  query = showArchived ? query.not("archived_at", "is", null) : query.is("archived_at", null);

  if (q) {
    const p = containsPattern(q);
    query = query.or(
      `display_name.ilike.${p},legal_name.ilike.${p},first_name.ilike.${p},last_name.ilike.${p},email.ilike.${p},phone.ilike.${p}`
    );
  }

  const { data: clients, count, error } = await query.order("display_name", { ascending: true }).range(from, to);

  return (
    <div className="stack">
      <PageHeader
        icon={Users}
        title="Clients"
        action={
          canCreate ? (
            <Link href="/clients/new" className="button-primary">
              + New client
            </Link>
          ) : null
        }
      />

      <SearchForm placeholder="Search by name, email, phone…" defaultValue={q ?? ""} />

      <div className="hint">
        <Link href={showArchived ? "/clients" : "/clients?archived=1"}>
          {showArchived ? "← Back to active clients" : "View archived clients"}
        </Link>
      </div>

      {error ? <p className="error-banner">{error.message}</p> : null}

      {!clients || clients.length === 0 ? (
        <div className="section-card">
          {q ? (
            <EmptyState icon={Users} title="No matches" description="No clients match your search. Try a different name, email, or phone number." />
          ) : showArchived ? (
            <EmptyState icon={Archive} title="No archived clients" description="Clients you archive will show up here, so you can restore them later if needed." />
          ) : (
            <EmptyState
              icon={Users}
              title="No clients yet"
              description="Clients are the people or businesses you do work for. Add your first client to start tracking opportunities and projects for them."
              action={
                canCreate ? (
                  <Link href="/clients/new" className="button-primary">
                    + New client
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
                <th>Type</th>
                <th>Email</th>
                <th>Phone</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td data-label="Name">
                    <Link href={`/clients/${c.id}`}>{c.display_name}</Link>
                    {c.archived_at ? <span className="badge"> Archived</span> : null}
                  </td>
                  <td data-label="Type">{c.client_type}</td>
                  <td data-label="Email">{c.email || "—"}</td>
                  <td data-label="Phone">{c.phone || "—"}</td>
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
