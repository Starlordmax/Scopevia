import { describe, expect, it } from "vitest";
import {
  createProposalDirectSchema,
  createProposalFromOpportunitySchema,
  addMeasurementSchema,
  saveMeasurementShapeSchema,
  saveMeasurementPolygonShapeSchema,
} from "../../src/lib/validation/proposals";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("createProposalDirectSchema — custom service name", () => {
  it("requires customServiceName when serviceType is 'custom'", () => {
    const result = createProposalDirectSchema.safeParse({
      clientId: VALID_UUID,
      title: "A proposal",
      serviceType: "custom",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.find((i) => i.path[0] === "customServiceName")?.message).toBe(
      "Enter a name for this custom service."
    );
  });

  it("rejects a blank/whitespace-only customServiceName for a custom service type", () => {
    const result = createProposalDirectSchema.safeParse({
      clientId: VALID_UUID,
      title: "A proposal",
      serviceType: "custom",
      customServiceName: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a custom service type with a real name", () => {
    const result = createProposalDirectSchema.safeParse({
      clientId: VALID_UUID,
      title: "A proposal",
      serviceType: "custom",
      customServiceName: "Deck repair",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.customServiceName).toBe("Deck repair");
  });

  it("does NOT require customServiceName for a non-custom service type", () => {
    const result = createProposalDirectSchema.safeParse({
      clientId: VALID_UUID,
      title: "A proposal",
      serviceType: "interior_painting",
    });
    expect(result.success).toBe(true);
  });

  it("does not error even if a stray customServiceName is sent for a non-custom service type (server discards it)", () => {
    const result = createProposalDirectSchema.safeParse({
      clientId: VALID_UUID,
      title: "A proposal",
      serviceType: "flooring",
      customServiceName: "Leftover text",
    });
    expect(result.success).toBe(true);
  });
});

describe("createProposalFromOpportunitySchema — custom service name", () => {
  it("requires customServiceName when serviceType is 'custom'", () => {
    const result = createProposalFromOpportunitySchema.safeParse({
      opportunityId: VALID_UUID,
      title: "A proposal",
      serviceType: "custom",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a custom service type with a real name", () => {
    const result = createProposalFromOpportunitySchema.safeParse({
      opportunityId: VALID_UUID,
      title: "A proposal",
      serviceType: "custom",
      customServiceName: "Patio extension",
    });
    expect(result.success).toBe(true);
  });
});

describe("addMeasurementSchema — field validation messages", () => {
  it("requires a measurement name with the exact brief-specified message", () => {
    const result = addMeasurementSchema.safeParse({
      shapeType: "manual_rectangle",
      name: "",
      measurementType: "floor_area",
      unit: "ft",
      length: "10",
      width: "8",
      wastePercent: "0",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.find((i) => i.path[0] === "name")?.message).toBe("Measurement name is required.");
  });

  it("rejects a zero/missing length for manual_rectangle", () => {
    const result = addMeasurementSchema.safeParse({
      shapeType: "manual_rectangle",
      name: "Bathroom floor",
      measurementType: "floor_area",
      unit: "ft",
      length: "0",
      width: "8",
      wastePercent: "0",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a zero area for manual_area", () => {
    const result = addMeasurementSchema.safeParse({
      shapeType: "manual_area",
      name: "Patio",
      measurementType: "surface",
      unit: "ft",
      area: "0",
      wastePercent: "0",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a zero linear length for manual_linear", () => {
    const result = addMeasurementSchema.safeParse({
      shapeType: "manual_linear",
      name: "Trim run",
      measurementType: "linear",
      unit: "ft",
      linearLength: "0",
      wastePercent: "0",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid manual_rectangle measurement", () => {
    const result = addMeasurementSchema.safeParse({
      shapeType: "manual_rectangle",
      name: "Bathroom floor",
      measurementType: "floor_area",
      unit: "ft",
      length: "10",
      width: "8",
      wastePercent: "0",
    });
    expect(result.success).toBe(true);
  });
});

describe("saveMeasurementShapeSchema / saveMeasurementPolygonShapeSchema — reference length", () => {
  it("uses the exact brief-specified message for a missing/zero reference length (rectangle)", () => {
    const result = saveMeasurementShapeSchema.safeParse({
      name: "Kitchen floor",
      measurementType: "floor_area",
      unit: "ft",
      length: "10",
      width: "8",
      scaleReferenceLength: "0",
      scaleUnit: "ft",
      wastePercent: "0",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.find((i) => i.path[0] === "scaleReferenceLength")?.message).toBe(
      "Enter a reference length greater than 0."
    );
  });

  it("uses the exact brief-specified message for a missing/zero reference length (freehand)", () => {
    const result = saveMeasurementPolygonShapeSchema.safeParse({
      name: "Living room",
      measurementType: "floor_area",
      unit: "ft",
      scaleReferenceLength: "-1",
      scaleUnit: "ft",
      closed: "true",
      wastePercent: "0",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.find((i) => i.path[0] === "scaleReferenceLength")?.message).toBe(
      "Enter a reference length greater than 0."
    );
  });

  it("requires a measurement name for a freehand drawing", () => {
    const result = saveMeasurementPolygonShapeSchema.safeParse({
      name: "",
      measurementType: "floor_area",
      unit: "ft",
      scaleReferenceLength: "10",
      scaleUnit: "ft",
      closed: "true",
      wastePercent: "0",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.find((i) => i.path[0] === "name")?.message).toBe("Measurement name is required.");
  });

  it("accepts a valid freehand drawing submission", () => {
    const result = saveMeasurementPolygonShapeSchema.safeParse({
      name: "Living room",
      measurementType: "floor_area",
      unit: "ft",
      scaleReferenceLength: "10",
      scaleUnit: "ft",
      closed: "true",
      wastePercent: "0",
    });
    expect(result.success).toBe(true);
  });
});
