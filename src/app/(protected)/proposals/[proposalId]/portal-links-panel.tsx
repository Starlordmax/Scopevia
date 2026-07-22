"use client";

import { useActionState, useState } from "react";
import { createProposalPortalLinkAction, revokeProposalPortalLinkAction, type CreatePortalLinkResult } from "../../../../actions/portal-links";
import { SubmitButton } from "../../../../components/submit-button";
import { ConfirmSubmitButton } from "../../../../components/confirm-submit-button";
import { formatLabel } from "../../../../lib/proposals/format";
import { portalLinkBadgeClass } from "../../../../lib/crm/status-badge";

type PortalLinkRow = {
  id: string;
  status: string;
  expires_at: string;
  created_at: string;
  last_viewed_at: string | null;
};

const initialState: CreatePortalLinkResult = {};

export function PortalLinksPanel({
  tenantId,
  proposalId,
  links,
  canCreate,
  canRevoke,
  isReady,
  isRespondedTo,
  emailProviderIsDev,
}: {
  tenantId: string;
  proposalId: string;
  links: PortalLinkRow[];
  canCreate: boolean;
  canRevoke: boolean;
  isReady: boolean;
  isRespondedTo: boolean;
  emailProviderIsDev: boolean;
}) {
  const [state, formAction] = useActionState(createProposalPortalLinkAction, initialState);
  const [copied, setCopied] = useState(false);

  return (
    <div className="section-card stack">
      <div className="section-card-header">
        <h3>Client portal</h3>
      </div>
      <p className="hint">
        Send this link to your client. They&apos;ll enter their email and receive a secure access code before viewing this proposal.
      </p>
      <p className="hint">Notifications are sent to your team when clients view or respond.</p>

      {emailProviderIsDev ? (
        <p className="hint" style={{ fontStyle: "italic" }}>
          Email provider is in development mode. Codes are captured locally for testing.
        </p>
      ) : null}

      {state.error ? <p className="error-banner">{state.error}</p> : null}

      {state.url ? (
        <div className="stack" style={{ gap: 4 }}>
          <label htmlFor="portal-link-url">New link created — copy it now, it won&apos;t be shown again:</label>
          <div className="tenant-form">
            <input
              id="portal-link-url"
              readOnly
              value={state.url}
              onFocus={(e) => e.currentTarget.select()}
              style={{ flex: 1, minWidth: 220 }}
            />
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                navigator.clipboard.writeText(state.url ?? "");
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          {state.expiresAt ? <p className="hint">Expires {new Date(state.expiresAt).toLocaleDateString()}.</p> : null}
        </div>
      ) : null}

      {canCreate && !isRespondedTo ? (
        isReady ? (
          <form action={formAction}>
            <input type="hidden" name="tenantId" value={tenantId} />
            <input type="hidden" name="proposalId" value={proposalId} />
            <SubmitButton pendingText="Creating…">Create client portal link</SubmitButton>
          </form>
        ) : (
          <p className="hint">Mark this proposal ready to create a client portal link.</p>
        )
      ) : null}

      {links.length === 0 ? (
        <p className="hint">No client portal links yet.</p>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Created</th>
                <th>Expires</th>
                <th>Last viewed</th>
                {canRevoke ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {links.map((link) => {
                const isExpired = link.status === "active" && new Date(link.expires_at) <= new Date();
                const displayStatus = isExpired ? "expired" : link.status;
                return (
                  <tr key={link.id}>
                    <td data-label="Status">
                      <span className={`badge ${isExpired ? "badge-warning" : portalLinkBadgeClass(link.status)}`}>{formatLabel(displayStatus)}</span>
                    </td>
                    <td data-label="Created">{new Date(link.created_at).toLocaleDateString()}</td>
                    <td data-label="Expires">{new Date(link.expires_at).toLocaleDateString()}</td>
                    <td data-label="Last viewed">{link.last_viewed_at ? new Date(link.last_viewed_at).toLocaleString() : "Not yet viewed"}</td>
                    {canRevoke ? (
                      <td data-label="Actions">
                        {link.status === "active" && !isExpired ? (
                          <form action={revokeProposalPortalLinkAction}>
                            <input type="hidden" name="portalLinkId" value={link.id} />
                            <input type="hidden" name="proposalId" value={proposalId} />
                            <ConfirmSubmitButton
                              className="button-danger"
                              confirmMessage="Revoke this client portal link? The client will immediately lose access."
                              pendingText="Revoking…"
                            >
                              Revoke
                            </ConfirmSubmitButton>
                          </form>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
