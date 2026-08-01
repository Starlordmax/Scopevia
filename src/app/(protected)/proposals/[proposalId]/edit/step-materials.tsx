"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  addProposalLineItemAction,
  addProposalLineItemFromCatalogAction,
  archiveProposalLineItemAction,
  updateProposalPricingZipAction,
} from "../../../../../actions/proposals";
import type { ActionResult } from "../../../../../actions/auth";
import { SubmitButton } from "../../../../../components/submit-button";
import { computeLineItemTotalCents } from "../../../../../lib/proposals/calculations";
import { formatCents, formatLabel } from "../../../../../lib/proposals/format";
import type { MaterialCatalogSearchResult } from "../../../../../lib/proposals/materials";
import type { Database } from "../../../../../../types/database";

type ProposalLineItem = Database["public"]["Tables"]["proposal_line_items"]["Row"];
type ProposalSection = Database["public"]["Tables"]["proposal_sections"]["Row"];

const CATEGORIES = ["material", "equipment", "subcontractor", "travel", "disposal", "additional_service", "allowance", "other"];
const UNITS = ["each", "hour", "day", "gallon", "sq_ft", "linear_ft", "fixed"];
const MATERIAL_CATEGORIES = [
  "paint",
  "primer",
  "tape",
  "brushes",
  "rollers",
  "drop_cloths",
  "drywall",
  "tile",
  "flooring",
  "wood",
  "plumbing",
  "electrical",
  "hardware",
  "disposal",
  "other",
];

const initialState: ActionResult = {};

/** Just the ZIP form + warning — no heading/card of its own; rendered as
 * one part of the single "Material pricing" panel in StepMaterials. */
function ZipForm({ proposalId, proposalVersionId, pricingZipCode }: { proposalId: string; proposalVersionId: string; pricingZipCode: string | null }) {
  const [state, formAction] = useActionState(updateProposalPricingZipAction, initialState);

  return (
    <div className="stack" style={{ gap: 4 }}>
      {state.error ? <p className="error-banner">{state.error}</p> : null}
      <form action={formAction} className="tenant-form" style={{ width: "100%" }}>
        <input type="hidden" name="proposalVersionId" value={proposalVersionId} />
        <input type="hidden" name="proposalId" value={proposalId} />
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="zipCode">ZIP code</label>
          <input id="zipCode" name="zipCode" type="text" inputMode="numeric" maxLength={5} defaultValue={pricingZipCode ?? ""} placeholder="e.g. 33101" />
          <span className="hint">Used to price catalog materials for this proposal.</span>
        </div>
        <SubmitButton pendingText="Saving…" className="button-secondary">
          Save ZIP
        </SubmitButton>
      </form>
      {/* Set once, at proposal creation, from the client's own address (see
          create_proposal_direct()) if it looked like a valid 5-digit US
          ZIP — never re-applied afterward, so a manual change here is
          never overwritten. This hint can't perfectly distinguish
          "still the client's ZIP" from "user already changed it to the
          same value" without extra tracking, so it's phrased generically
          enough to stay accurate either way — see
          docs/73-client-address-and-material-zip-defaults.md. */}
      <p className="hint">
        {pricingZipCode
          ? "Using ZIP code from the client address. You can change it for this proposal."
          : "Enter the job ZIP code to price materials for this area."}
      </p>
      <p className="hint">
        <strong>Changing ZIP code only affects new materials you add. Existing proposal items keep their saved prices.</strong>
      </p>
    </div>
  );
}

/** Just the search/category form — no heading/card of its own. A plain
 * GET form: Enter in the search box submits it natively, no JS needed. */
function CatalogSearchForm({ proposalId, catalogSearch, catalogCategory }: { proposalId: string; catalogSearch: string; catalogCategory: string }) {
  return (
    <form method="get" action={`/proposals/${proposalId}/edit`} className="tenant-form" style={{ width: "100%" }}>
      <input type="hidden" name="step" value="materials" />
      <input
        type="search"
        name="catalogSearch"
        aria-label="Search the material catalog"
        placeholder="Search by name, description, brand, or supplier…"
        defaultValue={catalogSearch}
        style={{ flex: 1 }}
      />
      <select name="catalogCategory" aria-label="Category" defaultValue={catalogCategory} style={{ flex: "0 0 auto" }}>
        <option value="">All categories</option>
        {MATERIAL_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c.replace(/_/g, " ")}
          </option>
        ))}
      </select>
      <button type="submit" className="button-secondary">
        Search
      </button>
    </form>
  );
}

