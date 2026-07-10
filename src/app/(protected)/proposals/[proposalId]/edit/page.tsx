import { notFound, redirect } from "next/navigation";
import { requireActiveTenant } from "../../../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../../../lib/auth/permissions";
import { getFullProposal } from "../../../../../lib/proposals/data";
import { getPortfolioMediaOptions } from "../../../../../lib/proposals/portfolio-options";
import { searchMaterialCatalog } from "../../../../../lib/proposals/materials";
import { createClient } from "../../../../../lib/supabase/server";
import { PageHeader } from "../../../../../components/page-header";
import { FileEdit } from "lucide-react";
import { StepperNav, BUILDER_STEPS, type BuilderStep } from "./stepper-nav";
import { StepMeasurements } from "./step-measurements";
import { StepScope } from "./step-scope";
import { StepLabor } from "./step-labor";
import { StepMaterials } from "./step-materials";
import { StepPhotos } from "./step-photos";
import { StepPricing } from "./step-pricing";
import { StepReview } from "./step-review";

export const dynamic = "force-dynamic";

export default async function ProposalEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ proposalId: string }>;
  searchParams: Promise<{ step?: string; catalogSearch?: string; catalogCategory?: string }>;
}) {
  const { tenant } = await requireActiveTenant();
  const canView = await hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSALS_VIEW);
  if (!canView) redirect("/proposals");

  const { proposalId } = await params;
  const data = await getFullProposal(tenant.tenant_id, proposalId);
  if (!data) notFound();

  const { step: rawStep, catalogSearch, catalogCategory } = await searchParams;
  const step = (BUILDER_STEPS.find((s) => s.key === rawStep)?.key ?? "scope") as BuilderStep;

  const [
    canUpdate,
    canManagePricing,
    canUploadMedia,
    canViewPortfolio,
    canMarkReady,
    canViewMaterials,
    canViewMeasurements,
    canCreateMeasurements,
    canArchiveMeasurements,
    canGenerateFromMeasurements,
  ] = await Promise.all([
    hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSALS_UPDATE),
    hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSALS_MANAGE_PRICING),
    hasPermission(tenant.tenant_id, PERMISSIONS.MEDIA_UPLOAD),
    hasPermission(tenant.tenant_id, PERMISSIONS.PORTFOLIO_VIEW),
    hasPermission(tenant.tenant_id, PERMISSIONS.PROPOSALS_MARK_READY),
    hasPermission(tenant.tenant_id, PERMISSIONS.MATERIALS_VIEW),
    hasPermission(tenant.tenant_id, PERMISSIONS.MEASUREMENTS_VIEW),
    hasPermission(tenant.tenant_id, PERMISSIONS.MEASUREMENTS_CREATE),
    hasPermission(tenant.tenant_id, PERMISSIONS.MEASUREMENTS_ARCHIVE),
    hasPermission(tenant.tenant_id, PERMISSIONS.MEASUREMENTS_GENERATE_MATERIALS),
  ]);

  const isDraft = data.version.version_status === "draft" && data.proposal.status === "draft";
  const portfolioOptions = step === "photos" && canViewPortfolio ? await getPortfolioMediaOptions(tenant.tenant_id) : [];

  let defaultHourlyRateCents = 3500;
  if (step === "labor") {
    const supabase = await createClient();
    const { data: settings } = await supabase.rpc("get_tenant_proposal_settings", { p_tenant_id: tenant.tenant_id });
    if (settings) defaultHourlyRateCents = settings.default_customer_hourly_rate_cents;
  }

  const catalogResults =
    (step === "materials" || step === "measurements") && canViewMaterials
      ? await searchMaterialCatalog(tenant.tenant_id, {
          zipCode: data.version.pricing_zip_code,
          searchText: catalogSearch,
          category: catalogCategory,
        })
      : [];

  return (
    <div className="stack">
      <PageHeader
        icon={FileEdit}
        title={data.proposal.title}
        description={`Proposal #${data.proposal.proposal_number} — ${data.proposal.status}`}
      />
      <StepperNav proposalId={proposalId} currentStep={step} />

      {step === "measurements" ? (
        <StepMeasurements
          proposalId={proposalId}
          proposalVersionId={data.version.id}
          pricingZipCode={data.version.pricing_zip_code}
          measurementGroups={data.measurementGroups}
          measurements={data.measurements}
          sections={data.sections}
          isDraft={isDraft}
          canView={canViewMeasurements}
          canCreate={canCreateMeasurements}
          canArchive={canArchiveMeasurements}
          canGenerate={canGenerateFromMeasurements}
          canManagePricing={canManagePricing}
          catalogResults={catalogResults}
          catalogSearch={catalogSearch ?? ""}
          catalogCategory={catalogCategory ?? ""}
        />
      ) : null}
      {step === "scope" ? (
        <StepScope
          proposalId={proposalId}
          version={data.version}
          sections={data.sections}
          serviceType={data.proposal.service_type}
          canEdit={canUpdate && isDraft}
        />
      ) : null}
      {step === "labor" ? (
        <StepLabor
          proposalId={proposalId}
          proposalVersionId={data.version.id}
          laborItems={data.laborItems}
          defaultHourlyRateCents={defaultHourlyRateCents}
          laborTotalCents={data.version.labor_total_cents}
          canEdit={canManagePricing && isDraft}
        />
      ) : null}
      {step === "materials" ? (
        <StepMaterials
          proposalId={proposalId}
          proposalVersionId={data.version.id}
          pricingZipCode={data.version.pricing_zip_code}
          lineItems={data.lineItems}
          sections={data.sections}
          lineItemsSubtotalCents={data.version.line_items_subtotal_cents}
          canViewMaterials={canViewMaterials}
          canAddFromCatalog={canUpdate && isDraft}
          canManagePricing={canManagePricing && isDraft}
          isDraft={isDraft}
          catalogResults={catalogResults}
          catalogSearch={catalogSearch ?? ""}
          catalogCategory={catalogCategory ?? ""}
        />
      ) : null}
      {step === "photos" ? (
        <StepPhotos
          tenantId={tenant.tenant_id}
          proposalId={proposalId}
          proposalVersionId={data.version.id}
          currentJobMedia={data.currentJobMedia}
          previousWorkMedia={data.previousWorkMedia}
          portfolioOptions={portfolioOptions}
          canUploadCurrentJob={canUploadMedia && isDraft}
          canUsePortfolio={canViewPortfolio && isDraft}
        />
      ) : null}
      {step === "pricing" ? <StepPricing proposalId={proposalId} version={data.version} canEdit={canManagePricing && isDraft} /> : null}
      {step === "review" ? (
        <StepReview proposalId={proposalId} businessName={tenant.tenant_name} data={data} canMarkReady={canMarkReady && isDraft} />
      ) : null}
    </div>
  );
}
