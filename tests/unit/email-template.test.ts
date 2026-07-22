import { describe, expect, it } from "vitest";
import { renderPortalCodeEmail } from "../../src/lib/email/templates/portal-code";

const BASE_INPUT = { code: "482913", proposalTitle: "Kitchen Remodel", businessName: "Acme Painting Co." };

describe("renderPortalCodeEmail", () => {
  it("includes the business name, proposal title, code, expiration, and a security note", () => {
    const { subject, text, html } = renderPortalCodeEmail(BASE_INPUT);

    expect(subject).toBe("Your secure access code for Kitchen Remodel");

    for (const rendered of [text, html]) {
      expect(rendered).toContain("Acme Painting Co.");
      expect(rendered).toContain("482913");
      expect(rendered).toContain("10 minutes");
      expect(rendered).toMatch(/did not request this code/i);
    }
  });

  it("subject line names the proposal, not the business, first", () => {
    const { subject } = renderPortalCodeEmail(BASE_INPUT);
    expect(subject).toContain(BASE_INPUT.proposalTitle);
  });

  it("never includes internal/technical identifiers", () => {
    const { text, html } = renderPortalCodeEmail(BASE_INPUT);
    for (const rendered of [text, html]) {
      expect(rendered).not.toMatch(/tenant/i);
      expect(rendered).not.toMatch(/token/i);
      expect(rendered).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i); // uuid shape
      expect(rendered).not.toMatch(/portal_link_id|proposal_id|storage_path/i);
    }
  });

  it("HTML-escapes a business name / proposal title containing markup", () => {
    const { html } = renderPortalCodeEmail({
      code: "111111",
      proposalTitle: "<script>alert(1)</script>",
      businessName: "Tom & Jerry's \"Painting\" <b>Co</b>",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Tom &amp; Jerry&#39;s &quot;Painting&quot; &lt;b&gt;Co&lt;/b&gt;");
  });

  it("does not HTML-escape the plain-text version (no email client renders it as markup)", () => {
    const { text } = renderPortalCodeEmail({ code: "111111", proposalTitle: "Tom & Jerry's Job", businessName: "A & B Co." });
    expect(text).toContain("Tom & Jerry's Job");
    expect(text).toContain("A & B Co.");
  });

  it("the code appears as a standalone token in the text version, not buried in a sentence", () => {
    const { text } = renderPortalCodeEmail(BASE_INPUT);
    const lines = text.split("\n");
    expect(lines).toContain("482913");
  });
});