function CatalogResultRow({
  proposalId,
  proposalVersionId,
  sections,
  result,
  canAddFromCatalog,
  canManagePricing,
}: {
  proposalId: string;
  proposalVersionId: string;
  sections: ProposalSection[];
  result: MaterialCatalogSearchResult;
  canAddFromCatalog: boolean;
  canManagePricing: boolean;
}) {
  const [state, formAction] = useActionState(addProposalLineItemFromCatalogAction, initialState);
  const hasPrice = result.unit_price_cents !== null;

  return (
    <tr>
      <td data-label="Name">
        {result.name}
        {result.description ? <div className="hint">{result.description}</div> : null}
      </td>
      <td data-label="Unit">{formatLabel(result.default_unit)}</td>
      <td data-label="Supplier">{result.price_supplier_name ?? result.supplier_name ?? "—"}</td>
      <td data-label="Price">
        {hasPrice ? (
          <>
            {formatCents(result.unit_price_cents!)}
            {result.price_zip_code ? null : result.price_state_code ? <div className="hint">state default</div> : <div className="hint">default price</div>}
          </>
        ) : (
          <span className="hint">No price available for this ZIP</span>
        )}
      </td>
      <td data-label="Add">
        {canAddFromCatalog ? (
          <form action={formAction} className="stack" style={{ gap: 4 }}>
            <input type="hidden" name="proposalVersionId" value={proposalVersionId} />
            <input type="hidden" name="proposalId" value={proposalId} />
            <input type="hidden" name="materialCatalogItemId" value={result.id} />
            {state.error ? <p className="error-banner">{state.error}</p> : null}
            <div className="tenant-form" style={{ width: "100%" }}>
              <input
                type="number"
                name="quantity"
                min={0.001}
                step={0.001}
                defaultValue={1}
                required
                style={{ width: 80 }}
                aria-label={`Quantity — ${result.name}`}
              />
              {sections.length > 0 ? (
                <select name="sectionId" defaultValue="" aria-label={`Section — ${result.name}`} style={{ flex: "0 0 auto" }}>
                  <option value="">No section</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              ) : null}
              {canManagePricing ? (
                <input type="text" name="unitPriceOverride" inputMode="decimal" placeholder="Override price ($)" style={{ width: 160 }} />
              ) : null}
              <SubmitButton pendingText="Adding…" className="button-primary" disabled={!hasPrice && !canManagePricing}>
                Add to proposal
              </SubmitButton>
            </div>
          </form>
        ) : null}
      </td>
    </tr>
  );
}

