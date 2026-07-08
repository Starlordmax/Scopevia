"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { addProposalLineItemAction, archiveProposalLineItemAction } from "../../../../../actions/proposals";
import type { ActionResult } from "../../../../../actions/auth";
import { SubmitButton } from "../../../../../components/submit-button";
import { computeLineItemTotalCents } from "../../../../../lib/proposals/calculations";
import { formatCents } from "../../../../../lib/proposals/format";
import type { Database } from "../../../../../../types/database";

type ProposalLineItem = Database["public"]["Tables"]["proposal_line_items"]["Row"];
type ProposalSection = Database["public"]["Tables"]["proposal_sections"]["Row"];

const CATEGORIES = ["material", "equipment", "subcontractor", "travel", "disposal", "additional_service", "allowance", "other"];
const UNITS = ["each", "hour", "day", "gallon", "sq_ft", "linear_ft", "fixed"];

const initialState: ActionResult = {};

export function StepMaterials({
  proposalId,
  proposalVersionId,
  lineItems,
  sections,
  lineItemsSubtotalCents,
  canEdit,
}: {
  proposalId: string;
  proposalVersionId: string;
  lineItems: ProposalLineItem[];
  sections: ProposalSection[];
  lineItemsSubtotalCents: number;
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState(addProposalLineItemAction, initialState);
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");

  const previewTotal = computeLineItemTotalCents({
    quantity: parseFloat(quantity) || 0,
    unitPriceCents: Math.round((parseFloat(unitPrice) || 0) * 100),
    taxable: true,
  });

  return (
    <div className="stack">
      <div className="section-card stack">
        <h2>Materials &amp; Costs</h2>

        {canEdit ? (
          <>
            {state.error ? <p className="error-banner">{state.error}</p> : null}
            <form action={formAction} className="stack">
              <input type="hidden" name="proposalVersionId" value={proposalVersionId} />
              <input type="hidden" name="proposalId" value={proposalId} />

              <div className="field">
                <label htmlFor="description">Description</label>
                <input id="description" name="description" type="text" required placeholder="e.g. Sherwin-Williams exterior paint" />
              </div>

              <div className="tenant-form" style={{ width: "100%" }}>
                <div className="field" style={{ flex: 1 }}>
                  <label htmlFor="category">Category</label>
                  <select id="category" name="category" defaultValue="material">
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label htmlFor="unit">Unit</label>
                  <select id="unit" name="unit" defaultValue="each">
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {sections.length > 0 ? (
                <div className="field">
                  <label htmlFor="sectionId">Section (optional)</label>
                  <select id="sectionId" name="sectionId" defaultValue="">
                    <option value="">No specific section</option>
                    {sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="tenant-form" style={{ width: "100%" }}>
                <div className="field" style={{ flex: 1 }}>
                  <label htmlFor="quantity">Quantity</label>
                  <input
                    id="quantity"
                    name="quantity"
                    type="number"
                    min={0.001}
                    step={0.001}
                    required
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label htmlFor="unitPrice">Unit price ($)</label>
                  <input
                    id="unitPrice"
                    name="unitPrice"
                    type="text"
                    inputMode="decimal"
                    required
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(e.target.value)}
                  />
                </div>
              </div>

              <div className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input id="taxable" name="taxable" type="checkbox" defaultChecked />
                <label htmlFor="taxable" style={{ margin: 0 }}>
                  Taxable
                </label>
              </div>

              <div className="metric-tile unsaved-preview-tile" style={{ maxWidth: 360 }}>
                <div className="metric-tile-value">{formatCents(previewTotal)}</div>
                <div className="metric-tile-label">
                  <strong>Not saved yet.</strong> Click &quot;+ Add cost item&quot; below to save it.
                </div>
              </div>

              <SubmitButton pendingText="Saving…" className="button-primary">
                + Add cost item
              </SubmitButton>
            </form>
          </>
        ) : null}

        <h3>Saved costs</h3>

        {lineItems.length === 0 ? (
          <p className="hint">No materials or additional costs saved yet. Fill in the form above and click &quot;+ Add cost item&quot;.</p>
        ) : (
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Qty</th>
                  <th>Unit price</th>
                  <th>Taxable</th>
                  <th>Total</th>
                  {canEdit ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Description">{item.description}</td>
                    <td data-label="Category">{item.category.replace(/_/g, " ")}</td>
                    <td data-label="Qty">
                      {item.quantity} {item.unit.replace(/_/g, " ")}
                    </td>
                    <td data-label="Unit price">{formatCents(item.unit_price_cents)}</td>
                    <td data-label="Taxable">{item.taxable ? "Yes" : "No"}</td>
                    <td data-label="Total">
                      <strong>{formatCents(item.line_total_cents)}</strong>
                    </td>
                    {canEdit ? (
                      <td data-label="">
                        <form action={archiveProposalLineItemAction}>
                          <input type="hidden" name="lineItemId" value={item.id} />
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
          Saved materials &amp; costs subtotal: <strong>{formatCents(lineItemsSubtotalCents)}</strong>
        </p>
      </div>

      <div className="tenant-form" style={{ justifyContent: "space-between" }}>
        <Link href={`/proposals/${proposalId}/edit?step=labor`} className="button-secondary">
          Back
        </Link>
        <Link href={`/proposals/${proposalId}/edit?step=photos`} className="button-primary">
          Continue to Photos
        </Link>
      </div>
    </div>
  );
}
