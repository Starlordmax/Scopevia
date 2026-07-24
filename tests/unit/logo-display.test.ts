import { describe, expect, it } from "vitest";
import { resolveLogoDisplay } from "../../src/lib/branding/logo-display";

describe("resolveLogoDisplay (Phase 3D.2)", () => {
  it("returns null when there is no logo URL, so ProposalDocument falls back to business-name text", () => {
    expect(resolveLogoDisplay(null, "Acme Painting")).toBeNull();
    expect(resolveLogoDisplay(undefined, "Acme Painting")).toBeNull();
  });

  it("returns null for an empty string URL", () => {
    expect(resolveLogoDisplay("", "Acme Painting")).toBeNull();
  });

  it("returns the src/alt pair when a logo URL is present", () => {
    const result = resolveLogoDisplay("https://signed.example.com/logo.png", "Acme Painting");
    expect(result).toEqual({ src: "https://signed.example.com/logo.png", alt: "Acme Painting logo" });
  });
});
