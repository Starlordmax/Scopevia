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
import { proposalBadgeClass } from "../../../../lib/crm/status-badge";
import { formatCents, formatLabel } from "../../../../lib/proposals/format";
import { formatClientAddress } from "../../../../lib/crm/address";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const { tenant } = await requireActiveTenant();

  const canView = await hasPermission(tenant.tenant_id, PERMISSIONS.CLIENTS_VIEW);
  if (!canView) redirect("/clients");

  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .eq("tenant_id", tenant.tenant_id)
    .single();
  if (!client) notFound();

  const clientAddress = formatClientAddress({
    addressLine1: client.address_line_1,
    addressLine2: client.address_line_2,
    city: client.city,
    state: client.state,
    postalCode: client.postal_code,
    countryCode: client.country_code,
  });

  const [
    canUpdate,
    canArchive,
    canRestore,
    contactsView,
    contactsCreate,
    contactsUpdate,
    contactsArchive,
    contactsRestore,
    proposalsView,
    canCreateProposal,
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
    hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSALS_VIEW),
    hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSALS_CREATE),
    hasPermission(tenant.tenant_id, PERMISSIONS.NOTES_VIEW),
    hasPermission(tenant.tenant_id, PERMISSIONS.NOTES_CREATE),
    hasPermission(tenant.tenant_id, PERMISSIONS.NOTES_UPDATE),
    hasPermission(tenant.tenant_id, PERMISSIONS.NOTES_ARCHIVE),
    hasPermission(tenant.tenant_id, PERMISSIONS.ACTIVITIES_VIEW),
  ]);

  const [contacts, proposals, notes, activity] = await Promise.all([
    contactsView
      ? supabase
          .from("client_contacts")
          .select("*")
          .eq("client_id", clientId)
          .order("is_primary", { ascending: false })
          .order("first_name", { ascending: true })
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
    proposalsView
      ? supabase
          .from("proposals")
          .select("id, proposal_number, title, status, updated_at, proposal_versions!proposals_current_version_id_fkey(total_cents)")
          .eq("client_id", clientId)
          .is("archived_at", null)
          .order("updated_at", { ascending: false })
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
          {canCreateProposal && !client.archived_at ? (
            <Link href={`/proposals/new?clientId=${clientId}`} className="button-primary">
              Create proposal
            </Link>
          ) : null}
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

      <div className="section-card stack">
        <h2>Details</h2>
        <div className="stack" style={{ gap: 4 }}>
          {client.email ? <div>Email: {client.email}</div> : null}
          {client.phone ? <div>Phone: {client.phone}</div> : null}
          {client.secondary_phone ? <div>Secondary phone: {client.secondary_phone}</div> : null}
          {clientAddress ? <div>Address: {clientAddress}</div> : null}
          {client.website ? <div>Website: {client.website}</div> : null}
          {client.source ? <div>Source: {client.source}</div> : null}
          {client.tax_exempt ? <div>Tax exempt</div> : null}
        </div>
      </div>

      {contactsView ? (
        <div className="section-card stack">
          <h2>Contacts</h2>
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

      {proposalsView ? (
        <div className="section-card stack">
          <h2>Proposals</h2>
          {proposals.length === 0 ? (
            <p className="hint">No proposals yet.</p>
          ) : (
            <ul className="stack" style={{ gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
              {proposals.map((p) => {
                const version = Array.isArray(p.proposal_versions) ? p.proposal_versions[0] : p.proposal_versions;
                return (
                  <li key={p.id}>
                    <Link href={`/proposals/${p.id}`}>
                      #{p.proposal_number} · {p.title}
                    </Link>{" "}
                    <span className={`badge ${proposalBadgeClass(p.status)}`.trim()}>{formatLabel(p.status)}</span>{" "}
                    <span className="hint">{version ? formatCents(version.total_cents) : "—"}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {canCreateProposal ? (
            <Link href={`/proposals/new?clientId=${clientId}`} className="hint">
              + New proposal for this client
            </Link>
          ) : null}
        </div>
      ) : null}

      {notesView ? (
        <div className="section-card stack">
          <h2>Notes</h2>
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
        <div className="section-card stack">
          <h2>Activity</h2>
          <ActivityFeed items={activity} />
        </div>
      ) : null}
    </div>
  );
}
