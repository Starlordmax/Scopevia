import { describe, expect, it } from "vitest";
import { buildInternalProposalUrl } from "../../src/lib/notifications/internal-url";

describe("buildInternalProposalUrl (Phase 3D)", () => {
  it("builds an absolute proposal URL from APP_BASE_URL", () => {
    expect(buildInternalProposalUrl("https://app.scopevia.com", "abc-123")).toBe("https://app.scopevia.com/proposals/abc-123");
  });

  it("strips a trailing slash on the base URL", () => {
    expect(buildInternalProposalUrl("https://app.scopevia.com/", "abc-123")).toBe("https://app.scopevia.com/proposals/abc-123");
  });

  it("returns null when APP_BASE_URL is undefined (email sent without a link, not blocked)", () => {
    expect(buildInternalProposalUrl(undefined, "abc-123")).toBeNull();
  });

  it("returns null when APP_BASE_URL is blank/whitespace-only", () => {
    expect(buildInternalProposalUrl("   ", "abc-123")).toBeNull();
  });

  it("never falls back to a hardcoded localhost URL", () => {
    expect(buildInternalProposalUrl(undefined, "abc-123")).toBeNull();
    expect(buildInternalProposalUrl("https://app.scopevia.com", "abc-123")).not.toMatch(/localhost/);
  });
});
