"use client";

import { useActionState } from "react";
import { uploadBusinessLogoAction, removeBusinessLogoAction } from "../../../actions/branding";
import type { ActionResult } from "../../../actions/auth";
import { SubmitButton } from "../../../components/submit-button";

const initialState: ActionResult = {};

/**
 * Deliberately its own card, separate from the personal-profile form above
 * it — the logo belongs to the BUSINESS/tenant, not this user's own
 * account, so it must never visually read as "your avatar." Any teammate
 * with tenant.update (Owner/Admin — see docs/69) sees upload/replace/remove
 * controls; everyone else sees the current logo (or fallback text) with no
 * controls at all, matching the read-only view every other role already
 * gets on this same tenant.update / tenant.view boundary elsewhere in the
 * app (e.g. Proposal Settings).
 */
export function BusinessBrandingCard({
  tenantId,
  canUpdate,
  logoUrl,
  businessName,
}: {
  tenantId: string;
  canUpdate: boolean;
  logoUrl: string | null;
  businessName: string;
}) {
  const [uploadState, uploadAction] = useActionState(uploadBusinessLogoAction, initialState);
  const [removeState, removeAction] = useActionState(removeBusinessLogoAction, initialState);

  return (
    <div className="form-card">
      <div className="stack" style={{ gap: 4 }}>
        <strong>Business branding</strong>
        <span className="hint">Company logo — appears on client proposals, portal pages, and printable PDFs.</span>
      </div>

      <div className="field">
        <label>Current logo</label>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL is short-lived and per-request, not a good fit for next/image's remote-pattern allowlist.
          <img src={logoUrl} alt={`${businessName} logo`} className="photo-thumb" />
        ) : (
          <span className="hint">No logo uploaded yet — proposals show &quot;{businessName}&quot; as text instead.</span>
        )}
      </div>

      {canUpdate ? (
        <>
          <form action={uploadAction} className="stack">
            {uploadState.error ? <p className="error-banner">{uploadState.error}</p> : null}
            <input type="hidden" name="tenantId" value={tenantId} />
            <div className="field">
              <label htmlFor="logoFile">{logoUrl ? "Replace logo" : "Upload logo"}</label>
              <input id="logoFile" name="file" type="file" accept="image/png,image/jpeg,image/webp" required />
              <span className="hint">Recommended: PNG, JPG, or WEBP. Max 2 MB.</span>
            </div>
            <SubmitButton pendingText="Uploading…" className="button-success">
              {logoUrl ? "Replace logo" : "Upload logo"}
            </SubmitButton>
          </form>

          {logoUrl ? (
            <form action={removeAction}>
              {removeState.error ? <p className="error-banner">{removeState.error}</p> : null}
              <input type="hidden" name="tenantId" value={tenantId} />
              <SubmitButton pendingText="Removing…" className="button-danger">
                Remove logo
              </SubmitButton>
            </form>
          ) : null}
        </>
      ) : (
        <span className="hint">Only an Owner or Admin can change the business logo.</span>
      )}
    </div>
  );
}
