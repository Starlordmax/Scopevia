import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireActiveTenant } from "../../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../../lib/auth/permissions";
import { createClient } from "../../../../lib/supabase/server";
import { getSignedMediaUrls } from "../../../../lib/storage/media";
import { PageHeader } from "../../../../components/page-header";
import { archivePortfolioProjectAction, restorePortfolioProjectAction } from "../../../../actions/portfolio";
import { UploadPhotoForm } from "./upload-photo-form";

export const dynamic = "force-dynamic";

export default async function PortfolioProjectDetailPage({ params }: { params: Promise<{ portfolioId: string }> }) {
  const { tenant } = await requireActiveTenant();
  const canView = await hasPermission(tenant.tenant_id, PERMISSIONS.PORTFOLIO_VIEW);
  if (!canView) redirect("/portfolio");

  const { portfolioId } = await params;
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("portfolio_projects")
    .select("*")
    .eq("id", portfolioId)
    .eq("tenant_id", tenant.tenant_id)
    .single();
  if (!project) notFound();

  const { data: media } = await supabase
    .from("portfolio_project_media")
    .select("id, caption, media_assets(storage_path)")
    .eq("portfolio_project_id", portfolioId)
    .order("sort_order", { ascending: true });

  const paths = (media ?? []).map((m) => m.media_assets?.storage_path).filter((p): p is string => Boolean(p));
  const signedUrls = await getSignedMediaUrls(paths);

  const [canUpdate, canArchive, canRestore] = await Promise.all([
    hasPermission(tenant.tenant_id, PERMISSIONS.PORTFOLIO_UPDATE),
    hasPermission(tenant.tenant_id, PERMISSIONS.PORTFOLIO_ARCHIVE),
    hasPermission(tenant.tenant_id, PERMISSIONS.PORTFOLIO_RESTORE),
  ]);

  return (
    <div className="stack">
      <PageHeader
        title={project.title}
        description={project.location_label || undefined}
        action={
          canUpdate && !project.archived_at ? (
            <Link href={`/portfolio/${portfolioId}/edit`} className="button-primary">
              Edit
            </Link>
          ) : null
        }
      />

      <div className="section-card stack">
        {project.description ? <p>{project.description}</p> : null}

        {!media || media.length === 0 ? (
          <p className="hint">No photos yet.</p>
        ) : (
          <div className="metrics-grid">
            {media.map((m) => {
              const path = m.media_assets?.storage_path;
              const url = path ? signedUrls[path] : undefined;
              return (
                <figure key={m.id} className="card" style={{ maxWidth: "none" }}>
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed URL, short-lived, per-request
                    <img src={url} alt={m.caption || project.title} style={{ width: "100%", borderRadius: 8 }} />
                  ) : (
                    <div className="hint">Photo unavailable</div>
                  )}
                  {m.caption ? <figcaption className="hint">{m.caption}</figcaption> : null}
                </figure>
              );
            })}
          </div>
        )}

        {canUpdate && !project.archived_at ? <UploadPhotoForm tenantId={tenant.tenant_id} portfolioProjectId={portfolioId} /> : null}
      </div>

      <div className="tenant-form">
        {!project.archived_at && canArchive ? (
          <form action={archivePortfolioProjectAction}>
            <input type="hidden" name="portfolioProjectId" value={portfolioId} />
            <button type="submit" className="button-danger">
              Archive
            </button>
          </form>
        ) : null}
        {project.archived_at && canRestore ? (
          <form action={restorePortfolioProjectAction}>
            <input type="hidden" name="portfolioProjectId" value={portfolioId} />
            <button type="submit" className="button-secondary">
              Restore
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
