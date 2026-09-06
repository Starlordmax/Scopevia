import { describe, expect, it } from "vitest";
import { sanitizeNextPath } from "../../src/lib/auth/safe-redirect";

describe("sanitizeNextPath (auth callback open-redirect guard)", () => {
  it("allows a plain relative path", () => {
    expect(sanitizeNextPath("/sign-in")).toBe("/sign-in");
    expect(sanitizeNextPath("/reset-password")).toBe("/reset-password");
  });

  it("falls back to /sign-in when missing", () => {
    expect(sanitizeNextPath(null)).toBe("/sign-in");
    expect(sanitizeNextPath(undefined)).toBe("/sign-in");
    expect(sanitizeNextPath("")).toBe("/sign-in");
  });

  it("rejects a protocol-relative URL (the classic open-redirect vector)", () => {
    expect(sanitizeNextPath("//evil.com")).toBe("/sign-in");
    expect(sanitizeNextPath("//evil.com/phish")).toBe("/sign-in");
  });

  it("rejects an absolute external URL", () => {
    expect(sanitizeNextPath("https://evil.com")).toBe("/sign-in");
    expect(sanitizeNextPath("http://evil.com/sign-in")).toBe("/sign-in");
  });

  it("rejects a value that doesn't start with a slash", () => {
    expect(sanitizeNextPath("evil.com")).toBe("/sign-in");
    expect(sanitizeNextPath("sign-in")).toBe("/sign-in");
  });

  it("rejects a scheme embedded anywhere in the value", () => {
    expect(sanitizeNextPath("/redirect?url=javascript://evil")).toBe("/sign-in");
  });

  it("allows a relative path with its own query string", () => {
    expect(sanitizeNextPath("/proposals/123?tab=history")).toBe("/proposals/123?tab=history");
  });
});
