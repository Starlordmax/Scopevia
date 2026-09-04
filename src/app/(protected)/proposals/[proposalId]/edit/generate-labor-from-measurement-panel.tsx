"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { addLaborFromMeasurementAction } from "../../../../../actions/measurements";
import type { ActionResult } from "../../../../../actions/auth";
import { SubmitButton } from "../../../../../components/submit-button";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../../../../components/form-field-error";
import type { Database } from "../../../../../../types/database";

type ProposalMeasurement = Database["public"]["Tables"]["proposal_measurements"]["Row"];

const initialState: ActionResult = {};

/**
 * Prices a labor item from a saved measurement's area or length. Lives in
 * the Labor step (moved here from Measurements — see
 * docs/34-proposal-builder-ux.md, "Step responsibilities") so Measurements
 * stays a pure capture step. `measurements` comes straight from the
 * proposal/version load in edit/page.tsx, so this works even if the user
 * never visited Measurements in this browser session.
 */
export function GenerateLaborFromMeasurementPanel({
  proposalId,
  proposalVersionId,
  measurements,
  canGenerate,
}: {
  proposalId: string;
  proposalVersionId: string;
  measurements: ProposalMeasurement[];
  canGenerate: boolean;
}) {
  const [state, formAction] = useActionState(addLaborFromMeasurementAction, initialState);
  const [measurementId, setMeasurementId] = useState(measurements[0]?.id ?? "");
  const selectedMeasurement = measurements.find((m) => m.id === measurementId);
  useFocusFirstFieldError(state.fieldErrors);

  if (!canGenerate) return null;

  return (
    <div className="section-card stack">
      <h2>Generate labor from a saved measurement</h2>
      <p className="hint">
        Price labor by a saved measurement&apos;s area or length — useful for jobs quoted per square foot or linear foot,
        like flooring or painting.
      </p>

      {measurements.length === 0 ? (
        <p className="hint">
          No saved measurements yet. <Link href={`/proposals/${proposalId}/edit?step=measurements`}>Go to Measurements</Link>{" "}
          to create an area or linear measurement first.
        </p>
      ) : (
        <GenerateLaborForm
          proposalId={proposalId}
          proposalVersionId={proposalVersionId}
          measurements={measurements}
          state={state}
          formAction={formAction}
          measurementId={measurementId}
          setMeasurementId={setMeasurementId}
          selectedMeasurement={selectedMeasurement}
        />
      )}
    </div>
  );
}

function GenerateLaborForm({
  proposalId,
  proposalVersionId,
  measurements,
  state,
  formAction,
  measurementId,
  setMeasurementId,
  selectedMeasurement,
}: {
  proposalId: string;
  proposalVersionId: string;
  measurements: ProposalMeasurement[];
  state: ActionResult;
  formAction: (formData: FormData) => void;
  measurementId: string;
  setMeasurementId: (id: string) => void;
  selectedMeasurement: ProposalMeasurement | undefined;
}) {
  const canUseArea = selectedMeasurement?.area != null;
  const canUseLinear = selectedMeasurement?.linear_length != null || selectedMeasurement?.perimeter != null;

  return (
    <form action={formAction} noValidate className="stack">
      <input type="hidden" name="proposalVersionId" value={proposalVersionId} />
      <input type="hidden" name="proposalId" value={proposalId} />
      <input type="hidden" name="measurementId" value={measurementId} />

      {state.error ? <p className="error-banner">{state.error}</p> : null}
      {state.message ? <p className="success-banner">{state.message}</p> : null}

      <div className="field">
        <label htmlFor="laborMeasurement">Measurement</label>
        <select id="laborMeasurement" value={measurementId} onChange={(e) => setMeasurementId(e.target.value)} disabled={measurements.length === 0}>
          {measurements.length === 0 ? <option value="">No measurements yet</option> : null}
          {measurements.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="laborLabel">Label</label>
        <input
          id="laborLabel"
          name="label"
          type="text"
          placeholder="e.g. Flooring install labor"
          {...fieldErrorProps(state.fieldErrors, "label")}
        />
        <FieldError fieldErrors={state.fieldErrors} id="label" />
      </div>

      <div className="tenant-form" style={{ width: "100%" }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="pricingMethod">Price by</label>
          <select id="pricingMethod" name="pricingMethod" defaultValue={canUseArea ? "area" : "linear"}>
            <option value="area" disabled={!canUseArea}>
              Area {selectedMeasurement?.area != null ? `(${selectedMeasurement.area} sq ${selectedMeasurement.unit})` : "(not available)"}
            </option>
            <option value="linear" disabled={!canUseLinear}>
              Linear/perimeter{" "}
              {selectedMeasurement
                ? `(${(selectedMeasurement.linear_length ?? selectedMeasurement.perimeter) ?? "not available"} ${selectedMeasurement.unit})`
                : ""}
            </option>
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="rateCents">Rate ($ per unit)</label>
          {/* id is "rateCents" (not "laborRate") to match the Zod schema's
              field name -- the form field itself stays name="rate" since
              that's what the Server Action reads from FormData. */}
          <input
            id="rateCents"
            name="rate"
            type="text"
            inputMode="decimal"
            placeholder="e.g. 4.00"
            {...fieldErrorProps(state.fieldErrors, "rateCents")}
          />
          <FieldError fieldErrors={state.fieldErrors} id="rateCents" />
        </div>
      </div>

      <SubmitButton pendingText="Adding…" className="button-primary" disabled={measurements.length === 0 || (!canUseArea && !canUseLinear)}>
        Add labor to proposal
      </SubmitButton>
    </form>
  );
}
