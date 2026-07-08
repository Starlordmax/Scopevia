"use client";

import { useActionState } from "react";
import { uploadPortfolioPhotoAction } from "../../../../actions/portfolio";
import type { ActionResult } from "../../../../actions/auth";
import { SubmitButton } from "../../../../components/submit-button";

const initialState: ActionResult = {};

export function UploadPhotoForm({ tenantId, portfolioProjectId }: { tenantId: string; portfolioProjectId: string }) {
  const [state, formAction] = useActionState(uploadPortfolioPhotoAction, initialState);

  return (
    <form action={formAction} className="stack">
      {state.error ? <p className="error-banner">{state.error}</p> : null}
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="portfolioProjectId" value={portfolioProjectId} />
      <div className="field">
        <label htmlFor="file">Upload a photo</label>
        <input id="file" name="file" type="file" accept="image/jpeg,image/png,image/webp" required />
      </div>
      <div className="field">
        <label htmlFor="caption">Caption (optional)</label>
        <input id="caption" name="caption" type="text" maxLength={200} />
      </div>
      <SubmitButton pendingText="Uploading…" className="button-success">
        Upload portfolio photo
      </SubmitButton>
    </form>
  );
}
