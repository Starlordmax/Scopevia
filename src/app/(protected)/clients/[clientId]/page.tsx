import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireActiveTenant } from "../../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../../lib/auth/permissions";
import { createClient } from "../../../../lib/supabase/server";
import { getActivityFeed } from "../../../../lib/crm/activity-feed-data";
import { getNotes } from "../../../../lib/crm/notes-data";
import { ActivityFeed } from "../../../../components/activity-feed";
import { NotesSection } from "../../../../components/notes-section";
import { ContactsSection } from "./contacts-section";
import { archiveClientAction, restoreClientAction } from "../../../../actions/clients";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const { tenant } = await requireActiveTenant();

  const canView = await hasPermission(tenant.tenant_id, PERMISSIONS.CLIENTS_VIEW);
  if (!canView) redirect("/clients");

  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("*").eq("id", clientId).single();
  if (!client) notFound();

  const [
    canUpdate,
    canArchive,
    canRestore,
    contactsView,
    contactsCreate,
    contactsUpdate,
    contactsArchive,
    contactsRestore,
    opportunitiesView,
    projectsView,
    notesView,
    notesCreate,
    notesUpdate,
    notesArchive,
    activitiesView,
  ] = await Promise.all([
    hasPermission(tenant.tenant_id, PERMISSIONS.CLIENTS_UPDATE),
    hasPermission(tenant.tenant_id, PERMISSIONS.CLIENTS_ARCHIVE),
    hasPermission(tenant.tenant_id, PERMISSIONS.CLIENTS_RESTORE),
    hasPermission(tenant.tenant_id, PERMISSIONS.CONTACTS_VIEW),
    hasPermission(tenant.tenant_id, PERMISSIONS.CONTACTS_CREATE),
    hasPermission(tenant.tenant_id, PERMISSIONS.CONTACTS_UPDATE),
    hasPermission(tenant.tenant_id, PERMISSIONS.CONTACTS_ARCHIVE),
    hasPermission(tenant.tenant_id, PERMISSIONS.CONTACTS_RESTORE),
    hasPermission(tenant.tenant_id, PERMISSIONS.OPPORTUNITIES_VIEW),
    hasPermission(tenant.tenant_id, PERMISSIONS.PROJECTS_VIEW),
    hasPermission(tenant.tenant_id, PERMISSIONS.NOTES_VIEW),
    hasPermission(tenant.tenant_id, PERMISSIONS.NOTES_CREATE),
    hasPermission(tenant.tenant_id, PERMISSIONS.NOTES_UPDATE),
    hasPermission(tenant.tenant_id, PERMISSIONS.NOTES_ARCHIVE),
    hasPermission(tenant.tenant_id, PERMISSIONS.ACTIVITIES_VIEW),
  ]);

  const [contacts, opportunities, projects, notes, activity] = await Promise.all([
    contactsView
      ? supabase
          .from("client_contacts")
          .select("*")
          .eq("client_id", clientId)
          .order("is_primary", { ascending: false })
          .order("first_name", { ascending: true })
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
    opportunitiesView
      ? supabase
          .from("opportunities")
          .select("id, title, status, estimated_value_cents")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(10)
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
    projectsView
      ? supabase
          .from("projects")
          .select("id, name, status")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(10)
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
    notesView ? getNotes({ clientId }) : Promise.resolve([]),
    activitiesView ? getActivityFeed({ clientId }) : Promise.resolve([]),
  ]);

  return (
    <div className="stack">
      <div className="tenant-form" style={{ justifyContent: "space-between", width: "100%" }}>
        <div>
          <h1>
            {client.display_name} {client.archived_at ? <span className="badge">Archived</span> : null}
          </h1>
          <span className="hint">{client.client_type}</span>
        </div>
        <div className="tenant-form">
          {canUpdate && !client.archived_at ? (
            <Link href={`/clients/${clientId}/edit`} className="button-secondary">
              Edit
            </Link>
          ) : null}
          {canArchive && !client.archived_at ? (
            <form action={archiveClientAction}>
              <input type="hidden" name="clientId" value={clientId} />
              <button type="submit" className="button-danger" formNoValidate>
                Archive
              </button>
            </form>
          ) : null}
          {canRestore && client.archived_at ? (
            <form action={restoreClientAction}>
              <input type="hidden" name="clientId" value={clientId} />
              <button type="submit" className="button-secondary">
                Restore
              </button>
            </form>
          ) : null}
        </div>
      </div>

      <div className="card stack">
        <h2 style={{ fontSize: "1rem" }}>Details</h2>
        <div className="stack" style={{ gap: 4 }}>
          {client.email ? <div>Email: {client.email}</div> : null}
          {client.phone ? <div>Phone: {client.phone}</div> : null}
          {client.secondary_phone ? <div>Secondary phone: {client.secondary_phone}</div> : null}
          {client.website ? <div>Website: {client.website}</div> : null}
          {client.source ? <div>Source: {client.source}</div> : null}
          {client.tax_exempt ? <div>Tax exempt</div> : null}
        </div>
      </div>

      {contactsView ? (
        <div className="card stack">
          <h2 style={{ fontSize: "1rem" }}>Contacts</h2>
          <ContactsSection
            clientId={clientId}
            contacts={contacts}
            canCreate={contactsCreate}
            canUpdate={contactsUpdate}
            canArchive={contactsArchive}
            canRestore={contactsRestore}
          />
        </div>
      ) : null}

      {opportunitiesView ? (
        <div className="card stack">
          <h2 style={{ fontSize: "1rem" }}>Opportunities</h2>
          {opportunities.length === 0 ? (
            <p className="hint">No opportunities yet.</p>
          ) : (
            <ul className="stack" style={{ gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
              {opportunities.map((o) => (
                <li key={o.id}>
                  <Link href={`/opportunities/${o.id}`}>{o.title}</Link> <span className="badge">{o.status}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href={`/opportunities/new?clientId=${clientId}`} className="hint">
            + New opportunity for this client
          </Link>
        </div>
      ) : null}

      {projectsView ? (
        <div className="card stack">
          <h2 style={{ fontSize: "1rem" }}>Projects</h2>
          {projects.length === 0 ? (
            <p className="hint">No projects yet.</p>
          ) : (
            <ul className="stack" style={{ gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
              {projects.map((p) => (
                <li key={p.id}>
                  <Link href={`/projects/${p.id}`}>{p.name}</Link> <span className="badge">{p.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {notesView ? (
        <div className="card stack">
          <h2 style={{ fontSize: "1rem" }}>Notes</h2>
          <NotesSection
            tenantId={tenant.tenant_id}
            clientId={clientId}
            notes={notes}
            canCreate={notesCreate}
            canUpdate={notesUpdate}
            canArchive={notesArchive}
          />
        </div>
      ) : null}

      {activitiesView ? (
        <div className="card stack">
          <h2 style={{ fontSize: "1rem" }}>Activity</h2>
          <ActivityFeed items={activity} />
        </div>
      ) : null}
    </div>
  );
}
