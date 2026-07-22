"use client";

import { useActionState } from "react";
import Link from "next/link";
import { uploadCurrentJobPhotoAction } from "../../../../../actions/media";
import { attachPortfolioMediaToProposalAction, detachProposalMediaAction } from "../../../../../actions/media";
import type { ActionResult } from "../../../../../actions/auth";
import { SubmitButton } from "../../../../../components/submit-button";
import type { ProposalMediaWithUrl } from "../../../../../lib/proposals/data";
import type { PortfolioOption } from "../../../../../lib/proposals/portfolio-options";

const initialState: ActionResult = {};

export function StepPhotos({
  tenantId,
  proposalId,
  proposalVersionId,
  currentJobMedia,
  previousWorkMedia,
  portfolioOptions,
  canUploadCurrentJob,
  canUsePortfolio,
}: {
  tenantId: string;
  proposalId: string;
  proposalVersionId: string;
  currentJobMedia: ProposalMediaWithUrl[];
  previousWorkMedia: ProposalMediaWithUrl[];
  portfolioOptions: PortfolioOption[];
  canUploadCurrentJob: boolean;
  canUsePortfolio: boolean;
}) {
  const [uploadState, uploadAction] = useActionState(uploadCurrentJobPhotoAction, initialState);
  const attachedAssetIds = new Set(previousWorkMedia.map((m) => m.media_asset_id));

  return (
    <div className="stack">
      <div className="section-card stack">
        <h2>Current job photos</h2>
        <p className="hint">Photos of this specific job — before, during, or after the work.</p>
        {currentJobMedia.length === 0 ? (
          <p className="hint">No photos of the current job yet.</p>
        ) : (
          <div className="photo-grid">
            {currentJobMedia.map((m) => (
              <figure key={m.id} className="photo-card">
                {m.signedUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived and per-request; next/image's remote-pattern allowlist isn't a good fit here.
                  <img src={m.signedUrl} alt={m.caption || "Current job photo"} className="photo-thumb" />
                ) : (
                  <div className="hint">Photo unavailable</div>
                )}
                {m.caption ? <figcaption className="photo-card-caption">{m.caption}</figcaption> : null}
                {canUploadCurrentJob ? (
                  <form action={detachProposalMediaAction} className="photo-card-actions">
                    <input type="hidden" name="proposalMediaId" value={m.id} />
                    <input type="hidden" name="proposalId" value={proposalId} />
                    <SubmitButton pendingText="Removing…" className="button-secondary">
                      Remove
                    </SubmitButton>
                  </form>
                ) : null}
              </figure>
            ))}
          </div>
        )}

        {canUploadCurrentJob ? (
          <>
            {uploadState.error ? <p className="error-banner">{uploadState.error}</p> : null}
            <form action={uploadAction} className="stack">
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="proposalVersionId" value={proposalVersionId} />
              <input type="hidden" name="proposalId" value={proposalId} />
              <div className="field">
                <label htmlFor="file">Upload a photo</label>
                <input id="file" name="file" type="file" accept="image/jpeg,image/png,image/webp" required />
              </div>
              <div className="field">
                <label htmlFor="caption">Caption (optional)</label>
                <input id="caption" name="caption" type="text" maxLength={200} />
              </div>
              <SubmitButton pendingText="Uploading…" className="button-success">
                Upload job photo
              </SubmitButton>
            </form>
          </>
        ) : null}
      </div>

      <div className="section-card stack">
        <h2>Previous work</h2>
        <p className="hint">Show examples of similar work you&apos;ve completed, pulled from your Portfolio.</p>
        {previousWorkMedia.length === 0 ? (
          <p className="hint">No previous-work photos selected yet.</p>
        ) : (
          <div className="photo-grid">
            {previousWorkMedia.map((m) => (
              <figure key={m.id} className="photo-card">
                {m.signedUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- see note above
                  <img src={m.signedUrl} alt={m.caption || "Previous work"} className="photo-thumb" />
                ) : (
                  <div className="hint">Photo unavailable</div>
                )}
                {m.caption ? <figcaption className="photo-card-caption">{m.caption}</figcaption> : null}
                {canUsePortfolio ? (
                  <form action={detachProposalMediaAction} className="photo-card-actions">
                    <input type="hidden" name="proposalMediaId" value={m.id} />
                    <input type="hidden" name="proposalId" value={proposalId} />
                    <SubmitButton pendingText="Removing…" className="button-secondary">
                      Remove from proposal
                    </SubmitButton>
                  </form>
                ) : null}
              </figure>
            ))}
          </div>
        )}

        {canUsePortfolio ? (
          portfolioOptions.length === 0 ? (
            <p className="hint">
              Your <Link href="/portfolio">Portfolio</Link> is empty — add previous work there to reuse it here.
            </p>
          ) : (
            <details>
              <summary>Select from Portfolio</summary>
              <div className="photo-grid" style={{ marginTop: 8 }}>
                {portfolioOptions.map((p) => (
                  <figure key={p.mediaAssetId} className="photo-card">
                    {p.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- signed URL, short-lived, per-request
                      <img src={p.thumbnailUrl} alt={p.caption || p.projectTitle} className="photo-thumb" />
                    ) : (
                      <div className="hint">Photo unavailable</div>
                    )}
                    <figcaption className="photo-card-caption">
                      {p.projectTitle} — {p.caption || "Untitled photo"}
                    </figcaption>
                    <div className="photo-card-actions">
                      {attachedAssetIds.has(p.mediaAssetId) ? (
                        <span className="badge">Added</span>
                      ) : (
                        <form action={attachPortfolioMediaToProposalAction}>
                          <input type="hidden" name="proposalVersionId" value={proposalVersionId} />
                          <input type="hidden" name="proposalId" value={proposalId} />
                          <input type="hidden" name="mediaAssetId" value={p.mediaAssetId} />
                          <input type="hidden" name="portfolioProjectId" value={p.portfolioProjectId} />
                          <button type="submit" className="button-secondary">
                            + Add
                          </button>
                        </form>
                      )}
                    </div>
                  </figure>
                ))}
              </div>
            </details>
          )
        ) : null}
      </div>

      <div className="tenant-form" style={{ justifyContent: "space-between" }}>
        <Link href={`/proposals/${proposalId}/edit?step=materials`} className="button-secondary">
          Back
        </Link>
        <Link href={`/proposals/${proposalId}/edit?step=pricing`} className="button-primary">
          Continue to Terms & Pricing
        </Link>
      </div>
    </div>
  );
}
