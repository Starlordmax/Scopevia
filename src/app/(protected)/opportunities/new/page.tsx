import { redirect } from "next/navigation";
import { requireActiveTenant } from "../../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../../lib/auth/permissions";
import { getClientOptions } from "../../../../lib/crm/client-options";
import { getAssignableMembers } from "../../../../lib/crm/assignable-members";
import { OpportunityForm } from "../opportunity-form";

export const dynamic = "force-dynamic";

export default async function NewOpportunityPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>;
}) {
  const { tenant } = await requireActiveTenant();
  const canCreate = await hasPermission(tenant.tenant_id, PERMISSIONS.OPPORTUNITIES_CREATE);
  if (!canCreate) redirect("/opportunities");

  const { clientId } = await searchParams;
  const [clients, members] = await Promise.all([
    getClientOptions(tenant.tenant_id),
    getAssignableMembers(tenant.tenant_id),
  ]);

  return (
    <div className="stack">
      <h1>New opportunity</h1>
      <div className="form-card">
        <OpportunityForm tenantId={tenant.tenant_id} clients={clients} members={members} defaultClientId={clientId} />
      </div>
    </div>
  );
}
