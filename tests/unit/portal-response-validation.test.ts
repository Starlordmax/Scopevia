import { describe, expect, it } from "vitest";
import { acceptProposalSchema, declineProposalSchema } from "../../src/lib/validation/portal";

const TOKEN = "a".repeat(32);

describe("acceptProposalSchema", () => {
  it("accepts a valid submission", () => {
    const result = acceptProposalSchema.safeParse({ token: TOKEN, clientName: "Jane Doe", acceptedTerms: true });
    expect(result.success).toBe(true);
  });

  it("requires a client name", () => {
    const result = acceptProposalSchema.safeParse({ token: TOKEN, clientName: "", acceptedTerms: true });
    expect(result.success).toBe(false);
  });

  it("requires a client name that isn't just whitespace", () => {
    const result = acceptProposalSchema.safeParse({ token: TOKEN, clientName: "   ", acceptedTerms: true });
    expect(result.success).toBe(false);
  });

  it("requires acceptedTerms to be true, not merely truthy", () => {
    const result = acceptProposalSchema.safeParse({ token: TOKEN, clientName: "Jane Doe", acceptedTerms: false });
    expect(result.success).toBe(false);
  });

  it("rejects a client name over 120 characters", () => {
    const result = acceptProposalSchema.safeParse({ token: TOKEN, clientName: "x".repeat(121), acceptedTerms: true });
    expect(result.success).toBe(false);
  });
});

describe("declineProposalSchema", () => {
  it("accepts a submission with a reason", () => {
    const result = declineProposalSchema.safeParse({ token: TOKEN, declineReason: "Too expensive" });
    expect(result.success).toBe(true);
  });

  it("reason is optional -- a decline with no reason at all is valid", () => {
    const result = declineProposalSchema.safeParse({ token: TOKEN, declineReason: undefined });
    expect(result.success).toBe(true);
  });

  it("reason is optional -- omitting the key entirely is valid", () => {
    const result = declineProposalSchema.safeParse({ token: TOKEN });
    expect(result.success).toBe(true);
  });

  it("rejects an unreasonably long reason", () => {
    const result = declineProposalSchema.safeParse({ token: TOKEN, declineReason: "x".repeat(2001) });
    expect(result.success).toBe(false);
  });
});
