import { redirect } from "next/navigation";
import { requireActiveTenant } from "../../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../../lib/auth/permissions";
import { ClientForm } from "../client-form";

export const dynamic = "force-dynamic";

export default async function NewClientPage() {
  const { tenant } = await requireActiveTenant();
  const canCreate = await hasPermission(tenant.tenant_id, PERMISSIONS.CLIENTS_CREATE);
  if (!canCreate) redirect("/clients");

  return (
    <div className="stack">
      <h1>New client</h1>
      <div className="card">
        <ClientForm tenantId={tenant.tenant_id} />
      </div>
    </div>
  );
}
