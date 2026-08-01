import { describe, expect, it } from "vitest";
import { buildQuickClientDisplayName } from "../../src/lib/crm/quick-client";

describe("buildQuickClientDisplayName (Quick Create Client)", () => {
  it("joins first and last name with a space", () => {
    expect(buildQuickClientDisplayName("John", "Smith")).toBe("John Smith");
  });

  it("trims incidental whitespace from either part", () => {
    expect(buildQuickClientDisplayName("  Jane  ", "  Doe  ")).toBe("Jane     Doe");
  });

  it("does not produce a leading/trailing space", () => {
    const result = buildQuickClientDisplayName("Alex", "Rivera");
    expect(result.startsWith(" ")).toBe(false);
    expect(result.endsWith(" ")).toBe(false);
  });
});
