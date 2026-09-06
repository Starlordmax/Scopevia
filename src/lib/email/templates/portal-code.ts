/**
 * Renders the client portal access-code email. Pure string formatting, no
 * server-only dependency, so it's directly unit-testable — see
 * tests/unit/email-template.test.ts.
 *
 * Deliberately includes ONLY business name, proposal title, the code, its
 * expiration, and a security note. Never the link token, a portal_link_id
 * or any other internal id, a storage path, a tenant id, or any
 * debug/technical metadata — see docs/53-client-portal-security.md.
 */

import { escapeHtml } from "./html-escape";

export type PortalCodeEmailContent = {
  code: string;
  proposalTitle: string;
  businessName: string;
};

export type RenderedEmail = { subject: string; text: string; html: string };

export function renderPortalCodeEmail(input: PortalCodeEmailContent): RenderedEmail {
  const subject = `Your secure access code for ${input.proposalTitle}`;

  const text = [
    "Hi,",
    "",
    `Use this code to view your proposal, "${input.proposalTitle}", from ${input.businessName}:`,
    "",
    input.code,
    "",
    "This code expires in 10 minutes.",
    "",
    "If you did not request this code, you can ignore this email.",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0; padding:0; background-color:#f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:12px; overflow:hidden;">
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 16px; font-size:15px; line-height:1.5; color:#1f2937;">Hi,</p>
                <p style="margin:0 0 24px; font-size:15px; line-height:1.5; color:#1f2937;">
                  Use this code to view your proposal, &quot;${escapeHtml(input.proposalTitle)}&quot;, from <strong>${escapeHtml(input.businessName)}</strong>:
                </p>
                <p style="margin:0 0 24px; text-align:center;">
                  <span style="display:inline-block; padding:12px 24px; font-size:28px; font-weight:700; letter-spacing:4px; color:#1f2937; background-color:#f4f5f7; border-radius:8px;">${escapeHtml(input.code)}</span>
                </p>
                <p style="margin:0 0 8px; font-size:14px; line-height:1.5; color:#6b7280;">This code expires in 10 minutes.</p>
                <p style="margin:0; font-size:14px; line-height:1.5; color:#6b7280;">If you did not request this code, you can ignore this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}
