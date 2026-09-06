"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { createMeasurementGroupAction, addMeasurementAction, archiveMeasurementAction } from "../../../../../actions/measurements";
import type { ActionResult } from "../../../../../actions/auth";
import { SubmitButton } from "../../../../../components/submit-button";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../../../../components/form-field-error";
import { computeRectangle, computeWallArea } from "../../../../../lib/proposals/measurements";
import { formatLabel } from "../../../../../lib/proposals/format";
import { DrawLayoutCanvas } from "./draw-layout-canvas";
import type { Database } from "../../../../../../types/database";

type ProposalMeasurementGroup = Database["public"]["Tables"]["proposal_measurement_groups"]["Row"];
type ProposalMeasurement = Database["public"]["Tables"]["proposal_measurements"]["Row"];

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

function GroupForm({
  proposalId,
  proposalVersionId,
  measurementGroups,
}: {
  proposalId: string;
  proposalVersionId: string;
  measurementGroups: ProposalMeasurementGroup[];
}) {
  const [state, formAction] = useActionState(createMeasurementGroupAction, initialState);
  useFocusFirstFieldError(state.fieldErrors);
  // Proactive nudge, not a failed-submit error: nothing works in
  // Measurements yet (Save is disabled everywhere) until at least one
  // group exists, so draw the eye here first instead of leaving the
  // user to discover it only after drawing/measuring something and
  // hitting the red state on Save (see docs/76, "Addendum").
  const noGroupsYet = measurementGroups.length === 0;
  const nameErrorProps = fieldErrorProps(state.fieldErrors, "name");
  const hasRealNameError = Boolean(state.fieldErrors?.name);
  const showProactiveHint = noGroupsYet && !hasRealNameError;
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
        <input
          id="groupName"
          name="name"
          type="text"
          placeholder="e.g. Bathroom"
          className={nameErrorProps.className ?? (noGroupsYet ? "field-input-error" : undefined)}
          aria-invalid={nameErrorProps["aria-invalid"]}
          aria-describedby={nameErrorProps["aria-describedby"] ?? (showProactiveHint ? "groupName-hint" : undefined)}
        />
        <FieldError fieldErrors={state.fieldErrors} id="name" />
        {showProactiveHint ? (
          <p id="groupName-hint" className="field-error-text">
            Create a group before you can save any measurement.
          </p>
        ) : null}
      </div>
      <div className="field" style={{ flex: "0 0 auto" }}>
        <label htmlFor="groupUnitSystem">Units</label>
        <select id="groupUnitSystem" name="unitSystem" defaultValue="imperial">
          <option value="imperial">Feet (imperial)</option>
          <option value="metric">Meters (metric)</option>
        </select>
      </div>
      <SubmitButton pendingText="Creating…" className={noGroupsYet ? "button-secondary button-attention-blink" : "button-secondary"}>
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
      {state.message ? <p className="success-banner">{state.message}</p> : null}

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

export function StepMeasurements({
  proposalId,
  proposalVersionId,
  measurementGroups,
  measurements,
  isDraft,
  canView,
  canCreate,
  canArchive,
}: {
  proposalId: string;
  proposalVersionId: string;
  measurementGroups: ProposalMeasurementGroup[];
  measurements: ProposalMeasurement[];
  isDraft: boolean;
  canView: boolean;
  canCreate: boolean;
  canArchive: boolean;
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

        {isDraft && canCreate ? (
          <GroupForm proposalId={proposalId} proposalVersionId={proposalVersionId} measurementGroups={measurementGroups} />
        ) : null}

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
        {measurements.length > 0 ? (
          <p className="hint">Use these saved measurements later in Labor and Materials &amp; Costs.</p>
        ) : null}
      </div>

      <div className="tenant-form" style={{ justifyContent: "space-between" }}>
        <Link href={`/proposals/${proposalId}/edit?step=scope`} className="button-primary">
          Continue to Scope of Work
        </Link>
      </div>
    </div>
  );
}
