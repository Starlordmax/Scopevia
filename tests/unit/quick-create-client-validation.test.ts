import { describe, expect, it } from "vitest";
import { quickCreateClientSchema } from "../../src/lib/validation/crm";

const VALID = {
  clientType: "individual" as const,
  firstName: "John",
  lastName: "Smith",
  email: "john@example.com",
  phone: "555-123-4567",
};

describe("quickCreateClientSchema (Quick Create Client)", () => {
  it("accepts a valid individual", () => {
    expect(quickCreateClientSchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts a valid business", () => {
    expect(quickCreateClientSchema.safeParse({ ...VALID, clientType: "business" }).success).toBe(true);
  });

  it("rejects an unknown client type", () => {
    const result = quickCreateClientSchema.safeParse({ ...VALID, clientType: "company" });
    expect(result.success).toBe(false);
  });

  it("requires first name", () => {
    const result = quickCreateClientSchema.safeParse({ ...VALID, firstName: "" });
    expect(result.success).toBe(false);
  });

  it("requires last name", () => {
    const result = quickCreateClientSchema.safeParse({ ...VALID, lastName: "" });
    expect(result.success).toBe(false);
  });

  it("requires email (unlike the general client model, where it's optional)", () => {
    const result = quickCreateClientSchema.safeParse({ ...VALID, email: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed email with a friendly message", () => {
    const result = quickCreateClientSchema.safeParse({ ...VALID, email: "not-an-email" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Please enter a valid email address.");
    }
  });

  it("requires phone (unlike the general client model, where it's optional)", () => {
    const result = quickCreateClientSchema.safeParse({ ...VALID, phone: "" });
    expect(result.success).toBe(false);
  });

  it("trims whitespace from first/last name", () => {
    const result = quickCreateClientSchema.safeParse({ ...VALID, firstName: "  John  ", lastName: "  Smith  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.firstName).toBe("John");
      expect(result.data.lastName).toBe("Smith");
    }
  });
});
