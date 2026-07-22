import { describe, expect, it } from "vitest";
import { buildDedupeKey, sanitizeErrorForStorage } from "../../src/lib/notifications/dedupe-key";

describe("buildDedupeKey (Phase 3D)", () => {
  it("is deterministic for the same event/version/recipient", () => {
    const a = buildDedupeKey("proposal_viewed", "version-1", "owner@example.com");
    const b = buildDedupeKey("proposal_viewed", "version-1", "owner@example.com");
    expect(a).toBe(b);
  });

  it("is case-insensitive on the recipient email (a retry with different casing still dedupes)", () => {
    const a = buildDedupeKey("proposal_viewed", "version-1", "Owner@Example.com");
    const b = buildDedupeKey("proposal_viewed", "version-1", "owner@example.com");
    expect(a).toBe(b);
  });

  it("trims incidental whitespace on the recipient email", () => {
    const a = buildDedupeKey("proposal_viewed", "version-1", "  owner@example.com  ");
    const b = buildDedupeKey("proposal_viewed", "version-1", "owner@example.com");
    expect(a).toBe(b);
  });

  it("differs across event types for the same version/recipient", () => {
    const viewed = buildDedupeKey("proposal_viewed", "version-1", "owner@example.com");
    const accepted = buildDedupeKey("proposal_accepted", "version-1", "owner@example.com");
    expect(viewed).not.toBe(accepted);
  });

  it("differs across versions for the same event/recipient (a revision's new version is a fresh dedupe scope)", () => {
    const v1 = buildDedupeKey("proposal_viewed", "version-1", "owner@example.com");
    const v2 = buildDedupeKey("proposal_viewed", "version-2", "owner@example.com");
    expect(v1).not.toBe(v2);
  });

  it("differs across recipients for the same event/version", () => {
    const owner = buildDedupeKey("proposal_viewed", "version-1", "owner@example.com");
    const sales = buildDedupeKey("proposal_viewed", "version-1", "sales@example.com");
    expect(owner).not.toBe(sales);
  });
});

describe("sanitizeErrorForStorage (Phase 3D)", () => {
  it("extracts the message from an Error instance", () => {
    expect(sanitizeErrorForStorage(new Error("boom"))).toBe("boom");
  });

  it("collapses newlines/whitespace into a single line", () => {
    expect(sanitizeErrorForStorage(new Error("line one\nline two\n\nline three"))).toBe("line one line two line three");
  });

  it("caps length rather than storing an unbounded message", () => {
    const long = "x".repeat(500);
    const result = sanitizeErrorForStorage(new Error(long));
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.endsWith("…")).toBe(true);
  });

  it("handles a non-Error thrown value without crashing", () => {
    expect(sanitizeErrorForStorage("a plain string")).toBe("a plain string");
    expect(sanitizeErrorForStorage(undefined)).toBe("undefined");
  });
});
