import { describe, expect, it } from "vitest";
import { createClientSchema, quickCreateClientSchema } from "../../src/lib/validation/crm";

describe("createClientSchema — address fields", () => {
  const BASE = { clientType: "individual" as const, displayName: "Jane Doe" };

  it("accepts a client with no address at all (fully optional)", () => {
    expect(createClientSchema.safeParse(BASE).success).toBe(true);
  });

  it("accepts a full US address with a plain 5-digit ZIP", () => {
    const result = createClientSchema.safeParse({
      ...BASE,
      addressLine1: "123 Main St",
      city: "Miami",
      state: "FL",
      postalCode: "33101",
      countryCode: "US",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a ZIP+4 US postal code", () => {
    const result = createClientSchema.safeParse({ ...BASE, postalCode: "33101-1234", countryCode: "US" });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed US ZIP with a friendly message", () => {
    const result = createClientSchema.safeParse({ ...BASE, postalCode: "abc", countryCode: "US" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === "Please enter a valid ZIP code.")).toBe(true);
    }
  });

  it("defaults to US format enforcement when country is omitted", () => {
    const result = createClientSchema.safeParse({ ...BASE, postalCode: "not-a-zip" });
    expect(result.success).toBe(false);
  });

  it("does not block a non-US postal code that wouldn't pass the US ZIP pattern", () => {
    const result = createClientSchema.safeParse({
      ...BASE,
      postalCode: "SW1A 2AA",
      countryCode: "GB",
    });
    expect(result.success).toBe(true);
  });

  it("allows partial address info (only a city, nothing else)", () => {
    const result = createClientSchema.safeParse({ ...BASE, city: "Miami" });
    expect(result.success).toBe(true);
  });
});

describe("quickCreateClientSchema — address fields", () => {
  const BASE = {
    clientType: "individual" as const,
    firstName: "John",
    lastName: "Smith",
    email: "john@example.com",
    phone: "555-123-4567",
  };

  it("accepts the quick-create payload with no address (address is optional here too)", () => {
    expect(quickCreateClientSchema.safeParse(BASE).success).toBe(true);
  });

  it("accepts a valid US ZIP", () => {
    const result = quickCreateClientSchema.safeParse({ ...BASE, postalCode: "33101" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid US ZIP with the friendly message", () => {
    const result = quickCreateClientSchema.safeParse({ ...BASE, postalCode: "12" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === "Please enter a valid ZIP code.")).toBe(true);
    }
  });
});
