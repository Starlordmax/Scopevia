import { describe, expect, it } from "vitest";
import { businessProfileSchema, tonePreferenceSchema } from "../../src/lib/validation/business-profile";

describe("businessProfileSchema", () => {
  const base = { businessName: "Mike's Painting" };

  it("accepts a minimal profile with only a business name", () => {
    const result = businessProfileSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.tonePreference).toBe("professional");
  });

  it("requires a non-blank business name", () => {
    expect(businessProfileSchema.safeParse({ businessName: "" }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ businessName: "   " }).success).toBe(false);
  });

  it("rejects an invalid business email but accepts a valid one", () => {
    expect(businessProfileSchema.safeParse({ ...base, businessEmail: "not-an-email" }).success).toBe(false);
    const result = businessProfileSchema.safeParse({ ...base, businessEmail: "contact@example.com" });
    expect(result.success).toBe(true);
  });

  it("accepts every declared tone preference and rejects an unknown one", () => {
    for (const tone of ["professional", "friendly", "direct", "detailed", "simple"]) {
      expect(businessProfileSchema.safeParse({ ...base, tonePreference: tone }).success).toBe(true);
    }
    expect(businessProfileSchema.safeParse({ ...base, tonePreference: "sarcastic" }).success).toBe(false);
  });

  it("treats every long-text field as optional", () => {
    const result = businessProfileSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.defaultWarrantyPolicy).toBeUndefined();
    expect(result.data.defaultExclusions).toBeUndefined();
  });

  it("caps long-text fields at a sane maximum instead of accepting unbounded input", () => {
    const tooLong = "a".repeat(5000);
    const result = businessProfileSchema.safeParse({ ...base, defaultWarrantyPolicy: tooLong });
    expect(result.success).toBe(false);
  });
});

describe("tonePreferenceSchema", () => {
  it("rejects an empty tone with a friendly message", () => {
    const result = tonePreferenceSchema.safeParse("");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toBe("Please select a tone.");
  });
});
