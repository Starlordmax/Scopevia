"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { addProposalLaborItemAction, archiveProposalLaborItemAction } from "../../../../../actions/proposals";
import type { ActionResult } from "../../../../../actions/auth";
import { SubmitButton } from "../../../../../components/submit-button";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../../../../components/form-field-error";
import { computeLaborHours, computeLaborTotalCents } from "../../../../../lib/proposals/calculations";
import { formatCents } from "../../../../../lib/proposals/format";
import type { Database } from "../../../../../../types/database";

type ProposalLaborItem = Database["public"]["Tables"]["proposal_labor_items"]["Row"];

const initialState: ActionResult = {};

function laborItemDetails(item: ProposalLaborItem): string {
  if (item.pricing_method === "fixed") return "Fixed price";
  return `${item.worker_count} × ${item.estimated_days}d × ${item.hours_per_day}h/day @ ${formatCents(item.hourly_rate_cents ?? 0)}/hr`;
}

export function StepLabor({
  proposalId,
  proposalVersionId,
  laborItems,
  defaultHourlyRateCents,
  laborTotalCents,
  canEdit,
}: {
  proposalId: string;
  proposalVersionId: string;
  laborItems: ProposalLaborItem[];
  defaultHourlyRateCents: number;
  laborTotalCents: number;
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState(addProposalLaborItemAction, initialState);
  const [pricingMethod, setPricingMethod] = useState<"hourly" | "fixed">("hourly");
  const [workerCount, setWorkerCount] = useState(1);
  const [estimatedDays, setEstimatedDays] = useState(1);
  const [hoursPerDay, setHoursPerDay] = useState(8);
  const [hourlyRate, setHourlyRate] = useState((defaultHourlyRateCents / 100).toFixed(2));
  const [fixedPrice, setFixedPrice] = useState("");
  useFocusFirstFieldError(state.fieldErrors);

  // Orientative only — the value that actually saves comes back from the
  // server's recalculate_proposal_version(). See docs/34-proposal-builder-ux.md
  // and docs/40-proposal-total-refresh-fix.md for why this must never be
  // mistaken for a saved value: nothing below is persisted until "+ Add
  // labor item" is clicked.
  const previewHours =
    pricingMethod === "hourly"
      ? computeLaborHours({
          pricingMethod: "hourly",
          workerCount,
          estimatedDays,
          hoursPerDay,
          hourlyRateCents: Math.round(parseFloat(hourlyRate || "0") * 100),
        })
      : 0;
  const previewCents =
    pricingMethod === "hourly"
      ? computeLaborTotalCents({
          pricingMethod: "hourly",
          workerCount,
          estimatedDays,
          hoursPerDay,
          hourlyRateCents: Math.round(parseFloat(hourlyRate || "0") * 100),
        })
      : computeLaborTotalCents({ pricingMethod: "fixed", fixedTotalCents: Math.round(parseFloat(fixedPrice || "0") * 100) });

  return (
    <div className="stack">
      <div className="section-card stack">
        <h2>Labor</h2>

        {canEdit ? (
          <>
            {state.error ? <p className="error-banner">{state.error}</p> : null}

            <div className="field">
              <label>How do you want to price labor?</label>
              <div className="pricing-method-toggle" role="radiogroup" aria-label="Labor pricing method">
                <button
                  type="button"
                  className={pricingMethod === "hourly" ? "button-primary" : "button-secondary"}
                  aria-pressed={pricingMethod === "hourly"}
                  onClick={() => setPricingMethod("hourly")}
                >
                  Hourly estimate
                </button>
                <button
                  type="button"
                  className={pricingMethod === "fixed" ? "button-primary" : "button-secondary"}
                  aria-pressed={pricingMethod === "fixed"}
                  onClick={() => setPricingMethod("fixed")}
                >
                  Fixed price
                </button>
              </div>
              <span className="hint">
                Use hourly estimate when you know your crew size and how long the job will take. Use fixed price when
                you already know what you want to charge for labor.
              </span>
            </div>

            <form action={formAction} className="stack">
              <input type="hidden" name="proposalVersionId" value={proposalVersionId} />
              <input type="hidden" name="proposalId" value={proposalId} />
              <input type="hidden" name="pricingMethod" value={pricingMethod} />

              <div className="field">
                <label htmlFor="label">Label</label>
                <input
                  id="label"
                  name="label"
                  type="text"
                  placeholder={pricingMethod === "hourly" ? "e.g. Lead painter, Remodeling crew" : "e.g. Bathroom remodeling labor"}
                  {...fieldErrorProps(state.fieldErrors, "label")}
                />
                <FieldError fieldErrors={state.fieldErrors} id="label" />
              </div>

              {pricingMethod === "hourly" ? (
                <div className="tenant-form" style={{ width: "100%" }}>
                  <div className="field" style={{ flex: 1 }}>
                    <label htmlFor="workerCount">Workers</label>
                    <input
                      id="workerCount"
                      name="workerCount"
                      type="number"
                      min={1}
                      value={workerCount}
                      onChange={(e) => setWorkerCount(Number(e.target.value) || 0)}
                      {...fieldErrorProps(state.fieldErrors, "workerCount")}
                    />
                    <FieldError fieldErrors={state.fieldErrors} id="workerCount" />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label htmlFor="estimatedDays">Days</label>
                    <input
                      id="estimatedDays"
                      name="estimatedDays"
                      type="number"
                      min={0.5}
                      step={0.5}
                      value={estimatedDays}
                      onChange={(e) => setEstimatedDays(Number(e.target.value) || 0)}
                      {...fieldErrorProps(state.fieldErrors, "estimatedDays")}
                    />
                    <FieldError fieldErrors={state.fieldErrors} id="estimatedDays" />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label htmlFor="hoursPerDay">Hours/day</label>
                    <input
                      id="hoursPerDay"
                      name="hoursPerDay"
                      type="number"
                      min={0.5}
                      max={24}
                      step={0.5}
                      value={hoursPerDay}
                      onChange={(e) => setHoursPerDay(Number(e.target.value) || 0)}
                      {...fieldErrorProps(state.fieldErrors, "hoursPerDay")}
                    />
                    <FieldError fieldErrors={state.fieldErrors} id="hoursPerDay" />
                  </div>
                </div>
              ) : null}

              {pricingMethod === "hourly" ? (
                <div className="field">
                  {/* id is "hourlyRateCents" (not "hourlyRate") to match
                      the Zod schema's field name; `name` stays
                      "hourlyRate" for the Server Action's FormData read. */}
                  <label htmlFor="hourlyRateCents">Rate per hour ($)</label>
                  <input
                    id="hourlyRateCents"
                    name="hourlyRate"
                    type="text"
                    inputMode="decimal"
                    value={hourlyRate}
                    onChange={(e) => setHourlyRate(e.target.value)}
                    {...fieldErrorProps(state.fieldErrors, "hourlyRateCents")}
                  />
                  <FieldError fieldErrors={state.fieldErrors} id="hourlyRateCents" />
                </div>
              ) : (
                <div className="field">
                  {/* id is "fixedTotalCents" (not "fixedPrice") to match
                      the Zod schema's field name; `name` stays
                      "fixedPrice" for the Server Action's FormData read. */}
                  <label htmlFor="fixedTotalCents">Fixed labor price ($)</label>
                  <input
                    id="fixedTotalCents"
                    name="fixedPrice"
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 700.00"
                    value={fixedPrice}
                    onChange={(e) => setFixedPrice(e.target.value)}
                    {...fieldErrorProps(state.fieldErrors, "fixedTotalCents")}
                  />
                  <FieldError fieldErrors={state.fieldErrors} id="fixedTotalCents" />
                  <span className="hint">You&apos;re entering the total labor cost directly — no hourly calculation.</span>
                </div>
              )}

              <div className="metric-tile unsaved-preview-tile" style={{ maxWidth: 360 }}>
                <div className="metric-tile-value">{formatCents(previewCents)}</div>
                <div className="metric-tile-label">
                  {pricingMethod === "hourly" ? `${previewHours} labor hours — ` : ""}
                  <strong>Not saved yet.</strong> Click &quot;+ Add labor item&quot; below to save it.
                </div>
              </div>

              <SubmitButton pendingText="Saving…" className="button-primary">
                + Add labor item
              </SubmitButton>
            </form>
          </>
        ) : null}

        <h3>Saved labor</h3>

        {laborItems.length === 0 ? (
          <p className="hint">No labor items saved yet. Fill in the form above and click &quot;+ Add labor item&quot;.</p>
        ) : (
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Details</th>
                  <th>Total hours</th>
                  <th>Total</th>
                  {canEdit ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {laborItems.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Label">{item.label}</td>
                    <td data-label="Details">{laborItemDetails(item)}</td>
                    <td data-label="Total hours">{item.pricing_method === "fixed" ? "—" : item.total_hours}</td>
                    <td data-label="Total">
                      <strong>{formatCents(item.total_cents)}</strong>
                    </td>
                    {canEdit ? (
                      <td data-label="">
                        <form action={archiveProposalLaborItemAction}>
                          <input type="hidden" name="laborItemId" value={item.id} />
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
        )}

        <p className="hint">
          Saved labor total: <strong>{formatCents(laborTotalCents)}</strong>
        </p>
      </div>

      <div className="tenant-form" style={{ justifyContent: "space-between" }}>
        <Link href={`/proposals/${proposalId}/edit?step=scope`} className="button-secondary">
          Back
        </Link>
        <Link href={`/proposals/${proposalId}/edit?step=materials`} className="button-primary">
          Continue to Materials & Costs
        </Link>
      </div>
    </div>
  );
}
