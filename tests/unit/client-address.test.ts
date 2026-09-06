import { describe, expect, it } from "vitest";
import { formatClientAddress } from "../../src/lib/crm/address";

describe("formatClientAddress (Client Address)", () => {
  it("returns null when there's no address at all", () => {
    expect(formatClientAddress({})).toBeNull();
    expect(
      formatClientAddress({ addressLine1: null, city: null, state: null, postalCode: null, countryCode: null })
    ).toBeNull();
  });

  it("formats a full US address without the country code (US is implicit)", () => {
    expect(
      formatClientAddress({
        addressLine1: "123 Main St",
        city: "Miami",
        state: "FL",
        postalCode: "33101",
        countryCode: "US",
      })
    ).toBe("123 Main St · Miami, FL 33101");
  });

  it("includes address line 2 when present", () => {
    expect(
      formatClientAddress({
        addressLine1: "123 Main St",
        addressLine2: "Apt 4B",
        city: "Miami",
        state: "FL",
        postalCode: "33101",
      })
    ).toBe("123 Main St, Apt 4B · Miami, FL 33101");
  });

  it("shows the country code when it isn't US", () => {
    expect(
      formatClientAddress({
        addressLine1: "10 Downing St",
        city: "London",
        postalCode: "SW1A 2AA",
        countryCode: "GB",
      })
    ).toBe("10 Downing St · London, SW1A 2AA · GB");
  });

  it("handles partial address info (only a ZIP, nothing else) without stray punctuation", () => {
    expect(formatClientAddress({ postalCode: "33101" })).toBe("33101");
  });

  it("handles only a street address with no city/state/zip", () => {
    expect(formatClientAddress({ addressLine1: "123 Main St" })).toBe("123 Main St");
  });
});
