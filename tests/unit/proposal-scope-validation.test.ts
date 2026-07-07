import { describe, expect, it } from "vitest";
import { updateProposalScopeSchema } from "../../src/lib/validation/proposals";

describe("updateProposalScopeSchema", () => {
  it("normalizes empty strings to null, not undefined, for every optional field", () => {
    const result = updateProposalScopeSchema.safeParse({
      summary: "",
      scopeIntro: "",
      estimatedStartDate: "",
      estimatedDurationDays: "",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.summary).toBeNull();
    expect(result.data.scopeIntro).toBeNull();
    expect(result.data.estimatedStartDate).toBeNull();
    expect(result.data.estimatedDurationDays).toBeNull();
    // Explicitly not undefined: JSON.stringify drops undefined-valued keys,
    // which is exactly what caused update_proposal_scope's "not found in
    // schema cache" bug. null must survive JSON encoding as a real value.
    expect(result.data.summary).not.toBeUndefined();
    expect(result.data.estimatedDurationDays).not.toBeUndefined();
  });

  it("normalizes a missing (undefined) field to null the same way as an empty string", () => {
    const result = updateProposalScopeSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.summary).toBeNull();
    expect(result.data.scopeIntro).toBeNull();
    expect(result.data.estimatedStartDate).toBeNull();
    expect(result.data.estimatedDurationDays).toBeNull();
  });

  it("accepts only summary and a start date, leaving the rest null (the exact reported bug scenario)", () => {
    const result = updateProposalScopeSchema.safeParse({
      summary: "Painting house",
      scopeIntro: "",
      estimatedStartDate: "2026-01-20",
      estimatedDurationDays: "",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.summary).toBe("Painting house");
    expect(result.data.scopeIntro).toBeNull();
    expect(result.data.estimatedStartDate).toBe("2026-01-20");
    expect(result.data.estimatedDurationDays).toBeNull();
  });

  it("never converts an empty estimatedDurationDays into 0", () => {
    const result = updateProposalScopeSchema.safeParse({ estimatedDurationDays: "" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.estimatedDurationDays).toBeNull();
    expect(result.data.estimatedDurationDays).not.toBe(0);
  });

  it("rejects an estimatedDurationDays of 0 or negative when actually provided", () => {
    expect(updateProposalScopeSchema.safeParse({ estimatedDurationDays: "0" }).success).toBe(false);
    expect(updateProposalScopeSchema.safeParse({ estimatedDurationDays: "-3" }).success).toBe(false);
  });

  it("accepts a valid positive integer duration", () => {
    const result = updateProposalScopeSchema.safeParse({ estimatedDurationDays: "12" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.estimatedDurationDays).toBe(12);
  });

  it("rejects a non-integer duration", () => {
    expect(updateProposalScopeSchema.safeParse({ estimatedDurationDays: "3.5" }).success).toBe(false);
  });

  it("accepts a valid ISO date", () => {
    const result = updateProposalScopeSchema.safeParse({ estimatedStartDate: "2026-01-20" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.estimatedStartDate).toBe("2026-01-20");
  });

  it("rejects a syntactically-shaped but calendar-invalid date (Feb 30)", () => {
    expect(updateProposalScopeSchema.safeParse({ estimatedStartDate: "2026-02-30" }).success).toBe(false);
  });

  it("rejects a non-ISO date format (does not trust locale-formatted input)", () => {
    expect(updateProposalScopeSchema.safeParse({ estimatedStartDate: "01/20/2026" }).success).toBe(false);
    expect(updateProposalScopeSchema.safeParse({ estimatedStartDate: "20-01-2026" }).success).toBe(false);
  });

  it("trims and enforces the max length on summary and scopeIntro", () => {
    const result = updateProposalScopeSchema.safeParse({ summary: "  Painting house  " });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.summary).toBe("Painting house");

    expect(updateProposalScopeSchema.safeParse({ summary: "x".repeat(501) }).success).toBe(false);
    expect(updateProposalScopeSchema.safeParse({ scopeIntro: "x".repeat(4001) }).success).toBe(false);
  });

  it("accepts all fields empty (every field is optional at the schema level)", () => {
    const result = updateProposalScopeSchema.safeParse({
      summary: "",
      scopeIntro: "",
      estimatedStartDate: "",
      estimatedDurationDays: "",
    });
    expect(result.success).toBe(true);
  });
});
