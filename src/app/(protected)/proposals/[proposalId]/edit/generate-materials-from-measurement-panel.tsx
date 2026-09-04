"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { generateMaterialFromMeasurementAction } from "../../../../../actions/measurements";
import type { ActionResult } from "../../../../../actions/auth";
import { SubmitButton } from "../../../../../components/submit-button";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../../../../components/form-field-error";
import { formatCents } from "../../../../../lib/proposals/format";
import type { MaterialCatalogSearchResult } from "../../../../../lib/proposals/materials";
import type { Database } from "../../../../../../types/database";

type ProposalMeasurement = Database["public"]["Tables"]["proposal_measurements"]["Row"];
type ProposalSection = Database["public"]["Tables"]["proposal_sections"]["Row"];

const initialState: ActionResult = {};

/**
 * Estimates material quantities/cost from a saved measurement's area,
 * perimeter, or length. Lives in the Materials & Costs step (moved here
 * from Measurements — see docs/34-proposal-builder-ux.md, "Step
 * responsibilities") so Measurements stays a pure capture step. Reuses this
 * step's own catalog search results (from the "Material pricing" panel
 * above it) instead of duplicating a second search UI. `measurements`
 * comes straight from the proposal/version load in edit/page.tsx, so this
 * works even if the user never visited Measurements in this browser
 * session.
 */
export function GenerateMaterialsFromMeasurementPanel({
  proposalId,
  proposalVersionId,
  measurements,
  catalogResults,
  sections,
  canGenerate,
  canManagePricing,
  pricingZipCode,
}: {
  proposalId: string;
  proposalVersionId: string;
  measurements: ProposalMeasurement[];
  catalogResults: MaterialCatalogSearchResult[];
  sections: ProposalSection[];
  canGenerate: boolean;
  canManagePricing: boolean;
  pricingZipCode: string | null;
}) {
  const [state, formAction] = useActionState(generateMaterialFromMeasurementAction, initialState);
  const [measurementId, setMeasurementId] = useState(measurements[0]?.id ?? "");
  const selectedMeasurement = measurements.find((m) => m.id === measurementId);
  const [materialId, setMaterialId] = useState(catalogResults[0]?.id ?? "");
  const selectedMaterial = catalogResults.find((r) => r.id === materialId);
  useFocusFirstFieldError(state.fieldErrors);

  if (!canGenerate) return null;

  const availableFields: { value: string; label: string }[] = [];
  if (selectedMeasurement?.area != null) availableFields.push({ value: "area", label: `Area (${selectedMeasurement.area} sq ${selectedMeasurement.unit})` });
  if (selectedMeasurement?.perimeter != null) availableFields.push({ value: "perimeter", label: `Perimeter (${selectedMeasurement.perimeter} ${selectedMeasurement.unit})` });
  if (selectedMeasurement?.linear_length != null) availableFields.push({ value: "linear_length", label: `Linear length (${selectedMeasurement.linear_length} ${selectedMeasurement.unit})` });

  return (
    <div className="section-card stack">
      <h2>Generate materials from a saved measurement</h2>
      <p className="hint">Estimate material quantity and cost from a saved measurement&apos;s area, perimeter, or length.</p>

      {measurements.length === 0 ? (
        <p className="hint">
          No saved measurements yet. Create a measurement first, then use it to estimate material quantities.{" "}
          <Link href={`/proposals/${proposalId}/edit?step=measurements`}>Go to Measurements</Link>
        </p>
      ) : !pricingZipCode ? (
        <p className="hint">Set a ZIP code above to see local material pricing.</p>
      ) : (
        <form action={formAction} noValidate className="stack">
          <input type="hidden" name="proposalVersionId" value={proposalVersionId} />
          <input type="hidden" name="proposalId" value={proposalId} />
          <input type="hidden" name="measurementId" value={measurementId} />

          {state.error ? <p className="error-banner">{state.error}</p> : null}
          {state.message ? <p className="success-banner">{state.message}</p> : null}

          <div className="field">
            <label htmlFor="genMeasurement">Measurement</label>
            <select id="genMeasurement" value={measurementId} onChange={(e) => setMeasurementId(e.target.value)} disabled={measurements.length === 0}>
              {measurements.length === 0 ? <option value="">No measurements yet</option> : null}
              {measurements.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          {availableFields.length > 0 ? (
            <div className="field">
              <label htmlFor="measurementValueField">Use this value</label>
              <select id="measurementValueField" name="measurementValueField" defaultValue={availableFields[0]!.value}>
                {availableFields.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="genMaterial">Material</label>
            <select id="genMaterial" name="materialCatalogItemId" value={materialId} onChange={(e) => setMaterialId(e.target.value)} disabled={catalogResults.length === 0}>
              {catalogResults.length === 0 ? <option value="">No catalog results — search above</option> : null}
              {catalogResults.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} {r.unit_price_cents != null ? `— ${formatCents(r.unit_price_cents)}/${r.default_unit.replace(/_/g, " ")}` : "— no price for this ZIP"}
                </option>
              ))}
            </select>
          </div>
          {selectedMaterial && selectedMaterial.unit_price_cents == null ? (
            <p className="hint">No catalog price is available for this material in the selected ZIP code. Add a custom cost instead.</p>
          ) : null}

          <div className="tenant-form" style={{ width: "100%" }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="coverageRate">
                Coverage rate {selectedMaterial ? `(${selectedMaterial.default_unit === "gallon" ? "sq ft per gallon" : `per ${selectedMaterial.default_unit.replace(/_/g, " ")}`})` : ""}
              </label>
              <input
                id="coverageRate"
                name="coverageRate"
                type="number"
                min={0.01}
                step={0.01}
                defaultValue="1"
                {...fieldErrorProps(state.fieldErrors, "coverageRate")}
              />
              <FieldError fieldErrors={state.fieldErrors} id="coverageRate" />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="coats">Coats</label>
              <input id="coats" name="coats" type="number" min={1} max={20} step={1} defaultValue="1" />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="genWaste">Waste %</label>
              <input id="genWaste" name="wastePercent" type="number" min={0} max={100} step={1} defaultValue="0" />
            </div>
          </div>

          {sections.length > 0 ? (
            <div className="field">
              <label htmlFor="genSectionId">Section (optional)</label>
              <select id="genSectionId" name="sectionId" defaultValue="">
                <option value="">No specific section</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {canManagePricing ? (
            <div className="field">
              <label htmlFor="genUnitPriceOverride">Override price ($, optional)</label>
              <input id="genUnitPriceOverride" name="unitPriceOverride" type="text" inputMode="decimal" placeholder="" />
            </div>
          ) : null}

          <SubmitButton pendingText="Generating…" className="button-primary" disabled={measurements.length === 0 || catalogResults.length === 0}>
            Add to proposal
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
