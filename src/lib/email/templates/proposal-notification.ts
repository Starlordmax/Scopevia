/**
 * Renders the Phase 3D Client Portal event notification emails. Pure
 * string formatting, no server-only dependency, so it's directly
 * unit-testable — see tests/unit/proposal-notification-template.test.ts.
 *
 * Deliberately includes ONLY business name, proposal title/number, the
 * client's email/name (when known), a decline reason (when given), a
 * response timestamp, and a link back into the app. NEVER a portal token,
 * a token/session hash, an OTP code, a storage path, a tenant id, a
 * version id, or any other internal/technical identifier — see
 * docs/63-notification-delivery-security.md.
 */
import { escapeHtml } from "./html-escape";

export type RenderedEmail = { subject: string; text: string; html: string };

type ProposalNotificationBase = {
  proposalTitle: string;
  proposalNumber: number;
  businessName: string;
  /** null when APP_BASE_URL isn't configured — the email is sent without a link rather than blocked. */
  internalProposalUrl: string | null;
};

export type ProposalViewedEmailInput = ProposalNotificationBase & {
  clientEmail: string;
};

export type ProposalAcceptedEmailInput = ProposalNotificationBase & {
  clientName: string;
  clientEmail: string;
  respondedAt: string;
};

export type ProposalDeclinedEmailInput = ProposalNotificationBase & {
  clientEmail: string;
  declineReason: string | null;
};

export type ClientConfirmationInput = {
  proposalTitle: string;
  businessName: string;
};

function wrapHtml(bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0; padding:0; background-color:#f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:12px; overflow:hidden;">
            <tr>
              <td style="padding:32px;">
                ${bodyHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function htmlParagraph(text: string): string {
  return `<p style="margin:0 0 16px; font-size:15px; line-height:1.5; color:#1f2937;">${text}</p>`;
}

function htmlLinkButton(url: string, label: string): string {
  return `<p style="margin:0 0 16px;"><a href="${escapeHtml(url)}" style="display:inline-block; padding:10px 20px; font-size:14px; font-weight:600; color:#ffffff; background-color:#2563eb; border-radius:8px; text-decoration:none;">${escapeHtml(label)}</a></p>`;
}

export function renderProposalViewedEmail(input: ProposalViewedEmailInput): RenderedEmail {
  const subject = `Proposal viewed: ${input.proposalTitle}`;

  const text = [
    `${input.clientEmail} viewed proposal ${input.proposalNumber}.`,
    "",
    "Proposal:",
    input.proposalTitle,
    "",
    "Client:",
    input.clientEmail,
    ...(input.internalProposalUrl ? ["", "View it in Scopevia:", input.internalProposalUrl] : []),
  ].join("\n");

  const html = wrapHtml(
    [
      htmlParagraph(`<strong>${escapeHtml(input.clientEmail)}</strong> viewed proposal ${input.proposalNumber}.`),
      htmlParagraph(`Proposal:<br/><strong>${escapeHtml(input.proposalTitle)}</strong>`),
      htmlParagraph(`Client:<br/>${escapeHtml(input.clientEmail)}`),
      input.internalProposalUrl ? htmlLinkButton(input.internalProposalUrl, "View in Scopevia") : "",
    ].join("\n")
  );

  return { subject, text, html };
}

export function renderProposalAcceptedEmail(input: ProposalAcceptedEmailInput): RenderedEmail {
  const subject = `Proposal accepted: ${input.proposalTitle}`;
  const respondedAtDisplay = new Date(input.respondedAt).toLocaleString();

  const text = [
    `Good news — ${input.clientName} accepted proposal ${input.proposalNumber}.`,
    "",
    "Client:",
    input.clientName,
    input.clientEmail,
    "",
    "Accepted at:",
    respondedAtDisplay,
    ...(input.internalProposalUrl ? ["", "Open in Scopevia:", input.internalProposalUrl] : []),
  ].join("\n");

  const html = wrapHtml(
    [
      htmlParagraph(`Good news — <strong>${escapeHtml(input.clientName)}</strong> accepted proposal ${input.proposalNumber}.`),
      htmlParagraph(`Client:<br/>${escapeHtml(input.clientName)}<br/>${escapeHtml(input.clientEmail)}`),
      htmlParagraph(`Accepted at:<br/>${escapeHtml(respondedAtDisplay)}`),
      input.internalProposalUrl ? htmlLinkButton(input.internalProposalUrl, "Open in Scopevia") : "",
    ].join("\n")
  );

  return { subject, text, html };
}

export function renderProposalDeclinedEmail(input: ProposalDeclinedEmailInput): RenderedEmail {
  const subject = `Proposal declined: ${input.proposalTitle}`;
  const reasonDisplay = input.declineReason ?? "No reason given";

  const text = [
    `${input.clientEmail} declined proposal ${input.proposalNumber}.`,
    "",
    "Reason:",
    reasonDisplay,
    ...(input.internalProposalUrl ? ["", "Open in Scopevia:", input.internalProposalUrl] : []),
    "",
    "You can create a revised version from the proposal page.",
  ].join("\n");

  const html = wrapHtml(
    [
      htmlParagraph(`<strong>${escapeHtml(input.clientEmail)}</strong> declined proposal ${input.proposalNumber}.`),
      htmlParagraph(`Reason:<br/>${escapeHtml(reasonDisplay)}`),
      input.internalProposalUrl ? htmlLinkButton(input.internalProposalUrl, "Open in Scopevia") : "",
      htmlParagraph("You can create a revised version from the proposal page."),
    ].join("\n")
  );

  return { subject, text, html };
}

export function renderAcceptedConfirmationToClientEmail(input: ClientConfirmationInput): RenderedEmail {
  const subject = `Proposal accepted: ${input.proposalTitle}`;
  const text = `We received your approval for ${input.proposalTitle}.`;
  const html = wrapHtml(htmlParagraph(`We received your approval for <strong>${escapeHtml(input.proposalTitle)}</strong>.`));
  return { subject, text, html };
}

export function renderDeclinedConfirmationToClientEmail(input: ClientConfirmationInput): RenderedEmail {
  const subject = `We received your response: ${input.proposalTitle}`;
  const text = `We received your response for ${input.proposalTitle}.`;
  const html = wrapHtml(htmlParagraph(`We received your response for <strong>${escapeHtml(input.proposalTitle)}</strong>.`));
  return { subject, text, html };
}
