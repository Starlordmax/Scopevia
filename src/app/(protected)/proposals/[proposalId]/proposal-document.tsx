import { formatCents, formatLabel } from "../../../../lib/proposals/format";
import { acceptanceRecordFootnote, imageUnavailableLabel } from "../../../../lib/proposals/export-copy";
import { resolveLogoDisplay } from "../../../../lib/branding/logo-display";
import type { FullProposal } from "../../../../lib/proposals/data";
import type { ProposalClientResponse } from "../../../../lib/portal/data";

const SERVICE_TYPE_LABELS: Record<string, string> = {
  interior_painting: "Interior painting",
  exterior_painting: "Exterior painting",
  bathroom_remodeling: "Bathroom remodeling",
  general_remodeling: "General remodeling",
  flooring: "Flooring",
  custom: "Custom",
};

/**
 * The proposal as a professional commercial document — order fixed per
 * docs/34-proposal-builder-ux.md. No internal IDs, storage paths, or
 * technical metadata are ever rendered here. Shared by the builder's Review
 * step, the standalone /preview route, the Phase 3C print/export routes, and
 * the Client Portal so every surface always shows identical content for a
 * given proposal_version — see docs/60-proposal-pdf-print-export.md.
 *
 * `clientResponse` is optional and omitted entirely when there is none —
 * see docs/60, "Client response section."
 */
