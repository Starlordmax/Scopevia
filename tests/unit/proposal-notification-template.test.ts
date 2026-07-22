import { describe, expect, it } from "vitest";
import {
  renderProposalViewedEmail,
  renderProposalAcceptedEmail,
  renderProposalDeclinedEmail,
  renderAcceptedConfirmationToClientEmail,
  renderDeclinedConfirmationToClientEmail,
} from "../../src/lib/email/templates/proposal-notification";

const BASE = {
  proposalTitle: "Kitchen Repaint",
  proposalNumber: 42,
  businessName: "Acme Painting",
  internalProposalUrl: "https://app.scopevia.com/proposals/abc-123",
};

// A representative sample of everything that must NEVER appear in a
// notification email body — OTP codes, portal tokens, session/token
// hashes, storage paths, tenant/internal UUIDs. Used across every render
// test below as a shared regression guard.
const FORBIDDEN_PATTERNS = [/token/i, /session/i, /otp/i, /storage/i, /tenant_id/i, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i];

function assertNoForbiddenContent(rendered: { subject: string; text: string; html: string }) {
  for (const pattern of FORBIDDEN_PATTERNS) {
    expect(rendered.subject).not.toMatch(pattern);
    expect(rendered.text).not.toMatch(pattern);
    expect(rendered.html).not.toMatch(pattern);
  }
}

describe("renderProposalViewedEmail (Phase 3D)", () => {
  it("includes the subject, proposal title/number, and client email", () => {
    const rendered = renderProposalViewedEmail({ ...BASE, clientEmail: "client@example.com" });
    expect(rendered.subject).toBe("Proposal viewed: Kitchen Repaint");
    expect(rendered.text).toContain("client@example.com viewed proposal 42.");
    expect(rendered.text).toContain("Kitchen Repaint");
    expect(rendered.html).toContain("client@example.com");
  });

  it("includes the internal link when provided", () => {
    const rendered = renderProposalViewedEmail({ ...BASE, clientEmail: "client@example.com" });
    expect(rendered.text).toContain(BASE.internalProposalUrl);
    expect(rendered.html).toContain(BASE.internalProposalUrl);
  });

  it("omits the link entirely when internalProposalUrl is null (missing APP_BASE_URL)", () => {
    const rendered = renderProposalViewedEmail({ ...BASE, internalProposalUrl: null, clientEmail: "client@example.com" });
    expect(rendered.text).not.toContain("View it in Scopevia");
    expect(rendered.html).not.toContain("href=");
  });

  it("never leaks tokens, sessions, storage paths, or raw UUIDs", () => {
    assertNoForbiddenContent(renderProposalViewedEmail({ ...BASE, clientEmail: "client@example.com" }));
  });
});

describe("renderProposalAcceptedEmail (Phase 3D)", () => {
  const input = { ...BASE, clientName: "Jane Doe", clientEmail: "jane@example.com", respondedAt: "2026-07-22T14:30:00.000Z" };

  it("includes the subject, client name/email, and a formatted timestamp", () => {
    const rendered = renderProposalAcceptedEmail(input);
    expect(rendered.subject).toBe("Proposal accepted: Kitchen Repaint");
    expect(rendered.text).toContain("Jane Doe accepted proposal 42.");
    expect(rendered.text).toContain("jane@example.com");
    expect(rendered.text).toContain("Accepted at:");
  });

  it("escapes HTML-significant characters in client-controlled fields", () => {
    const rendered = renderProposalAcceptedEmail({ ...input, clientName: `<script>alert("x")</script>` });
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
  });

  it("never leaks tokens, sessions, storage paths, or raw UUIDs", () => {
    assertNoForbiddenContent(renderProposalAcceptedEmail(input));
  });
});

describe("renderProposalDeclinedEmail (Phase 3D)", () => {
  it("includes the decline reason when given", () => {
    const rendered = renderProposalDeclinedEmail({ ...BASE, clientEmail: "client@example.com", declineReason: "Too expensive" });
    expect(rendered.subject).toBe("Proposal declined: Kitchen Repaint");
    expect(rendered.text).toContain("Too expensive");
  });

  it("shows a friendly fallback when no reason was given", () => {
    const rendered = renderProposalDeclinedEmail({ ...BASE, clientEmail: "client@example.com", declineReason: null });
    expect(rendered.text).toContain("No reason given");
  });

  it("mentions the revision option", () => {
    const rendered = renderProposalDeclinedEmail({ ...BASE, clientEmail: "client@example.com", declineReason: null });
    expect(rendered.text).toMatch(/revised version/i);
  });

  it("escapes an HTML-significant decline reason", () => {
    const rendered = renderProposalDeclinedEmail({ ...BASE, clientEmail: "client@example.com", declineReason: `<img src=x onerror=alert(1)>` });
    expect(rendered.html).not.toContain("<img src=x");
    expect(rendered.html).toContain("&lt;img");
  });

  it("never leaks tokens, sessions, storage paths, or raw UUIDs", () => {
    assertNoForbiddenContent(renderProposalDeclinedEmail({ ...BASE, clientEmail: "client@example.com", declineReason: "Too expensive" }));
  });
});

describe("client confirmation emails (Phase 3D)", () => {
  it("accepted confirmation is short and does not claim legal e-signature validity", () => {
    const rendered = renderAcceptedConfirmationToClientEmail({ proposalTitle: "Kitchen Repaint", businessName: "Acme Painting" });
    expect(rendered.text).toBe("We received your approval for Kitchen Repaint.");
    expect(rendered.text).not.toMatch(/e-signature|legally binding/i);
  });

  it("declined confirmation is short and neutral", () => {
    const rendered = renderDeclinedConfirmationToClientEmail({ proposalTitle: "Kitchen Repaint", businessName: "Acme Painting" });
    expect(rendered.text).toBe("We received your response for Kitchen Repaint.");
  });
});
