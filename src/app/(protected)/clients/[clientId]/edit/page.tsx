import { notFound, redirect } from "next/navigation";
import { requireActiveTenant } from "../../../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../../../lib/auth/permissions";
import { createClient } from "../../../../../lib/supabase/server";
import { ClientForm } from "../../client-form";

export const dynamic = "force-dynamic";

export default async function EditClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const { tenant } = await requireActiveTenant();

  const canUpdate = await hasPermission(tenant.tenant_id, PERMISSIONS.CLIENTS_UPDATE);
  if (!canUpdate) redirect(`/clients/${clientId}`);

  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("*").eq("id", clientId).single();
  if (!client) notFound();

  return (
    <div className="stack">
      <h1>Edit client</h1>
      <div className="card">
        <ClientForm tenantId={tenant.tenant_id} client={client} />
      </div>
    </div>
  );
}
