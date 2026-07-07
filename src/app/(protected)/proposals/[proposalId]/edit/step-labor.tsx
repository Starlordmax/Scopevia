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
  const [workerCount, setWorkerCount] = useState(1);
  const [estimatedDays, setEstimatedDays] = useState(1);
  const [hoursPerDay, setHoursPerDay] = useState(8);
  const [hourlyRate, setHourlyRate] = useState((defaultHourlyRateCents / 100).toFixed(2));

  // Orientative only — the value that actually saves comes back from the
  // server's recalculate_proposal_version(). See docs/34-proposal-builder-ux.md.
  const previewHours = computeLaborHours({
    workerCount,
    estimatedDays,
    hoursPerDay,
    hourlyRateCents: Math.round(parseFloat(hourlyRate || "0") * 100),
  });
  const previewCents = computeLaborTotalCents({
    workerCount,
    estimatedDays,
    hoursPerDay,
    hourlyRateCents: Math.round(parseFloat(hourlyRate || "0") * 100),
  });

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
                  <th>Workers</th>
                  <th>Days</th>
                  <th>Hours/day</th>
                  <th>Rate</th>
                  <th>Total hours</th>
                  <th>Total</th>
                  {canEdit ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {laborItems.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Label">{item.label}</td>
                    <td data-label="Workers">{item.worker_count}</td>
                    <td data-label="Days">{item.estimated_days}</td>
                    <td data-label="Hours/day">{item.hours_per_day}</td>
                    <td data-label="Rate">{formatCents(item.hourly_rate_cents)}/hr</td>
                    <td data-label="Total hours">{item.total_hours}</td>
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
            <form action={formAction} className="stack">
              <input type="hidden" name="proposalVersionId" value={proposalVersionId} />
              <input type="hidden" name="proposalId" value={proposalId} />

              <div className="field">
                <label htmlFor="label">Label</label>
                <input id="label" name="label" type="text" required placeholder="e.g. Lead painter, Remodeling crew" />
              </div>

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

              <div className="metric-tile" style={{ maxWidth: 320 }}>
                <div className="metric-tile-value">{formatCents(previewCents)}</div>
                <div className="metric-tile-label">{previewHours} labor hours (preview — server confirms on save)</div>
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
