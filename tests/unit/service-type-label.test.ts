import { describe, expect, it } from "vitest";
import { serviceTypeLabel } from "../../src/lib/proposals/service-type";

describe("serviceTypeLabel", () => {
  it("returns a human label for a known non-custom service type", () => {
    expect(serviceTypeLabel("interior_painting")).toBe("Interior painting");
    expect(serviceTypeLabel("bathroom_remodeling")).toBe("Bathroom remodeling");
  });

  it("returns the custom service name when service_type is 'custom' and a name is present", () => {
    expect(serviceTypeLabel("custom", "Deck repair")).toBe("Deck repair");
  });

  it("trims the custom service name", () => {
    expect(serviceTypeLabel("custom", "  Patio extension  ")).toBe("Patio extension");
  });

  it("never shows the bare word 'custom'", () => {
    expect(serviceTypeLabel("custom", "Anything")).not.toBe("custom");
  });

  it("falls back to 'Custom service' when service_type is 'custom' but no name is set (legacy data)", () => {
    expect(serviceTypeLabel("custom", null)).toBe("Custom service");
    expect(serviceTypeLabel("custom", undefined)).toBe("Custom service");
    expect(serviceTypeLabel("custom", "")).toBe("Custom service");
    expect(serviceTypeLabel("custom", "   ")).toBe("Custom service");
  });

  it("falls back to the raw value for an unrecognized non-custom service type", () => {
    expect(serviceTypeLabel("something_else")).toBe("something_else");
  });
});
