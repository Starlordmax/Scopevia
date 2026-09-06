"use client";

import { useActionState } from "react";
import { updateProposalSettingsAction } from "../../../../actions/proposal-settings";
import type { ActionResult } from "../../../../actions/auth";
import { SubmitButton } from "../../../../components/submit-button";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../../../components/form-field-error";
import type { Database } from "../../../../../types/database";

type TenantProposalSettings = Database["public"]["Tables"]["tenant_proposal_settings"]["Row"];

const initialState: ActionResult = {};

export function ProposalSettingsForm({ tenantId, settings }: { tenantId: string; settings: TenantProposalSettings }) {
  const [state, formAction] = useActionState(updateProposalSettingsAction, initialState);
  useFocusFirstFieldError(state.fieldErrors);

  return (
    <form action={formAction} noValidate className="stack">
      {state.error ? <p className="error-banner">{state.error}</p> : null}
      <input type="hidden" name="tenantId" value={tenantId} />

      <div className="field">
        <label htmlFor="currency">Currency</label>
        <input id="currency" type="text" value="USD" disabled />
        <span className="hint">Only USD is supported right now.</span>
      </div>

      <div className="tenant-form" style={{ width: "100%" }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="defaultCustomerHourlyRate">Default hourly rate ($)</label>
          <input
            id="defaultCustomerHourlyRate"
            name="defaultCustomerHourlyRate"
            type="text"
            inputMode="decimal"
            defaultValue={(settings.default_customer_hourly_rate_cents / 100).toFixed(2)}
            {...fieldErrorProps(state.fieldErrors, "defaultCustomerHourlyRate")}
          />
          <FieldError fieldErrors={state.fieldErrors} id="defaultCustomerHourlyRate" />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="defaultHoursPerDay">Default hours per day</label>
          <input
            id="defaultHoursPerDay"
            name="defaultHoursPerDay"
            type="number"
            min={0.5}
            max={24}
            step={0.5}
            defaultValue={settings.default_hours_per_day}
            {...fieldErrorProps(state.fieldErrors, "defaultHoursPerDay")}
          />
          <FieldError fieldErrors={state.fieldErrors} id="defaultHoursPerDay" />
        </div>
      </div>

      <div className="tenant-form" style={{ width: "100%" }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="defaultTaxRatePercent">Default tax rate (%)</label>
          <input
            id="defaultTaxRatePercent"
            name="defaultTaxRatePercent"
            type="text"
            inputMode="decimal"
            defaultValue={(settings.default_tax_rate_bps / 100).toString()}
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="defaultProposalValidDays">Proposal validity (days)</label>
          <input
            id="defaultProposalValidDays"
            name="defaultProposalValidDays"
            type="number"
            min={1}
            defaultValue={settings.default_proposal_valid_days}
            {...fieldErrorProps(state.fieldErrors, "defaultProposalValidDays")}
          />
          <FieldError fieldErrors={state.fieldErrors} id="defaultProposalValidDays" />
        </div>
      </div>

      <div className="field">
        <label htmlFor="proposalNumberPrefix">Proposal number prefix</label>
        <input
          id="proposalNumberPrefix"
          name="proposalNumberPrefix"
          type="text"
          maxLength={20}
          defaultValue={settings.proposal_number_prefix}
          {...fieldErrorProps(state.fieldErrors, "proposalNumberPrefix")}
        />
        <FieldError fieldErrors={state.fieldErrors} id="proposalNumberPrefix" />
        <span className="hint">Next proposal number: #{settings.next_proposal_number} (managed automatically).</span>
      </div>

      <div className="field">
        <label htmlFor="defaultTerms">Default terms</label>
        <textarea id="defaultTerms" name="defaultTerms" rows={4} defaultValue={settings.default_terms} />
      </div>

      <div className="field">
        <label htmlFor="defaultExclusions">Default exclusions</label>
        <textarea id="defaultExclusions" name="defaultExclusions" rows={4} defaultValue={settings.default_exclusions} />
      </div>

      <SubmitButton pendingText="Saving…">Save settings</SubmitButton>
    </form>
  );
}
