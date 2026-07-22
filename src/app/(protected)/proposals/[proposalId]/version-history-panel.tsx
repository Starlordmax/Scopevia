import Link from "next/link";
import { formatLabel } from "../../../../lib/proposals/format";
import { proposalBadgeClass, versionStatusBadgeClass, portalLinkBadgeClass } from "../../../../lib/crm/status-badge";
import { versionHistoryLabel } from "../../../../lib/proposals/revision-copy";
import type { ProposalVersionHistoryEntry } from "../../../../lib/portal/data";

/**
 * Read-only history of every version this proposal has ever had, newest
 * first — Phase 3B.1. Never renders a raw version/link UUID; "Version N" is
 * the only identifier shown, matching the rest of the app's "no internal
 * ids in the UI" convention (see docs/58-proposal-revision-flow.md). Each
 * row's "Print" link (Phase 3C) opens that EXACT historical version's
 * export — see docs/60-proposal-pdf-print-export.md.
 */
export function VersionHistoryPanel({ proposalId, versions }: { proposalId: string; versions: ProposalVersionHistoryEntry[] }) {
  if (versions.length < 2) return null;

  return (
    <div className="section-card stack">
      <div className="section-card-header">
        <h3>Version history</h3>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Version</th>
              <th>Status</th>
              <th>Created</th>
              <th>Response</th>
              <th>Portal link</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <td data-label="Version">{versionHistoryLabel(v.versionNumber, v.isCurrent)}</td>
                <td data-label="Status">
                  <span className={`badge ${versionStatusBadgeClass(v.versionStatus)}`}>{formatLabel(v.versionStatus)}</span>
                </td>
                <td data-label="Created">{new Date(v.createdAt).toLocaleDateString()}</td>
                <td data-label="Response">
                  {v.response ? (
                    <>
                      <span className={`badge ${proposalBadgeClass(v.response.responseType)}`}>{formatLabel(v.response.responseType)}</span>{" "}
                      <span className="hint">{new Date(v.response.respondedAt).toLocaleDateString()}</span>
                    </>
                  ) : (
                    <span className="hint">No response</span>
                  )}
                </td>
                <td data-label="Portal link">
                  {v.latestPortalLinkStatus === "none" ? (
                    <span className="hint">No link created</span>
                  ) : (
                    <span className={`badge ${v.latestPortalLinkStatus === "active" ? portalLinkBadgeClass("active") : v.latestPortalLinkStatus === "revoked" ? portalLinkBadgeClass("revoked") : "badge-warning"}`}>
                      {formatLabel(v.latestPortalLinkStatus)}
                    </span>
                  )}
                </td>
                <td data-label="Actions">
                  <Link href={`/proposals/${proposalId}/print?version=${v.id}`} className="button-secondary">
                    Print
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
