import { describe, expect, it } from "vitest";
import { zodIssuesToFieldErrors } from "../../src/lib/validation/field-errors";
import {
  serviceTypeSchema,
  createProposalDirectSchema,
  createMeasurementGroupSchema,
  generateMaterialFromMeasurementSchema,
  addLaborFromMeasurementSchema,
  updateProposalSettingsSchema,
  addProposalSectionSchema,
  addProposalLineItemSchema,
} from "../../src/lib/validation/proposals";
import { createOpportunitySchema, changeOpportunityStatusSchema } from "../../src/lib/validation/crm";

/**
 * Covers the friendly, field-specific messages added while wiring the
 * app-wide required-field red-state UX (see
 * docs/75-global-field-validation.md) — every field here previously fell
 * back to a generic Zod message or a plain `{ error }`-only Server Action
 * result with no fieldErrors at all.
 */

describe("serviceTypeSchema", () => {
  it("rejects an empty/missing service type with a friendly message", () => {
    const result = serviceTypeSchema.safeParse("");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toBe("Please select a service type.");
  });
});

describe("createProposalDirectSchema", () => {
  const base = { title: "Exterior repaint", serviceType: "exterior_painting" as const };

  it("requires a client with a friendly message, mapped to the clientId field", () => {
    const result = createProposalDirectSchema.safeParse({ ...base, clientId: "" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = zodIssuesToFieldErrors(result.error);
    expect(fieldErrors.clientId).toBe("Please select a client.");
  });

  it("still shows the friendly message when clientId is entirely missing, not Zod's default type-mismatch text", () => {
    // A <select> submitted with no option selected at all (selectedIndex
    // -1) contributes no key to FormData, so this field can arrive as
    // `null`/`undefined` here, not just an empty string -- that path must
    // not fall back to a raw "expected string, received X" message.
    const result = createProposalDirectSchema.safeParse({ ...base, clientId: undefined });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(zodIssuesToFieldErrors(result.error).clientId).toBe("Please select a client.");
  });

  it("requires a title, mapped to the title field", () => {
    const result = createProposalDirectSchema.safeParse({
      ...base,
      clientId: "00000000-0000-0000-0000-000000000000",
      title: "",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(zodIssuesToFieldErrors(result.error).title).toBe("Title is required");
  });
});

describe("createOpportunitySchema", () => {
  it("requires a client with a friendly message, mapped to the clientId field", () => {
    const result = createOpportunitySchema.safeParse({ clientId: "", title: "New roof" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(zodIssuesToFieldErrors(result.error).clientId).toBe("Please select a client.");
  });
});

describe("changeOpportunityStatusSchema", () => {
  it("maps a missing lost reason to the lostReason field", () => {
    const result = changeOpportunityStatusSchema.safeParse({ newStatus: "lost" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(zodIssuesToFieldErrors(result.error).lostReason).toBe("Tell us why this opportunity was lost.");
  });

  it("maps a missing inspection date to the inspectionScheduledAt field", () => {
    const result = changeOpportunityStatusSchema.safeParse({ newStatus: "inspection_scheduled" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(zodIssuesToFieldErrors(result.error).inspectionScheduledAt).toBe("Choose an inspection date and time.");
  });

  it("does not require lostReason/inspectionScheduledAt for other statuses", () => {
    expect(changeOpportunityStatusSchema.safeParse({ newStatus: "won" }).success).toBe(true);
  });
});

describe("createMeasurementGroupSchema", () => {
  it("maps a blank name to the name field", () => {
    const result = createMeasurementGroupSchema.safeParse({ name: "  " });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(zodIssuesToFieldErrors(result.error).name).toBe("Name is required");
  });
});

describe("generateMaterialFromMeasurementSchema", () => {
  const base = { materialCatalogItemId: "00000000-0000-0000-0000-000000000000", measurementValueField: "area" as const };

  it("maps a missing coverage rate to the coverageRate field", () => {
    const result = generateMaterialFromMeasurementSchema.safeParse({ ...base, coverageRate: "" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(zodIssuesToFieldErrors(result.error).coverageRate).toBeTruthy();
  });
});

describe("addLaborFromMeasurementSchema", () => {
  it("maps a blank label to the label field and a missing rate to rateCents", () => {
    const result = addLaborFromMeasurementSchema.safeParse({ label: "", pricingMethod: "area", rateCents: "" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = zodIssuesToFieldErrors(result.error);
    expect(fieldErrors.label).toBeTruthy();
    expect(fieldErrors.rateCents).toBeTruthy();
  });
});

describe("updateProposalSettingsSchema", () => {
  const base = {
    defaultCustomerHourlyRate: "45.00",
    defaultHoursPerDay: "8",
    defaultProposalValidDays: "30",
    proposalNumberPrefix: "EST",
  };

  it("rejects hours per day outside 0.5-24 with a friendly message", () => {
    const result = updateProposalSettingsSchema.safeParse({ ...base, defaultHoursPerDay: "30" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(zodIssuesToFieldErrors(result.error).defaultHoursPerDay).toBe("Enter hours per day between 0.5 and 24.");
  });

  it("rejects a validity window outside 1-365 days with a friendly message", () => {
    const result = updateProposalSettingsSchema.safeParse({ ...base, defaultProposalValidDays: "0" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(zodIssuesToFieldErrors(result.error).defaultProposalValidDays).toBe("Enter a number of days between 1 and 365.");
  });

  it("requires a proposal number prefix", () => {
    const result = updateProposalSettingsSchema.safeParse({ ...base, proposalNumberPrefix: "" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(zodIssuesToFieldErrors(result.error).proposalNumberPrefix).toBe("Prefix is required");
  });
});

describe("addProposalSectionSchema", () => {
  it("maps a blank section title to the title field", () => {
    const result = addProposalSectionSchema.safeParse({ title: "" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(zodIssuesToFieldErrors(result.error).title).toBe("Section title is required");
  });
});

describe("addProposalLineItemSchema", () => {
  const base = { category: "material" as const, unit: "each" as const };

  it("maps a blank description to the description field", () => {
    const result = addProposalLineItemSchema.safeParse({ ...base, description: "", quantity: "1", unitPriceCents: "10.00" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(zodIssuesToFieldErrors(result.error).description).toBe("Description is required");
  });

  it("maps a zero quantity to the quantity field", () => {
    const result = addProposalLineItemSchema.safeParse({ ...base, description: "Paint", quantity: "0", unitPriceCents: "10.00" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(zodIssuesToFieldErrors(result.error).quantity).toBe("Must be greater than zero");
  });

  it("maps a missing unit price to the unitPriceCents field", () => {
    const result = addProposalLineItemSchema.safeParse({ ...base, description: "Paint", quantity: "1", unitPriceCents: "" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(zodIssuesToFieldErrors(result.error).unitPriceCents).toBeTruthy();
  });
});
