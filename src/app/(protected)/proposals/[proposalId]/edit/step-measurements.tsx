"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import {
  createMeasurementGroupAction,
  addMeasurementAction,
  archiveMeasurementAction,
  generateMaterialFromMeasurementAction,
  addLaborFromMeasurementAction,
} from "../../../../../actions/measurements";
import type { ActionResult } from "../../../../../actions/auth";
import { SubmitButton } from "../../../../../components/submit-button";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../../../../components/form-field-error";
import { computeRectangle, computeWallArea } from "../../../../../lib/proposals/measurements";
import { formatCents, formatLabel } from "../../../../../lib/proposals/format";
import { DrawLayoutCanvas } from "./draw-layout-canvas";
import type { MaterialCatalogSearchResult } from "../../../../../lib/proposals/materials";
import type { Database } from "../../../../../../types/database";

type ProposalMeasurementGroup = Database["public"]["Tables"]["proposal_measurement_groups"]["Row"];
type ProposalMeasurement = Database["public"]["Tables"]["proposal_measurements"]["Row"];
type ProposalSection = Database["public"]["Tables"]["proposal_sections"]["Row"];

const initialState: ActionResult = {};

const MEASUREMENT_TYPES = [
  { value: "floor_area", label: "Floor area" },
  { value: "wall_area", label: "Wall area (needs height)" },
  { value: "ceiling_area", label: "Ceiling area" },
  { value: "room", label: "Room (floor footprint)" },
  { value: "surface", label: "Surface" },
  { value: "linear", label: "Linear (trim, fencing, etc.)" },
  { value: "custom", label: "Custom" },
];

function GroupForm({ proposalId, proposalVersionId }: { proposalId: string; proposalVersionId: string }) {
  const [state, formAction] = useActionState(createMeasurementGroupAction, initialState);
  useFocusFirstFieldError(state.fieldErrors);
  return (
    <form action={formAction} noValidate className="tenant-form" style={{ width: "100%" }}>
      <input type="hidden" name="proposalVersionId" value={proposalVersionId} />
      <input type="hidden" name="proposalId" value={proposalId} />
      {state.error ? <p className="error-banner">{state.error}</p> : null}
      <div className="field" style={{ flex: 1 }}>
        <label htmlFor="groupName">New group name</label>
        {/* fieldErrors is keyed by the schema's field name ("name"), which
            also matches this input's `name` attribute -- useFocusFirstFieldError
            falls back to a [name=...] lookup when id and the error key differ,
            which is the case here since "name" as an id would collide with
            ManualMeasurementForm's own "name" field on this same page. */}
        <input id="groupName" name="name" type="text" placeholder="e.g. Bathroom" {...fieldErrorProps(state.fieldErrors, "name")} />
        <FieldError fieldErrors={state.fieldErrors} id="name" />
      </div>
      <div className="field" style={{ flex: "0 0 auto" }}>
        <label htmlFor="groupUnitSystem">Units</label>
        <select id="groupUnitSystem" name="unitSystem" defaultValue="imperial">
          <option value="imperial">Feet (imperial)</option>
          <option value="metric">Meters (metric)</option>
        </select>
      </div>
      <SubmitButton pendingText="Creating…" className="button-secondary">
        + Add group
      </SubmitButton>
    </form>
  );
}

type ShapeKind = "manual_rectangle" | "manual_area" | "manual_linear";

