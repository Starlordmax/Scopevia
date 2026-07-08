"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { addProposalLaborItemAction, archiveProposalLaborItemAction } from "../../../../../actions/proposals";
import type { ActionResult } from "../../../../../actions/auth";
import { SubmitButton } from "../../../../../components/submit-button";
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

  // Orientative only — the value that actually saves comes back from the
  // server's recalculate_proposal_version(). See docs/34-proposal-builder-ux.md.
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

        {laborItems.length === 0 ? (
          <p className="hint">No labor items yet. Add your crew below.</p>
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
                          <button type="submit" className="button-secondary">
                            Remove
                          </button>
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
          Labor total: <strong>{formatCents(laborTotalCents)}</strong>
        </p>

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
                  required
                  placeholder={pricingMethod === "hourly" ? "e.g. Lead painter, Remodeling crew" : "e.g. Bathroom remodeling labor"}
                />
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
                      required
                      value={workerCount}
                      onChange={(e) => setWorkerCount(Number(e.target.value) || 0)}
                    />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label htmlFor="estimatedDays">Days</label>
                    <input
                      id="estimatedDays"
                      name="estimatedDays"
                      type="number"
                      min={0.5}
                      step={0.5}
                      required
                      value={estimatedDays}
                      onChange={(e) => setEstimatedDays(Number(e.target.value) || 0)}
                    />
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
                      required
                      value={hoursPerDay}
                      onChange={(e) => setHoursPerDay(Number(e.target.value) || 0)}
                    />
                  </div>
                </div>
              ) : null}

              {pricingMethod === "hourly" ? (
                <div className="field">
                  <label htmlFor="hourlyRate">Rate per hour ($)</label>
                  <input
                    id="hourlyRate"
                    name="hourlyRate"
                    type="text"
                    inputMode="decimal"
                    required
                    value={hourlyRate}
                    onChange={(e) => setHourlyRate(e.target.value)}
                  />
                </div>
              ) : (
                <div className="field">
                  <label htmlFor="fixedPrice">Fixed labor price ($)</label>
                  <input
                    id="fixedPrice"
                    name="fixedPrice"
                    type="text"
                    inputMode="decimal"
                    required
                    placeholder="e.g. 700.00"
                    value={fixedPrice}
                    onChange={(e) => setFixedPrice(e.target.value)}
                  />
                  <span className="hint">You&apos;re entering the total labor cost directly — no hourly calculation.</span>
                </div>
              )}

              <div className="metric-tile" style={{ maxWidth: 320 }}>
                <div className="metric-tile-value">{formatCents(previewCents)}</div>
                <div className="metric-tile-label">
                  {pricingMethod === "hourly" ? `${previewHours} labor hours (preview — server confirms on save)` : "Labor total (preview — server confirms on save)"}
                </div>
              </div>

              <SubmitButton pendingText="Adding…" className="button-secondary">
                + Add labor item
              </SubmitButton>
            </form>
          </>
        ) : null}
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
