"use client";

import { useActionState } from "react";
import { updateBusinessProfileAction } from "../../../actions/business-profile";
import type { ActionResult } from "../../../actions/auth";
import { SubmitButton } from "../../../components/submit-button";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../../components/form-field-error";
import type { BusinessProfile } from "../../../lib/business/data";

const initialState: ActionResult = {};

const TONE_OPTIONS: { value: string; label: string }[] = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "direct", label: "Direct" },
  { value: "detailed", label: "Detailed" },
  { value: "simple", label: "Simple" },
];

/**
 * Tenant-level business context — NOT the personal ProfileForm above it.
 * Feeds the AI writing assistant on Terms & Pricing (see
 * src/lib/ai/prompt.ts) — every field here is optional except business
 * name, and the AI prompt writes neutral, generic language for anything
 * left blank rather than inventing a commitment. See
 * docs/78-business-profile-ai-context.md.
 */
export function BusinessProfileCard({ tenantId, canUpdate, profile }: { tenantId: string; canUpdate: boolean; profile: BusinessProfile }) {
  const [state, formAction] = useActionState(updateBusinessProfileAction, initialState);
  useFocusFirstFieldError(state.fieldErrors);

  return (
    <div className="form-card">
      <div className="stack" style={{ gap: 4 }}>
        <strong>Business profile</strong>
        <span className="hint">
          Scopevia uses this information to help draft proposal terms, exclusions, and client notes. You can edit every AI
          draft before saving.
        </span>
      </div>

      {state.error ? <p className="error-banner">{state.error}</p> : null}
      {state.message ? <p className="success-banner">{state.message}</p> : null}

      <form action={formAction} noValidate className="stack">
        <input type="hidden" name="tenantId" value={tenantId} />

        <div className="tenant-form" style={{ width: "100%" }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="businessName">Business name</label>
            <input
              id="businessName"
              name="businessName"
              type="text"
              defaultValue={profile.business_name}
              disabled={!canUpdate}
              {...fieldErrorProps(state.fieldErrors, "businessName")}
            />
            <FieldError fieldErrors={state.fieldErrors} id="businessName" />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="industry">Business type / Industry</label>
            <input
              id="industry"
              name="industry"
              type="text"
              placeholder="e.g. Residential painting contractor"
              defaultValue={profile.industry}
              disabled={!canUpdate}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="mainServices">Main services offered</label>
          <textarea
            id="mainServices"
            name="mainServices"
            rows={2}
            placeholder="e.g. Interior and exterior painting, drywall repair, cabinet refinishing"
            defaultValue={profile.main_services}
            disabled={!canUpdate}
          />
        </div>

        <div className="field">
          <label htmlFor="serviceArea">Service area</label>
          <input
            id="serviceArea"
            name="serviceArea"
            type="text"
            placeholder="e.g. Miami-Dade and Broward counties"
            defaultValue={profile.service_area}
            disabled={!canUpdate}
          />
        </div>

        <div className="field">
          <label htmlFor="businessAddress">Business address</label>
          <textarea id="businessAddress" name="businessAddress" rows={2} defaultValue={profile.business_address} disabled={!canUpdate} />
        </div>

        <div className="tenant-form" style={{ width: "100%" }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="businessPhone">Business phone</label>
            <input id="businessPhone" name="businessPhone" type="tel" defaultValue={profile.business_phone} disabled={!canUpdate} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="businessEmail">Business email</label>
            <input
              id="businessEmail"
              name="businessEmail"
              type="email"
              defaultValue={profile.business_email}
              disabled={!canUpdate}
              {...fieldErrorProps(state.fieldErrors, "businessEmail")}
            />
            <FieldError fieldErrors={state.fieldErrors} id="businessEmail" />
          </div>
        </div>

        <div className="tenant-form" style={{ width: "100%" }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="licenseNumber">License number (optional)</label>
            <input id="licenseNumber" name="licenseNumber" type="text" defaultValue={profile.license_number} disabled={!canUpdate} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="tonePreference">Tone preference</label>
            <select id="tonePreference" name="tonePreference" defaultValue={profile.tone_preference} disabled={!canUpdate}>
              {TONE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="insuranceStatement">Insurance / bonded statement (optional)</label>
          <textarea
            id="insuranceStatement"
            name="insuranceStatement"
            rows={2}
            placeholder="e.g. Fully licensed and insured. General liability coverage available upon request."
            defaultValue={profile.insurance_statement}
            disabled={!canUpdate}
          />
          <span className="hint">Only what you enter here is ever used — AI drafts never invent a license or insurance claim.</span>
        </div>

        <hr />
        <strong>Default policies</strong>
        <span className="hint">Used to draft Terms; anything left blank gets neutral, generic language instead of an invented commitment.</span>

        <div className="field">
          <label htmlFor="defaultWarrantyPolicy">Default warranty policy</label>
          <textarea
            id="defaultWarrantyPolicy"
            name="defaultWarrantyPolicy"
            rows={2}
            placeholder="e.g. Workmanship warranty for 1 year. Materials are covered by manufacturer warranty."
            defaultValue={profile.default_warranty_policy}
            disabled={!canUpdate}
          />
        </div>

        <div className="field">
          <label htmlFor="defaultPaymentTerms">Payment terms preference</label>
          <textarea
            id="defaultPaymentTerms"
            name="defaultPaymentTerms"
            rows={2}
            placeholder="e.g. 50% deposit, balance due upon completion."
            defaultValue={profile.default_payment_terms}
            disabled={!canUpdate}
          />
        </div>

        <div className="field">
          <label htmlFor="defaultDepositPolicy">Deposit policy</label>
          <textarea id="defaultDepositPolicy" name="defaultDepositPolicy" rows={2} defaultValue={profile.default_deposit_policy} disabled={!canUpdate} />
        </div>

        <div className="field">
          <label htmlFor="defaultChangeOrderPolicy">Change order policy</label>
          <textarea
            id="defaultChangeOrderPolicy"
            name="defaultChangeOrderPolicy"
            rows={2}
            defaultValue={profile.default_change_order_policy}
            disabled={!canUpdate}
          />
        </div>

        <div className="field">
          <label htmlFor="defaultCancellationPolicy">Cancellation / rescheduling policy</label>
          <textarea
            id="defaultCancellationPolicy"
            name="defaultCancellationPolicy"
            rows={2}
            defaultValue={profile.default_cancellation_policy}
            disabled={!canUpdate}
          />
        </div>

        <div className="field">
          <label htmlFor="defaultCleanupPolicy">Cleanup policy</label>
          <textarea id="defaultCleanupPolicy" name="defaultCleanupPolicy" rows={2} defaultValue={profile.default_cleanup_policy} disabled={!canUpdate} />
        </div>

        <div className="field">
          <label htmlFor="defaultMaterialsPolicy">Materials policy</label>
          <textarea
            id="defaultMaterialsPolicy"
            name="defaultMaterialsPolicy"
            rows={2}
            defaultValue={profile.default_materials_policy}
            disabled={!canUpdate}
          />
        </div>

        <div className="field">
          <label htmlFor="defaultClientResponsibilities">Client responsibilities</label>
          <textarea
            id="defaultClientResponsibilities"
            name="defaultClientResponsibilities"
            rows={2}
            placeholder="e.g. Clear access to the work area, remove valuables, approve colors/materials before work begins."
            defaultValue={profile.default_client_responsibilities}
            disabled={!canUpdate}
          />
        </div>

        <div className="field">
          <label htmlFor="defaultExclusions">Default exclusions</label>
          <textarea
            id="defaultExclusions"
            name="defaultExclusions"
            rows={2}
            placeholder="e.g. Structural repairs, hidden damage, permit fees, electrical/plumbing work unless listed."
            defaultValue={profile.default_exclusions}
            disabled={!canUpdate}
          />
        </div>

        {canUpdate ? <SubmitButton pendingText="Saving…">Save business profile</SubmitButton> : null}
      </form>
      {!canUpdate ? <span className="hint">Only an Owner or Admin can update the business profile.</span> : null}
    </div>
  );
}
