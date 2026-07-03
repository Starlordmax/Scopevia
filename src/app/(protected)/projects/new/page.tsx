import { redirect } from "next/navigation";
import { requireActiveTenant } from "../../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../../lib/auth/permissions";
import { getClientOptions } from "../../../../lib/crm/client-options";
import { getAssignableMembers } from "../../../../lib/crm/assignable-members";
import { ProjectForm } from "../project-form";

export const dynamic = "force-dynamic";

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ clientId?: string }> }) {
  const { tenant } = await requireActiveTenant();
  const canCreate = await hasPermission(tenant.tenant_id, PERMISSIONS.PROJECTS_CREATE);
  if (!canCreate) redirect("/projects");

  const { clientId } = await searchParams;
  const [clients, members] = await Promise.all([
    getClientOptions(tenant.tenant_id),
    getAssignableMembers(tenant.tenant_id),
  ]);

  return (
    <div className="stack">
      <h1>New project</h1>
      <div className="form-card">
        <ProjectForm tenantId={tenant.tenant_id} clients={clients} members={members} contacts={[]} defaultClientId={clientId} />
      </div>
    </div>
  );
}
