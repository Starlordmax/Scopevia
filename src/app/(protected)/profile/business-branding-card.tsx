"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { removeBusinessLogoAction } from "../../../actions/branding";
import type { ActionResult } from "../../../actions/auth";
import { SubmitButton } from "../../../components/submit-button";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../../components/form-field-error";

const initialState: ActionResult = {};
const GENERIC_UPLOAD_ERROR = "We couldn't upload the logo right now. Please try again.";

/**
 * Deliberately its own card, separate from the personal-profile form above
 * it — the logo belongs to the BUSINESS/tenant, not this user's own
 * account, so it must never visually read as "your avatar." Any teammate
 * with tenant.update (Owner/Admin — see docs/69) sees upload/replace/remove
 * controls; everyone else sees the current logo (or fallback text) with no
 * controls at all, matching the read-only view every other role already
 * gets on this same tenant.update / tenant.view boundary elsewhere in the
 * app (e.g. Proposal Settings).
 *
 * Upload goes through POST /api/business-branding/logo (a Route Handler),
 * NOT a Server Action — Server Actions have a hard, framework-enforced
 * body size limit that crashes the whole page with no way to show a
 * friendly message for anything over it; a plain fetch() to a Route
 * Handler has no such ceiling, so any file size gets a clean JSON
 * response. See docs/71-logo-upload-crash-fix.md. Remove has no file body
 * and is unaffected, so it stays a Server Action.
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
  const router = useRouter();
  const uploadFormRef = useRef<HTMLFormElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadFieldErrors, setUploadFieldErrors] = useState<Record<string, string> | undefined>(undefined);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [removeState, removeAction] = useActionState(removeBusinessLogoAction, initialState);
  useFocusFirstFieldError(uploadFieldErrors);

  async function handleUploadSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError(null);
    setUploadFieldErrors(undefined);
    setUploadMessage(null);

    // No `required` on the file input (see below) -- an empty selection
    // must reach our own red-state UI instead of the browser's native
    // popup, so this client-side check stands in for it.
    const formData = new FormData(event.currentTarget);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setUploadFieldErrors({ file: "Choose a logo file to upload." });
      return;
    }

    setIsUploading(true);
    try {
      const response = await fetch("/api/business-branding/logo", { method: "POST", body: formData });
      const body: ActionResult = await response.json().catch(() => ({ error: GENERIC_UPLOAD_ERROR }));

      if (!response.ok || body.error) {
        setUploadError(body.error ?? GENERIC_UPLOAD_ERROR);
        setUploadFieldErrors(body.fieldErrors);
        return;
      }

      setUploadMessage(body.message ?? "Logo uploaded successfully.");
      uploadFormRef.current?.reset();
      router.refresh();
    } catch {
      setUploadError(GENERIC_UPLOAD_ERROR);
    } finally {
      setIsUploading(false);
    }
  }

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
          <form ref={uploadFormRef} onSubmit={handleUploadSubmit} className="stack">
            {uploadError ? <p className="error-banner">{uploadError}</p> : null}
            {uploadMessage ? <p className="success-banner">{uploadMessage}</p> : null}
            <input type="hidden" name="tenantId" value={tenantId} />
            <div className="field">
              <label htmlFor="file">{logoUrl ? "Replace logo" : "Upload logo"}</label>
              {/* No `required` -- an empty submit must reach our own
                  client-side check (above) and red-state UI, not the
                  browser's native popup. */}
              <input
                id="file"
                name="file"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                {...fieldErrorProps(uploadFieldErrors, "file")}
              />
              <FieldError fieldErrors={uploadFieldErrors} id="file" />
              <span className="hint">Recommended: PNG, JPG, or WEBP. Max 10 MB.</span>
            </div>
            <button type="submit" className="button-success" disabled={isUploading} aria-busy={isUploading}>
              {isUploading ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
            </button>
          </form>

          {logoUrl ? (
            <form action={removeAction}>
              {removeState.error ? <p className="error-banner">{removeState.error}</p> : null}
              {removeState.message ? <p className="success-banner">{removeState.message}</p> : null}
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
