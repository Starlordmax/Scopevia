import { notFound, redirect } from "next/navigation";
import { requireActiveTenant } from "../../../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../../../lib/auth/permissions";
import { createClient } from "../../../../../lib/supabase/server";
import { PortfolioForm } from "../../portfolio-form";

export const dynamic = "force-dynamic";

export default async function EditPortfolioProjectPage({ params }: { params: Promise<{ portfolioId: string }> }) {
  const { tenant } = await requireActiveTenant();
  const canUpdate = await hasPermission(tenant.tenant_id, PERMISSIONS.PORTFOLIO_UPDATE);
  if (!canUpdate) redirect("/portfolio");

  const { portfolioId } = await params;
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("portfolio_projects")
    .select("*")
    .eq("id", portfolioId)
    .eq("tenant_id", tenant.tenant_id)
    .single();
  if (!project) notFound();

  return (
    <div className="stack">
      <h1>Edit portfolio item</h1>
      <div className="form-card">
        <PortfolioForm tenantId={tenant.tenant_id} project={project} />
      </div>
    </div>
  );
}
