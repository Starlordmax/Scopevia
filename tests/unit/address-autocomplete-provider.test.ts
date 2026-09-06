import { describe, expect, it } from "vitest";
import { resolveAddressAutocompleteProvider } from "../../src/lib/address/autocomplete-provider";

describe("resolveAddressAutocompleteProvider (Client Address)", () => {
  it("resolves to 'none' when no provider env var is set", () => {
    expect(resolveAddressAutocompleteProvider(undefined, true)).toBe("none");
    expect(resolveAddressAutocompleteProvider("", true)).toBe("none");
  });

  it("resolves to 'none' when the provider is set but no API key is present, even though a key is never required to be secret", () => {
    expect(resolveAddressAutocompleteProvider("google_places", false)).toBe("none");
  });

  it("resolves to the requested provider when both the provider and a key are present", () => {
    expect(resolveAddressAutocompleteProvider("google_places", true)).toBe("google_places");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(resolveAddressAutocompleteProvider("  Google_Places  ", true)).toBe("google_places");
  });

  it("falls back to 'none' for an unrecognized provider name rather than throwing", () => {
    expect(resolveAddressAutocompleteProvider("mapbox", true)).toBe("none");
  });

  it("never breaks (never throws) regardless of input — safe to call with Render env vars missing", () => {
    expect(() => resolveAddressAutocompleteProvider(undefined, false)).not.toThrow();
  });
});
