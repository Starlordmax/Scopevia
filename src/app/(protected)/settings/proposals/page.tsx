import { redirect } from "next/navigation";
import { Settings2 } from "lucide-react";
import { requireActiveTenant } from "../../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../../lib/auth/permissions";
import { createClient } from "../../../../lib/supabase/server";
import { PageHeader } from "../../../../components/page-header";
import { ProposalSettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function ProposalSettingsPage() {
  const { tenant } = await requireActiveTenant();
  const canView = await hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSAL_SETTINGS_VIEW);
  if (!canView) redirect("/proposals");

  const canUpdate = await hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSAL_SETTINGS_UPDATE);

  const supabase = await createClient();
  const { data: settings } = await supabase.rpc("get_tenant_proposal_settings", { p_tenant_id: tenant.tenant_id });

  if (!settings) {
    return (
      <div className="stack">
        <PageHeader icon={Settings2} title="Proposal Settings" />
        <p className="error-banner">Could not load proposal settings.</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHeader icon={Settings2} title="Proposal Settings" description="Defaults applied to every new proposal." />
      <div className="form-card">
        {canUpdate ? (
          <ProposalSettingsForm tenantId={tenant.tenant_id} settings={settings} />
        ) : (
          <p className="hint">Your current role ({tenant.role_name}) can view but not change these settings.</p>
        )}
      </div>
    </div>
  );
}
