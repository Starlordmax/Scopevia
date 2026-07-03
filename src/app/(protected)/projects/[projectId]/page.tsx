import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireActiveTenant } from "../../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../../lib/auth/permissions";
import { createClient } from "../../../../lib/supabase/server";
import { getActivityFeed } from "../../../../lib/crm/activity-feed-data";
import { getNotes } from "../../../../lib/crm/notes-data";
import { ActivityFeed } from "../../../../components/activity-feed";
import { NotesSection } from "../../../../components/notes-section";
import { ProjectStatusActions } from "./status-actions";
import { AddressesSection } from "./addresses-section";
import { archiveProjectAction, restoreProjectAction } from "../../../../actions/projects";
import { projectBadgeClass } from "../../../../lib/crm/status-badge";
import type { ProjectStatus } from "../../../../../types/enums";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { tenant } = await requireActiveTenant();

  const canView = await hasPermission(tenant.tenant_id, PERMISSIONS.PROJECTS_VIEW);
  if (!canView) redirect("/projects");

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("*, clients(id, display_name), opportunities(id, title)")
    .eq("id", projectId)
    .eq("tenant_id", tenant.tenant_id)
    .single();
  if (!project) notFound();

  const [canUpdate, canArchive, canRestore, notesView, notesCreate, notesUpdate, notesArchive, activitiesView] = await Promise.all([
    hasPermission(tenant.tenant_id, PERMISSIONS.PROJECTS_UPDATE),
    hasPermission(tenant.tenant_id, PERMISSIONS.PROJECTS_ARCHIVE),
    hasPermission(tenant.tenant_id, PERMISSIONS.PROJECTS_RESTORE),
    hasPermission(tenant.tenant_id, PERMISSIONS.NOTES_VIEW),
    hasPermission(tenant.tenant_id, PERMISSIONS.NOTES_CREATE),
    hasPermission(tenant.tenant_id, PERMISSIONS.NOTES_UPDATE),
    hasPermission(tenant.tenant_id, PERMISSIONS.NOTES_ARCHIVE),
    hasPermission(tenant.tenant_id, PERMISSIONS.ACTIVITIES_VIEW),
  ]);

  const [addresses, notes, activity] = await Promise.all([
    supabase
      .from("project_addresses")
      .select("*")
      .eq("project_id", projectId)
      .order("is_primary", { ascending: false })
      .then((r) => r.data ?? []),
    notesView ? getNotes({ projectId }) : Promise.resolve([]),
    activitiesView ? getActivityFeed({ projectId }) : Promise.resolve([]),
  ]);

  const isArchived = project.status === "archived";
  const canBeArchived = project.status === "cancelled" || project.status === "ready_for_estimate";

  return (
    <div className="stack">
      <div className="tenant-form" style={{ justifyContent: "space-between", width: "100%" }}>
        <div>
          <h1>{project.name}</h1>
          <span className="hint">{project.clients ? <Link href={`/clients/${project.clients.id}`}>{project.clients.display_name}</Link> : "—"}</span>
        </div>
        <span className={`badge ${projectBadgeClass(project.status)}`.trim()}>{project.status.replace(/_/g, " ")}</span>
      </div>

      <div className="section-card stack">
        {project.service_type ? <div>Service type: {project.service_type}</div> : null}
        {project.description ? <div>{project.description}</div> : null}
        {project.tentative_start_date ? <div>Tentative start: {project.tentative_start_date}</div> : null}
        {project.inspection_scheduled_at ? <div>Inspection: {new Date(project.inspection_scheduled_at).toLocaleString()}</div> : null}
        {project.opportunities ? (
          <div>
            From opportunity: <Link href={`/opportunities/${project.opportunities.id}`}>{project.opportunities.title}</Link>
          </div>
        ) : null}
      </div>

      {canUpdate && !isArchived ? (
        <div className="tenant-form">
          <Link href={`/projects/${projectId}/edit`} className="button-secondary">
            Edit
          </Link>
        </div>
      ) : null}

      {canUpdate && !isArchived ? (
        <div className="section-card">
          <ProjectStatusActions projectId={projectId} status={project.status as ProjectStatus} />
        </div>
      ) : null}

      <div className="tenant-form">
        {canArchive && canBeArchived && !isArchived ? (
          <form action={archiveProjectAction}>
            <input type="hidden" name="projectId" value={projectId} />
            <button type="submit" className="button-danger">
              Archive
            </button>
          </form>
        ) : null}
        {canRestore && isArchived ? (
          <form action={restoreProjectAction}>
            <input type="hidden" name="projectId" value={projectId} />
            <button type="submit" className="button-secondary">
              Restore
            </button>
          </form>
        ) : null}
      </div>

      <div className="section-card stack">
        <h2>Work-site address</h2>
        <AddressesSection projectId={projectId} addresses={addresses} canUpdate={canUpdate && !isArchived} />
      </div>

      {notesView ? (
        <div className="section-card stack">
          <h2>Notes</h2>
          <NotesSection
            tenantId={tenant.tenant_id}
            projectId={projectId}
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