export function ProposalDocument({
  businessName,
  logoUrl,
  data,
  clientResponse,
}: {
  businessName: string;
  logoUrl?: string | null;
  data: FullProposal;
  clientResponse?: ProposalClientResponse | null;
}) {
  const { proposal, version, sections, laborItems, lineItems, currentJobMedia, previousWorkMedia, measurements, measurementMaterials, measurementGroups } = data;
  const preparedFor = proposal.clients?.display_name ?? "Client";
  const contactName = proposal.client_contacts ? [proposal.client_contacts.first_name, proposal.client_contacts.last_name].filter(Boolean).join(" ") : null;
  const logo = resolveLogoDisplay(logoUrl, businessName);

  return (
    <article className="proposal-document">
      <header className="proposal-document-header">
        <div>
          <div className="proposal-document-brand">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed URL is short-lived and per-request, not a good fit for next/image's remote-pattern allowlist.
              <img src={logo.src} alt={logo.alt} className="proposal-document-logo" />
            ) : null}
            <div className="proposal-document-business">{businessName}</div>
          </div>
          <div className="hint">Proposal #{proposal.proposal_number}</div>
          <div className="hint">Prepared {new Date(version.created_at).toLocaleDateString()}</div>
        </div>
        <div className="proposal-document-total">
          <div className="metric-tile-label">Total</div>
          <div className="metric-tile-value">{formatCents(version.total_cents)}</div>
        </div>
      </header>

      <section>
        <div className="hint">Prepared for</div>
        <div>
          <strong>{preparedFor}</strong>
          {contactName ? <span className="hint"> — attn. {contactName}</span> : null}
        </div>
      </section>

      <section>
        <h2>{proposal.title}</h2>
        <p className="hint">{SERVICE_TYPE_LABELS[proposal.service_type] ?? proposal.service_type}</p>
        {version.summary ? <p>{version.summary}</p> : null}
      </section>

      {version.scope_intro || sections.length > 0 ? (
        <section>
          <h3>Scope of work</h3>
          {version.scope_intro ? <p>{version.scope_intro}</p> : null}
          {sections.map((s) => (
            <div key={s.id} className="stack" style={{ gap: 4 }}>
              <strong>{s.title}</strong>
              {s.description ? <p className="hint">{s.description}</p> : null}
            </div>
          ))}
        </section>
      ) : null}

      {measurements.length > 0 ? (
        <section>
          <h3>Measurements</h3>
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Dimensions</th>
                  <th>Area</th>
                  <th>Perimeter</th>
                  <th>Waste</th>
                </tr>
              </thead>
              <tbody>
                {measurements.map((m) => {
                  const dimensions =
                    m.length != null && m.width != null
                      ? `${m.length} x ${m.width}${m.height != null ? ` x ${m.height}` : ""} ${m.unit}`
                      : m.linear_length != null
                        ? `${m.linear_length} ${m.unit}`
                        : "—";
                  const generatedMaterials = measurementMaterials.filter((mm) => mm.proposal_measurement_id === m.id);
                  const generatedLabor = laborItems.filter((l) => l.proposal_measurement_id === m.id);
                  return (
                    <tr key={m.id}>
                      <td data-label="Name">
                        {m.name}
                        {measurementGroups.find((g) => g.id === m.measurement_group_id) ? (
                          <div className="hint">{measurementGroups.find((g) => g.id === m.measurement_group_id)!.name}</div>
                        ) : null}
                        {generatedMaterials.length > 0 || generatedLabor.length > 0 ? (
                          <div className="hint">
                            {generatedMaterials.map((mm) => {
                              const li = lineItems.find((l) => l.id === mm.proposal_line_item_id);
                              return li ? <div key={mm.id}>Material: {li.description}</div> : null;
                            })}
                            {generatedLabor.map((l) => (
                              <div key={l.id}>Labor: {l.label}</div>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td data-label="Type">{formatLabel(m.measurement_type)}</td>
                      <td data-label="Dimensions">{dimensions}</td>
                      <td data-label="Area">{m.area != null ? `${m.area} sq ${m.unit}` : "—"}</td>
                      <td data-label="Perimeter">{m.perimeter != null ? `${m.perimeter} ${m.unit}` : "—"}</td>
                      <td data-label="Waste">{(m.waste_bps / 100).toFixed(0)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {version.estimated_start_date || version.estimated_duration_days ? (
        <section>
          <h3>Estimated schedule</h3>
          <p>
            {version.estimated_start_date ? `Starting ${new Date(version.estimated_start_date).toLocaleDateString()}` : "Start date to be confirmed"}
            {version.estimated_duration_days ? ` — approximately ${version.estimated_duration_days} day(s)` : ""}
          </p>
        </section>
      ) : null}

      {laborItems.length > 0 ? (
        <section>
          <h3>Labor</h3>
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Hours</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {laborItems.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Description">{item.label}</td>
                    <td data-label="Hours">{item.total_hours}</td>
                    <td data-label="Total">{formatCents(item.total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {lineItems.length > 0 ? (
        <section>
          <h3>Materials &amp; additional costs</h3>
          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Description">{item.description}</td>
                    <td data-label="Qty">
                      {item.quantity} {item.unit.replace(/_/g, " ")}
                    </td>
                    <td data-label="Total">{formatCents(item.line_total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section>
        <h3>Current job photos</h3>
        {currentJobMedia.length === 0 ? (
          <p className="hint">No photos added yet.</p>
        ) : (
          <div className="photo-grid">
            {currentJobMedia.map((m) => (
              <figure key={m.id} className="photo-card">
                {m.signedUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed URL, short-lived, per-request
                  <img src={m.signedUrl} alt={m.caption || "Current job photo"} className="photo-thumb photo-thumb-lg" />
                ) : (
                  <div className="photo-thumb photo-thumb-lg photo-unavailable">{imageUnavailableLabel()}</div>
                )}
              </figure>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3>Previous work</h3>
        {previousWorkMedia.length === 0 ? (
          <p className="hint">No previous work selected.</p>
        ) : (
          <div className="photo-grid">
            {previousWorkMedia.map((m) => (
              <figure key={m.id} className="photo-card">
                {m.signedUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed URL, short-lived, per-request
                  <img src={m.signedUrl} alt={m.caption || "Previous work"} className="photo-thumb photo-thumb-lg" />
                ) : (
                  <div className="photo-thumb photo-thumb-lg photo-unavailable">{imageUnavailableLabel()}</div>
                )}
              </figure>
            ))}
          </div>
        )}
      </section>

      {version.terms ? (
        <section>
          <h3>Terms</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{version.terms}</p>
        </section>
      ) : null}

      {version.exclusions ? (
        <section>
          <h3>Exclusions</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{version.exclusions}</p>
        </section>
      ) : null}

      <section className="pricing-summary">
        <div className="pricing-summary-row">
          <span>Labor</span>
          <span>{formatCents(version.labor_total_cents)}</span>
        </div>
        <div className="pricing-summary-row">
          <span>Materials &amp; costs</span>
          <span>{formatCents(version.line_items_subtotal_cents)}</span>
        </div>
        {version.discount_cents > 0 ? (
          <div className="pricing-summary-row">
            <span>Discount</span>
            <span>-{formatCents(version.discount_cents)}</span>
          </div>
        ) : null}
        {version.tax_cents > 0 ? (
          <div className="pricing-summary-row">
            <span>Tax</span>
            <span>{formatCents(version.tax_cents)}</span>
          </div>
        ) : null}
        <div className="pricing-summary-row pricing-summary-total">
          <span>Total</span>
          <span>{formatCents(version.total_cents)}</span>
        </div>
      </section>

      {clientResponse ? (
        <section className="proposal-document-response">
          <h3>Client response</h3>
          {clientResponse.responseType === "accepted" ? (
            <>
              <p>
                <strong>Accepted</strong> by {clientResponse.clientName ?? "the client"}
                <br />
                {clientResponse.clientEmail}
                <br />
                {new Date(clientResponse.respondedAt).toLocaleString()}
              </p>
              <p className="hint">{acceptanceRecordFootnote()}</p>
            </>
          ) : (
            <>
              <p>
                <strong>Declined</strong> by {clientResponse.clientEmail}
                <br />
                {new Date(clientResponse.respondedAt).toLocaleString()}
              </p>
              {clientResponse.declineReason ? (
                <p>
                  Reason:
                  <br />
                  {clientResponse.declineReason}
                </p>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      <footer className="proposal-document-footer hint">Proposal #{proposal.proposal_number}</footer>
    </article>
  );
}