function ManualMeasurementForm({
  proposalId,
  proposalVersionId,
  measurementGroups,
}: {
  proposalId: string;
  proposalVersionId: string;
  measurementGroups: ProposalMeasurementGroup[];
}) {
  const [state, formAction] = useActionState(addMeasurementAction, initialState);
  const [shapeType, setShapeType] = useState<ShapeKind>("manual_rectangle");
  const [measurementType, setMeasurementType] = useState("floor_area");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [area, setArea] = useState("");
  const [linearLength, setLinearLength] = useState("");
  const [wastePercent, setWastePercent] = useState("0");
  const unit = measurementGroups[0]?.unit_system === "metric" ? "m" : "ft";

  const preview = useMemo(() => {
    try {
      if (shapeType === "manual_rectangle") {
        const l = parseFloat(length);
        const w = parseFloat(width);
        const h = parseFloat(height);
        if (!(l > 0) || !(w > 0)) return null;
        if (measurementType === "wall_area") {
          if (!(h > 0)) return null;
          return computeWallArea(l, w, h);
        }
        return computeRectangle(l, w);
      }
      if (shapeType === "manual_area") {
        const a = parseFloat(area);
        if (!(a > 0)) return null;
        return { area: a, perimeter: null as number | null };
      }
      if (shapeType === "manual_linear") {
        const ll = parseFloat(linearLength);
        if (!(ll > 0)) return null;
        return { area: null as number | null, perimeter: null as number | null, linear: ll };
      }
    } catch {
      return null;
    }
    return null;
  }, [shapeType, measurementType, length, width, height, area, linearLength]);

  const wasteBps = (parseFloat(wastePercent) || 0) * 100;
  const previewWithWaste =
    preview && "area" in preview && preview.area != null ? preview.area * (1 + wasteBps / 10000) : null;

  // Same fix as draw-layout-canvas.tsx's Save buttons: this form's Save
  // used to be `disabled` whenever no measurement group existed yet, so a
  // click in that state did nothing visible at all -- no error, no red
  // border, no explanation. Save is now always clickable; a missing
  // group is instead caught client-side (the server parses
  // measurementGroupId outside its Zod schema and would otherwise only
  // ever return a generic, non-field-specific "Invalid request").
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const clientFieldErrors: Record<string, string> =
    attemptedSubmit && measurementGroups.length === 0 ? { measurementGroupId: "Create a measurement group before saving." } : {};
  const fieldErrors: Record<string, string> = { ...state.fieldErrors, ...clientFieldErrors };
  useFocusFirstFieldError(fieldErrors);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    setAttemptedSubmit(true);
    if (measurementGroups.length === 0) {
      e.preventDefault();
    }
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="stack">
      <input type="hidden" name="proposalVersionId" value={proposalVersionId} />
      <input type="hidden" name="proposalId" value={proposalId} />
      <input type="hidden" name="unit" value={unit} />

      {state.error ? <p className="error-banner">{state.error}</p> : null}

      <div className="field">
        <label htmlFor="measurementGroupId">Group</label>
        {/* No `required` -- Save is never disabled just because this is
            empty (see handleSubmit above), so a missing group now reaches
            the same red-state UI as every other field. */}
        <select
          id="measurementGroupId"
          name="measurementGroupId"
          disabled={measurementGroups.length === 0}
          {...fieldErrorProps(fieldErrors, "measurementGroupId")}
        >
          {measurementGroups.length === 0 ? <option value="">Add a group above first</option> : null}
          {measurementGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <FieldError fieldErrors={fieldErrors} id="measurementGroupId" />
      </div>

      <div className="field">
        <label htmlFor="name">Name</label>
        {/* No `required` -- an empty submit must reach our own server-side validation and inline red-state UI, not the browser's native popup. */}
        <input id="name" name="name" type="text" placeholder="e.g. Bathroom floor" {...fieldErrorProps(fieldErrors, "name")} />
        <FieldError fieldErrors={fieldErrors} id="name" />
      </div>

      <div className="tenant-form" style={{ width: "100%" }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="measurementType">Measurement type</label>
          <select
            id="measurementType"
            name="measurementType"
            value={measurementType}
            onChange={(e) => setMeasurementType(e.target.value)}
          >
            {MEASUREMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="shapeType">How are you entering it?</label>
          <select id="shapeType" name="shapeType" value={shapeType} onChange={(e) => setShapeType(e.target.value as ShapeKind)}>
            <option value="manual_rectangle">Length x width</option>
            <option value="manual_area">Area directly</option>
            <option value="manual_linear">Linear length</option>
          </select>
        </div>
      </div>

      {shapeType === "manual_rectangle" ? (
        <div className="tenant-form" style={{ width: "100%" }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="length">Length ({unit})</label>
            <input
              id="length"
              name="length"
              type="number"
              min={0.01}
              step={0.01}
              value={length}
              onChange={(e) => setLength(e.target.value)}
              {...fieldErrorProps(fieldErrors, "length")}
            />
            <FieldError fieldErrors={fieldErrors} id="length" />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="width">Width ({unit})</label>
            <input
              id="width"
              name="width"
              type="number"
              min={0.01}
              step={0.01}
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              {...fieldErrorProps(fieldErrors, "width")}
            />
            <FieldError fieldErrors={fieldErrors} id="width" />
          </div>
          {measurementType === "wall_area" ? (
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="height">Height ({unit})</label>
              <input
                id="height"
                name="height"
                type="number"
                min={0.01}
                step={0.01}
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                {...fieldErrorProps(fieldErrors, "height")}
              />
              <FieldError fieldErrors={fieldErrors} id="height" />
            </div>
          ) : null}
        </div>
      ) : null}

      {shapeType === "manual_area" ? (
        <div className="field">
          <label htmlFor="area">Area (sq {unit})</label>
          <input
            id="area"
            name="area"
            type="number"
            min={0.01}
            step={0.01}
            value={area}
            onChange={(e) => setArea(e.target.value)}
            {...fieldErrorProps(fieldErrors, "area")}
          />
          <FieldError fieldErrors={fieldErrors} id="area" />
        </div>
      ) : null}

      {shapeType === "manual_linear" ? (
        <div className="field">
          <label htmlFor="linearLength">Linear length ({unit})</label>
          <input
            id="linearLength"
            name="linearLength"
            type="number"
            min={0.01}
            step={0.01}
            value={linearLength}
            onChange={(e) => setLinearLength(e.target.value)}
            {...fieldErrorProps(fieldErrors, "linearLength")}
          />
          <FieldError fieldErrors={fieldErrors} id="linearLength" />
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="wastePercent">Waste %</label>
        <input
          id="wastePercent"
          name="wastePercent"
          type="number"
          min={0}
          max={100}
          step={1}
          value={wastePercent}
          onChange={(e) => setWastePercent(e.target.value)}
          {...fieldErrorProps(fieldErrors, "wastePercent")}
        />
        <FieldError fieldErrors={fieldErrors} id="wastePercent" />
      </div>

      <div className="field">
        <label htmlFor="notes">Notes (optional)</label>
        <input id="notes" name="notes" type="text" />
      </div>

      {preview ? (
        <div className="metric-tile unsaved-preview-tile" style={{ maxWidth: 400 }}>
          <div className="metric-tile-value">
            {"linear" in preview && preview.linear != null
              ? `${preview.linear.toFixed(2)} ${unit}`
              : `${preview.area?.toFixed(2)} sq ${unit}`}
          </div>
          <div className="metric-tile-label">
            <strong>Not saved yet.</strong>
            {preview.perimeter != null ? ` Perimeter: ${preview.perimeter.toFixed(2)} ${unit}.` : ""}
            {previewWithWaste != null ? ` With waste: ${previewWithWaste.toFixed(2)} sq ${unit}.` : ""}
          </div>
        </div>
      ) : (
        <p className="hint">Fill in the dimensions to see the calculated area/perimeter.</p>
      )}

      {/* Not disabled on `measurementGroups.length === 0` -- see handleSubmit above. */}
      <SubmitButton pendingText="Saving…" className="button-primary">
        Save measurement
      </SubmitButton>
    </form>
  );
}

function SavedMeasurementsList({
  proposalId,
  measurementGroups,
  measurements,
  canArchive,
}: {
  proposalId: string;
  measurementGroups: ProposalMeasurementGroup[];
  measurements: ProposalMeasurement[];
  canArchive: boolean;
}) {
  if (measurements.length === 0) {
    return <p className="hint">No measurements saved yet. Use Manual entry or Draw layout above.</p>;
  }

  const groupName = (id: string) => measurementGroups.find((g) => g.id === id)?.name ?? "—";

  return (
    <div className="table-card">
      <table>
        <thead>
          <tr>
            <th>Group</th>
            <th>Name</th>
            <th>Type</th>
            <th>Area</th>
            <th>Perimeter</th>
            <th>Linear</th>
            {canArchive ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {measurements.map((m) => (
            <tr key={m.id}>
              <td data-label="Group">{groupName(m.measurement_group_id)}</td>
              <td data-label="Name">{m.name}</td>
              <td data-label="Type">{formatLabel(m.measurement_type)}</td>
              <td data-label="Area">{m.area != null ? `${m.area} sq ${m.unit}` : "—"}</td>
              <td data-label="Perimeter">{m.perimeter != null ? `${m.perimeter} ${m.unit}` : "—"}</td>
              <td data-label="Linear">{m.linear_length != null ? `${m.linear_length} ${m.unit}` : "—"}</td>
              {canArchive ? (
                <td data-label="">
                  <form action={archiveMeasurementAction}>
                    <input type="hidden" name="measurementId" value={m.id} />
                    <input type="hidden" name="proposalId" value={proposalId} />
                    <SubmitButton pendingText="Removing…" className="button-secondary">
                      Remove
                    </SubmitButton>
                  </form>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GenerateMaterialForm({
  proposalId,
  proposalVersionId,
  measurements,
  catalogResults,
  catalogSearch,
  catalogCategory,
  sections,
  canManagePricing,
  pricingZipCode,
}: {
  proposalId: string;
  proposalVersionId: string;
  measurements: ProposalMeasurement[];
  catalogResults: MaterialCatalogSearchResult[];
  catalogSearch: string;
  catalogCategory: string;
  sections: ProposalSection[];
  canManagePricing: boolean;
  pricingZipCode: string | null;
}) {
  const [state, formAction] = useActionState(generateMaterialFromMeasurementAction, initialState);
  const [measurementId, setMeasurementId] = useState(measurements[0]?.id ?? "");
  const selectedMeasurement = measurements.find((m) => m.id === measurementId);
  const [materialId, setMaterialId] = useState(catalogResults[0]?.id ?? "");
  const selectedMaterial = catalogResults.find((r) => r.id === materialId);
  useFocusFirstFieldError(state.fieldErrors);

  const availableFields: { value: string; label: string }[] = [];
  if (selectedMeasurement?.area != null) availableFields.push({ value: "area", label: `Area (${selectedMeasurement.area} sq ${selectedMeasurement.unit})` });
  if (selectedMeasurement?.perimeter != null) availableFields.push({ value: "perimeter", label: `Perimeter (${selectedMeasurement.perimeter} ${selectedMeasurement.unit})` });
  if (selectedMeasurement?.linear_length != null) availableFields.push({ value: "linear_length", label: `Linear length (${selectedMeasurement.linear_length} ${selectedMeasurement.unit})` });

  return (
    <form action={formAction} noValidate className="stack">
      <input type="hidden" name="proposalVersionId" value={proposalVersionId} />
      <input type="hidden" name="proposalId" value={proposalId} />
      <input type="hidden" name="measurementId" value={measurementId} />

      {state.error ? <p className="error-banner">{state.error}</p> : null}

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
          {catalogResults.length === 0 ? <option value="">No catalog results — search below</option> : null}
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
          <input id="genUnitPriceOverride" name="unitPriceOverride" type="text" inputMode="decimal" placeholder={pricingZipCode ? "" : "Set a ZIP in Materials & Costs first"} />
        </div>
      ) : null}

      <SubmitButton pendingText="Generating…" className="button-primary" disabled={measurements.length === 0 || catalogResults.length === 0}>
        Add to proposal
      </SubmitButton>
    </form>
  );
}

function GenerateLaborForm({
  proposalId,
  proposalVersionId,
  measurements,
}: {
  proposalId: string;
  proposalVersionId: string;
  measurements: ProposalMeasurement[];
}) {
  const [state, formAction] = useActionState(addLaborFromMeasurementAction, initialState);
  const [measurementId, setMeasurementId] = useState(measurements[0]?.id ?? "");
  const selectedMeasurement = measurements.find((m) => m.id === measurementId);
  useFocusFirstFieldError(state.fieldErrors);

  const canUseArea = selectedMeasurement?.area != null;
  const canUseLinear = selectedMeasurement?.linear_length != null || selectedMeasurement?.perimeter != null;

  return (
    <form action={formAction} noValidate className="stack">
      <input type="hidden" name="proposalVersionId" value={proposalVersionId} />
      <input type="hidden" name="proposalId" value={proposalId} />
      <input type="hidden" name="measurementId" value={measurementId} />

      {state.error ? <p className="error-banner">{state.error}</p> : null}

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

export function StepMeasurements({
  proposalId,
  proposalVersionId,
  pricingZipCode,
  measurementGroups,
  measurements,
  sections,
  isDraft,
  canView,
  canCreate,
  canArchive,
  canGenerate,
  canManagePricing,
  catalogResults,
  catalogSearch,
  catalogCategory,
}: {
  proposalId: string;
  proposalVersionId: string;
  pricingZipCode: string | null;
  measurementGroups: ProposalMeasurementGroup[];
  measurements: ProposalMeasurement[];
  sections: ProposalSection[];
  isDraft: boolean;
  canView: boolean;
  canCreate: boolean;
  canArchive: boolean;
  canGenerate: boolean;
  canManagePricing: boolean;
  catalogResults: MaterialCatalogSearchResult[];
  catalogSearch: string;
  catalogCategory: string;
}) {
  const [mode, setMode] = useState<"manual" | "draw">("manual");

  if (!canView) {
    return (
      <div className="stack">
        <p className="hint">Your current role does not include access to measurements.</p>
        <div className="tenant-form" style={{ justifyContent: "space-between" }}>
          <Link href={`/proposals/${proposalId}/edit?step=scope`} className="button-primary">
            Continue to Scope of Work
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="section-card stack">
        <h2>Measurements</h2>
        <p className="hint">
          Measure the job area manually or draw a simple layout. Scopevia can use these measurements to estimate labor and
          materials.
        </p>

        {isDraft && canCreate ? <GroupForm proposalId={proposalId} proposalVersionId={proposalVersionId} /> : null}

        {isDraft && canCreate ? (
          <>
            <div className="tenant-form" role="tablist" aria-label="Measurement entry mode">
              <button type="button" className={mode === "manual" ? "button-primary" : "button-secondary"} onClick={() => setMode("manual")}>
                Manual entry
              </button>
              <button type="button" className={mode === "draw" ? "button-primary" : "button-secondary"} onClick={() => setMode("draw")}>
                Draw layout
              </button>
            </div>
            <p className="hint">
              {mode === "manual"
                ? "Measure a room or surface by entering its dimensions."
                : "Sketch the job area with your mouse or finger, then enter a real-world reference length so Scopevia can estimate its area and perimeter."}
            </p>
          </>
        ) : null}

        {isDraft && canCreate && mode === "manual" ? (
          <ManualMeasurementForm proposalId={proposalId} proposalVersionId={proposalVersionId} measurementGroups={measurementGroups} />
        ) : null}

        {isDraft && canCreate && mode === "draw" ? (
          <DrawLayoutCanvas
            proposalId={proposalId}
            proposalVersionId={proposalVersionId}
            measurementGroups={measurementGroups}
            defaultUnit={measurementGroups[0]?.unit_system === "metric" ? "m" : "ft"}
          />
        ) : null}

        <h3>Saved measurements</h3>
        <SavedMeasurementsList
          proposalId={proposalId}
          measurementGroups={measurementGroups}
          measurements={measurements}
          canArchive={isDraft && canArchive}
        />
      </div>

      {isDraft && canGenerate && measurements.length > 0 ? (
        <div className="section-card stack">
          <h2>Generate materials from measurement</h2>
          <p className="hint">
            {pricingZipCode ? (
              `Searching the catalog for ZIP ${pricingZipCode} (set in Materials & Costs).`
            ) : (
              <>
                No ZIP set yet — <Link href={`/proposals/${proposalId}/edit?step=materials`}>set one in Materials &amp; Costs</Link>{" "}
                to see local pricing.
              </>
            )}
          </p>
          <form method="get" action={`/proposals/${proposalId}/edit`} className="tenant-form" style={{ width: "100%" }}>
            <input type="hidden" name="step" value="measurements" />
            <input
              type="search"
              name="catalogSearch"
              aria-label="Search the material catalog"
              placeholder="Search by name, description, brand, or supplier…"
              defaultValue={catalogSearch}
              style={{ flex: 1 }}
            />
            <button type="submit" className="button-secondary">
              Search
            </button>
          </form>
          <GenerateMaterialForm
            proposalId={proposalId}
            proposalVersionId={proposalVersionId}
            measurements={measurements}
            catalogResults={catalogResults}
            catalogSearch={catalogSearch}
            catalogCategory={catalogCategory}
            sections={sections}
            canManagePricing={canManagePricing}
            pricingZipCode={pricingZipCode}
          />

          <h2>Generate labor from measurement</h2>
          <p className="hint">Price labor by a saved measurement&apos;s area or length — useful for jobs quoted per square foot or linear foot, like flooring or painting.</p>
          <GenerateLaborForm proposalId={proposalId} proposalVersionId={proposalVersionId} measurements={measurements} />
        </div>
      ) : null}

      <div className="tenant-form" style={{ justifyContent: "space-between" }}>
        <Link href={`/proposals/${proposalId}/edit?step=scope`} className="button-primary">
          Continue to Scope of Work
        </Link>
      </div>
    </div>
  );
}
