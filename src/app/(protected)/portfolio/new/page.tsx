import { redirect } from "next/navigation";
import { requireActiveTenant } from "../../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../../lib/auth/permissions";
import { PortfolioForm } from "../portfolio-form";

export const dynamic = "force-dynamic";

export default async function NewPortfolioProjectPage() {
  const { tenant } = await requireActiveTenant();
  const canCreate = await hasPermission(tenant.tenant_id, PERMISSIONS.PORTFOLIO_CREATE);
  if (!canCreate) redirect("/portfolio");

  return (
    <div className="stack">
      <h1>New portfolio item</h1>
      <div className="form-card">
        <PortfolioForm tenantId={tenant.tenant_id} />
      </div>
    </div>
  );
}