function MaterialPricingPanel({
  proposalId,
  proposalVersionId,
  pricingZipCode,
  sections,
  canAddFromCatalog,
  canManagePricing,
  catalogResults,
  catalogSearch,
  catalogCategory,
  catalogTotalCount,
  catalogHasMore,
  catalogLimit,
  catalogPageSize,
}: {
  proposalId: string;
  proposalVersionId: string;
  pricingZipCode: string | null;
  sections: ProposalSection[];
  canAddFromCatalog: boolean;
  canManagePricing: boolean;
  catalogResults: MaterialCatalogSearchResult[];
  catalogSearch: string;
  catalogCategory: string;
  catalogTotalCount: number;
  catalogHasMore: boolean;
  catalogLimit: number;
  catalogPageSize: number;
}) {
  const hasResults = catalogResults.length > 0;
  const hasAnyPrice = catalogResults.some((r) => r.unit_price_cents !== null);
  const categoryLabel = catalogCategory ? catalogCategory.replace(/_/g, " ") : "";

  // Three distinct empty/hint states — never the same generic message for
  // different underlying reasons (no ZIP yet, no matching materials at
  // all, or materials matched but none priced for this ZIP).
  let resultsHeading: string;
  if (pricingZipCode && categoryLabel) {
    resultsHeading = `Showing ${categoryLabel} materials for ZIP ${pricingZipCode}`;
  } else if (pricingZipCode) {
    resultsHeading = `Results for ZIP ${pricingZipCode}`;
  } else {
    resultsHeading = "Results";
  }

  return (
    <div className="section-card stack">
      <h2>Material pricing</h2>

      <ZipForm proposalId={proposalId} proposalVersionId={proposalVersionId} pricingZipCode={pricingZipCode} />

      <h3 style={{ marginBottom: 0 }}>Search materials</h3>
      <CatalogSearchForm proposalId={proposalId} catalogSearch={catalogSearch} catalogCategory={catalogCategory} />

      <h3 style={{ marginBottom: 0 }}>{resultsHeading}</h3>
      {hasResults ? (
        <p className="hint">
          Showing {catalogResults.length} of {catalogTotalCount} {catalogTotalCount === 1 ? "material" : "materials"}.
        </p>
      ) : null}

      {!hasResults ? (
        !pricingZipCode ? (
          <p className="hint">Enter a ZIP code to load material pricing.</p>
        ) : (
          <p className="hint">No materials match your search for this ZIP code. Try a different keyword, category, or add a custom cost below.</p>
        )
      ) : (
        <>
          {pricingZipCode && !hasAnyPrice ? (
            <p className="hint">No price is available for these materials in this ZIP code. Try another ZIP code or add a custom cost.</p>
          ) : null}
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Unit</th>
                  <th>Supplier</th>
                  <th>Price</th>
                  <th>Add</th>
                </tr>
              </thead>
              <tbody>
                {catalogResults.map((result) => (
                  <CatalogResultRow
                    key={result.id}
                    proposalId={proposalId}
                    proposalVersionId={proposalVersionId}
                    sections={sections}
                    result={result}
                    canAddFromCatalog={canAddFromCatalog}
                    canManagePricing={canManagePricing}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {catalogHasMore ? (
            <form method="get" action={`/proposals/${proposalId}/edit`}>
              <input type="hidden" name="step" value="materials" />
              <input type="hidden" name="catalogSearch" value={catalogSearch} />
              <input type="hidden" name="catalogCategory" value={catalogCategory} />
              <input type="hidden" name="catalogLimit" value={catalogLimit + catalogPageSize} />
              <button type="submit" className="button-secondary" style={{ width: "100%" }}>
                Load more materials
              </button>
            </form>
          ) : null}
        </>
      )}
    </div>
  );
}

export function StepMaterials({
  proposalId,
  proposalVersionId,
  pricingZipCode,
  lineItems,
  sections,
  lineItemsSubtotalCents,
  canViewMaterials,
  canAddFromCatalog,
  canManagePricing,
  isDraft,
  catalogResults,
  catalogSearch,
  catalogCategory,
  catalogTotalCount,
  catalogHasMore,
  catalogLimit,
  catalogPageSize,
}: {
  proposalId: string;
  proposalVersionId: string;
  pricingZipCode: string | null;
  lineItems: ProposalLineItem[];
  sections: ProposalSection[];
  lineItemsSubtotalCents: number;
  canViewMaterials: boolean;
  canAddFromCatalog: boolean;
  canManagePricing: boolean;
  isDraft: boolean;
  catalogResults: MaterialCatalogSearchResult[];
  catalogSearch: string;
  catalogCategory: string;
  catalogTotalCount: number;
  catalogHasMore: boolean;
  catalogLimit: number;
  catalogPageSize: number;
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
      {isDraft && canViewMaterials ? (
        <MaterialPricingPanel
          proposalId={proposalId}
          proposalVersionId={proposalVersionId}
          pricingZipCode={pricingZipCode}
          sections={sections}
          canAddFromCatalog={canAddFromCatalog}
          canManagePricing={canManagePricing}
          catalogResults={catalogResults}
          catalogSearch={catalogSearch}
          catalogCategory={catalogCategory}
          catalogTotalCount={catalogTotalCount}
          catalogHasMore={catalogHasMore}
          catalogLimit={catalogLimit}
          catalogPageSize={catalogPageSize}
        />
      ) : null}

      <div className="section-card stack">
        <h2>Add a custom cost</h2>
        <p className="hint">For anything not in the material catalog — equipment, subcontractor fees, travel, disposal, etc.</p>

        {canManagePricing ? (
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
      </div>

      <div className="section-card stack">
        <h3>Saved costs</h3>

        {lineItems.length === 0 ? (
          <p className="hint">No materials or additional costs saved yet.</p>
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
                  {canManagePricing ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Description">
                      {item.description}
                      {item.source_type === "catalog" ? (
                        <div className="hint">via catalog{item.source_zip_code ? ` — ZIP ${item.source_zip_code}` : ""}</div>
                      ) : null}
                    </td>
                    <td data-label="Category">{item.category.replace(/_/g, " ")}</td>
                    <td data-label="Qty">
                      {item.quantity} {item.unit.replace(/_/g, " ")}
                    </td>
                    <td data-label="Unit price">{formatCents(item.unit_price_cents)}</td>
                    <td data-label="Taxable">{item.taxable ? "Yes" : "No"}</td>
                    <td data-label="Total">
                      <strong>{formatCents(item.line_total_cents)}</strong>
                    </td>
                    {canManagePricing ? (
                      <td data-label="">
                        <form action={archiveProposalLineItemAction}>
                          <input type="hidden" name="lineItemId" value={item.id} />
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
