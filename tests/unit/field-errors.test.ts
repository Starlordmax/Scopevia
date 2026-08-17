import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodIssuesToFieldErrors, attributeRpcErrorToField } from "../../src/lib/validation/field-errors";

describe("zodIssuesToFieldErrors", () => {
  it("maps each top-level field to its first issue message", () => {
    const schema = z.object({
      name: z.string().trim().min(1, "Name is required"),
      age: z.coerce.number().positive("Age must be positive"),
    });
    const result = schema.safeParse({ name: "", age: -1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = zodIssuesToFieldErrors(result.error);
    expect(fieldErrors).toEqual({ name: "Name is required", age: "Age must be positive" });
  });

  it("keeps only the FIRST message when a field has multiple issues", () => {
    const schema = z.object({ email: z.string().min(1, "Required").email("Must be a valid email") });
    const result = schema.safeParse({ email: "" });
    if (result.success) return;
    const fieldErrors = zodIssuesToFieldErrors(result.error);
    expect(fieldErrors.email).toBe("Required");
  });

  it("attributes a .superRefine() issue with an explicit path to that field", () => {
    const schema = z
      .object({ serviceType: z.string(), customServiceName: z.string().optional() })
      .superRefine((data, ctx) => {
        if (data.serviceType === "custom" && !data.customServiceName) {
          ctx.addIssue({ code: "custom", path: ["customServiceName"], message: "Enter a name for this custom service." });
        }
      });
    const result = schema.safeParse({ serviceType: "custom" });
    if (result.success) return;
    const fieldErrors = zodIssuesToFieldErrors(result.error);
    expect(fieldErrors).toEqual({ customServiceName: "Enter a name for this custom service." });
  });
});

describe("attributeRpcErrorToField", () => {
  it("returns the field for the first matching substring", () => {
    const field = attributeRpcErrorToField("Enter a name for this custom service.", [
      ["Enter a name for this custom service.", "customServiceName"],
    ]);
    expect(field).toBe("customServiceName");
  });

  it("checks mappings in order, first match wins", () => {
    const field = attributeRpcErrorToField("Close the shape before saving an area measurement", [
      ["reference length", "scaleReferenceLength"],
      ["Close the shape before saving an area measurement", "drawing"],
    ]);
    expect(field).toBe("drawing");
  });

  it("returns undefined when nothing matches, never swallowing an unrecognized message", () => {
    const field = attributeRpcErrorToField("Some unrelated error", [["reference length", "scaleReferenceLength"]]);
    expect(field).toBeUndefined();
  });
});
