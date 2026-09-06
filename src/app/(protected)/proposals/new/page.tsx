import { redirect } from "next/navigation";
import { requireActiveTenant } from "../../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../../lib/auth/permissions";
import { getClientOptions } from "../../../../lib/crm/client-options";
import { getContactOptions } from "../../../../lib/crm/contact-options";
import { getOpenOpportunityOptions } from "../../../../lib/crm/opportunity-options";
import { PageHeader } from "../../../../components/page-header";
import { FilePlus2 } from "lucide-react";
import { NewProposalForm } from "./new-proposal-form";

export const dynamic = "force-dynamic";

export default async function NewProposalPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; opportunityId?: string }>;
}) {
  const { tenant } = await requireActiveTenant();
  const canCreate = await hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSALS_CREATE);
  if (!canCreate) redirect("/proposals");

  const { clientId, opportunityId } = await searchParams;
  const [clients, opportunities, contacts] = await Promise.all([
    getClientOptions(tenant.tenant_id),
    getOpenOpportunityOptions(tenant.tenant_id, clientId),
    clientId ? getContactOptions(tenant.tenant_id, clientId) : Promise.resolve([]),
  ]);

  return (
    <div className="stack">
      <PageHeader icon={FilePlus2} title="New proposal" description="Step 1 of 7 — Client & Job" />
      <div className="form-card">
        <NewProposalForm
          tenantId={tenant.tenant_id}
          clients={clients}
          opportunities={opportunities}
          contacts={contacts}
          defaultClientId={clientId}
          defaultOpportunityId={opportunityId}
        />
      </div>
    </div>
  );
}
