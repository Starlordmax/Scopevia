import { formatCents } from "../../../../lib/proposals/format";
import type { FullProposal } from "../../../../lib/proposals/data";

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
 * step and the standalone /preview route so both always show identical
 * content.
 */
export function ProposalDocument({ businessName, data }: { businessName: string; data: FullProposal }) {
  const { proposal, version, sections, laborItems, lineItems, currentJobMedia, previousWorkMedia } = data;
  const preparedFor = proposal.clients?.display_name ?? "Client";
  const contactName = proposal.client_contacts ? [proposal.client_contacts.first_name, proposal.client_contacts.last_name].filter(Boolean).join(" ") : null;

  return (
    <article className="proposal-document">
      <header className="proposal-document-header">
        <div>
          <div className="proposal-document-business">{businessName}</div>
          <div className="hint">Proposal #{proposal.proposal_number}</div>
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
          <div className="metrics-grid">
            {currentJobMedia.map((m) =>
              m.signedUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL, short-lived, per-request
                <img key={m.id} src={m.signedUrl} alt={m.caption || "Current job photo"} style={{ width: "100%", borderRadius: 8 }} />
              ) : null
            )}
          </div>
        )}
      </section>

      <section>
        <h3>Previous work</h3>
        {previousWorkMedia.length === 0 ? (
          <p className="hint">No previous work selected.</p>
        ) : (
          <div className="metrics-grid">
            {previousWorkMedia.map((m) =>
              m.signedUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL, short-lived, per-request
                <img key={m.id} src={m.signedUrl} alt={m.caption || "Previous work"} style={{ width: "100%", borderRadius: 8 }} />
              ) : null
            )}
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
    </article>
  );
}
