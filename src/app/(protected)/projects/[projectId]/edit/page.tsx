import { notFound, redirect } from "next/navigation";
import { requireActiveTenant } from "../../../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../../../lib/auth/permissions";
import { createClient } from "../../../../../lib/supabase/server";
import { getAssignableMembers } from "../../../../../lib/crm/assignable-members";
import { ProjectForm } from "../../project-form";

export const dynamic = "force-dynamic";

export default async function EditProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { tenant } = await requireActiveTenant();

  const canUpdate = await hasPermission(tenant.tenant_id, PERMISSIONS.PROJECTS_UPDATE);
  if (!canUpdate) redirect(`/projects/${projectId}`);

  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("*").eq("id", projectId).single();
  if (!project) notFound();

  const [members, { data: contactRows }] = await Promise.all([
    getAssignableMembers(tenant.tenant_id),
    supabase
      .from("client_contacts")
      .select("id, first_name, last_name")
      .eq("client_id", project.client_id)
      .is("archived_at", null),
  ]);

  const contacts = (contactRows ?? []).map((c) => ({ id: c.id, name: `${c.first_name} ${c.last_name ?? ""}`.trim() }));

  return (
    <div className="stack">
      <h1>Edit project</h1>
      <div className="card">
        <ProjectForm tenantId={tenant.tenant_id} clients={[]} members={members} contacts={contacts} project={project} />
      </div>
    </div>
  );
}
