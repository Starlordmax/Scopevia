import { describe, expect, it } from "vitest";
import { resolveSiteOrigin } from "../../src/lib/auth/site-origin";

describe("resolveSiteOrigin (auth confirmation/reset redirect fix)", () => {
  it("NEXT_PUBLIC_SITE_URL wins even when an Origin header is also present", () => {
    expect(resolveSiteOrigin("https://scopevia.onrender.com", "http://localhost:3000")).toBe("https://scopevia.onrender.com");
  });

  it("strips a trailing slash from the env var", () => {
    expect(resolveSiteOrigin("https://scopevia.onrender.com/", null)).toBe("https://scopevia.onrender.com");
  });

  it("falls back to the Origin header when the env var is unset", () => {
    expect(resolveSiteOrigin(undefined, "http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("falls back to the Origin header when the env var is blank", () => {
    expect(resolveSiteOrigin("   ", "https://example.com")).toBe("https://example.com");
  });

  it("falls back to hardcoded localhost only when both are absent", () => {
    expect(resolveSiteOrigin(undefined, null)).toBe("http://localhost:3000");
  });

  it("never returns a Render URL when NEXT_PUBLIC_SITE_URL is correctly set to localhost for local dev", () => {
    expect(resolveSiteOrigin("http://localhost:3000", "https://scopevia.onrender.com")).toBe("http://localhost:3000");
  });
});
