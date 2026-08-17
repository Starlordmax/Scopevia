"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../lib/supabase/server";
import { requireUser } from "../lib/auth/session";
import { uuidSchema } from "../lib/validation/schemas";
import {
  createMeasurementGroupSchema,
  addMeasurementSchema,
  updateMeasurementSchema,
  saveMeasurementShapeSchema,
  saveMeasurementPolygonShapeSchema,
  generateMaterialFromMeasurementSchema,
  addLaborFromMeasurementSchema,
} from "../lib/validation/proposals";
import { friendlyRpcErrorMessage } from "../lib/errors/friendly-message";
import { zodIssuesToFieldErrors, attributeRpcErrorToField } from "../lib/validation/field-errors";
import type { ActionResult } from "./auth";
import type { Json } from "../../types/database";

/** Shared RPC-error → field mapping for both drawn-shape save actions (rectangle and freehand) — the SQL layer's own re-validation of things Zod already checked, or things only the DB can know (a degenerate/unclosed shape). */
const DRAWING_RPC_FIELD_MAP: [string, string][] = [
  ["reference length", "scaleReferenceLength"],
  ["Close the shape before saving an area measurement", "drawing"],
  ["Draw the area before saving", "drawing"],
  ["Measurement name is required", "name"],
];

export async function createMeasurementGroupAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const proposalVersionId = uuidSchema.safeParse(formData.get("proposalVersionId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!proposalVersionId.success || !proposalId.success) return { error: "Invalid request" };

  const parsed = createMeasurementGroupSchema.safeParse({
    name: formData.get("name"),
    unitSystem: formData.get("unitSystem") || undefined,
    serviceType: formData.get("serviceType") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors: zodIssuesToFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  // `as string` cast for the same reason as update_proposal_scope
  // (docs/37): p_service_type has a SQL DEFAULT NULL, Postgres accepts
  // null, but the generated arg type comes out non-nullable.
  const { error } = await supabase.rpc("create_measurement_group", {
    p_proposal_version_id: proposalVersionId.data,
    p_name: parsed.data.name,
    p_unit_system: parsed.data.unitSystem,
    p_service_type: (parsed.data.serviceType ?? null) as string,
  });
  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  revalidatePath(`/proposals/${proposalId.data}/edit`);
  return {};
}

export async function addMeasurementAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const proposalVersionId = uuidSchema.safeParse(formData.get("proposalVersionId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  const measurementGroupId = uuidSchema.safeParse(formData.get("measurementGroupId"));
  if (!proposalVersionId.success || !proposalId.success || !measurementGroupId.success) return { error: "Invalid request" };

  const parsed = addMeasurementSchema.safeParse({
    shapeType: formData.get("shapeType"),
    name: formData.get("name"),
    measurementType: formData.get("measurementType"),
    unit: formData.get("unit"),
    length: formData.get("length") || undefined,
    width: formData.get("width") || undefined,
    height: formData.get("height") || undefined,
    area: formData.get("area") || undefined,
    linearLength: formData.get("linearLength") || undefined,
    wastePercent: formData.get("wastePercent") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    const fieldErrors = zodIssuesToFieldErrors(parsed.error);
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_measurement", {
    p_proposal_version_id: proposalVersionId.data,
    p_measurement_group_id: measurementGroupId.data,
    p_name: parsed.data.name,
    p_measurement_type: parsed.data.measurementType,
    p_shape_type: parsed.data.shapeType,
    p_unit: parsed.data.unit,
    p_length: (parsed.data.shapeType === "manual_rectangle" ? parsed.data.length : null) as number,
    p_width: (parsed.data.shapeType === "manual_rectangle" ? parsed.data.width : null) as number,
    p_height: (parsed.data.shapeType === "manual_rectangle" ? (parsed.data.height ?? null) : null) as number,
    p_area: (parsed.data.shapeType === "manual_area" ? parsed.data.area : null) as number,
    p_linear_length: (parsed.data.shapeType === "manual_linear" ? parsed.data.linearLength : null) as number,
    p_waste_bps: parsed.data.wastePercent,
    p_notes: (parsed.data.notes ?? null) as string,
  });
  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  revalidatePath(`/proposals/${proposalId.data}/edit`);
  return {};
}

export async function updateMeasurementAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const measurementId = uuidSchema.safeParse(formData.get("measurementId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!measurementId.success || !proposalId.success) return { error: "Invalid request" };

  const parsed = updateMeasurementSchema.safeParse({
    shapeType: formData.get("shapeType"),
    name: formData.get("name"),
    measurementType: formData.get("measurementType"),
    unit: formData.get("unit"),
    length: formData.get("length") || undefined,
    width: formData.get("width") || undefined,
    height: formData.get("height") || undefined,
    area: formData.get("area") || undefined,
    linearLength: formData.get("linearLength") || undefined,
    wastePercent: formData.get("wastePercent") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    const fieldErrors = zodIssuesToFieldErrors(parsed.error);
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_measurement", {
    p_measurement_id: measurementId.data,
    p_name: parsed.data.name,
    p_measurement_type: parsed.data.measurementType,
    p_length: (parsed.data.shapeType === "manual_rectangle" ? parsed.data.length : null) as number,
    p_width: (parsed.data.shapeType === "manual_rectangle" ? parsed.data.width : null) as number,
    p_height: (parsed.data.shapeType === "manual_rectangle" ? (parsed.data.height ?? null) : null) as number,
    p_area: (parsed.data.shapeType === "manual_area" ? parsed.data.area : null) as number,
    p_linear_length: (parsed.data.shapeType === "manual_linear" ? parsed.data.linearLength : null) as number,
    p_waste_bps: parsed.data.wastePercent,
    p_notes: (parsed.data.notes ?? null) as string,
  });
  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  revalidatePath(`/proposals/${proposalId.data}/edit`);
  return {};
}

export async function archiveMeasurementAction(formData: FormData): Promise<void> {
  await requireUser();
  const measurementId = uuidSchema.safeParse(formData.get("measurementId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!measurementId.success || !proposalId.success) return;

  const supabase = await createClient();
  await supabase.rpc("archive_measurement", { p_measurement_id: measurementId.data });
  revalidatePath(`/proposals/${proposalId.data}/edit`);
}

export async function saveMeasurementShapeAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const proposalVersionId = uuidSchema.safeParse(formData.get("proposalVersionId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  const measurementGroupId = uuidSchema.safeParse(formData.get("measurementGroupId"));
  if (!proposalVersionId.success || !proposalId.success || !measurementGroupId.success) return { error: "Invalid request" };

  const shapeDataRaw = formData.get("shapeData");
  let shapeData: Json;
  try {
    shapeData = JSON.parse(typeof shapeDataRaw === "string" ? shapeDataRaw : "{}") as Json;
  } catch {
    return { error: "Invalid drawing data" };
  }

  const parsed = saveMeasurementShapeSchema.safeParse({
    name: formData.get("name"),
    measurementType: formData.get("measurementType"),
    unit: formData.get("unit"),
    length: formData.get("length") || undefined,
    width: formData.get("width") || undefined,
    scaleReferenceLength: formData.get("scaleReferenceLength") || undefined,
    scaleUnit: formData.get("scaleUnit"),
    wastePercent: formData.get("wastePercent") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    const fieldErrors = zodIssuesToFieldErrors(parsed.error);
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_measurement_shape", {
    p_proposal_version_id: proposalVersionId.data,
    p_measurement_group_id: measurementGroupId.data,
    p_name: parsed.data.name,
    p_measurement_type: parsed.data.measurementType,
    p_unit: parsed.data.unit,
    p_length: parsed.data.length,
    p_width: parsed.data.width,
    p_scale_reference_length: parsed.data.scaleReferenceLength,
    p_scale_unit: parsed.data.scaleUnit,
    p_shape_data: shapeData,
    p_waste_bps: parsed.data.wastePercent,
    p_notes: (parsed.data.notes ?? null) as string,
  });
  if (error) {
    const message = friendlyRpcErrorMessage(error.message);
    const field = attributeRpcErrorToField(message, DRAWING_RPC_FIELD_MAP);
    return { error: message, fieldErrors: field ? { [field]: message } : undefined };
  }

  revalidatePath(`/proposals/${proposalId.data}/edit`);
  return {};
}

/**
 * Freehand/brush drawing — one or more independent strokes (Phase 2C.1;
 * multi-stroke fix in docs/74-custom-service-name-and-multistroke-drawing.md).
 * `strokes` (an array of point arrays, one per stroke) is already
 * converted to real-world units client-side (the same "client scales,
 * server computes the derived value" split as saveMeasurementShapeAction
 * above) — this action does a shallow structural/count check (never a
 * crash on malformed JSON) and forwards the strokes to the RPC, which
 * independently recomputes area/perimeter/linear_length rather than
 * trusting any client-computed value.
 */
export async function saveMeasurementPolygonShapeAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const proposalVersionId = uuidSchema.safeParse(formData.get("proposalVersionId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  const measurementGroupId = uuidSchema.safeParse(formData.get("measurementGroupId"));
  if (!proposalVersionId.success || !proposalId.success || !measurementGroupId.success) return { error: "Invalid request" };

  const strokesRaw = formData.get("strokes");
  const shapeDataRaw = formData.get("shapeData");
  let strokes: Json;
  let shapeData: Json;
  try {
    strokes = JSON.parse(typeof strokesRaw === "string" ? strokesRaw : "[]") as Json;
    shapeData = JSON.parse(typeof shapeDataRaw === "string" ? shapeDataRaw : "{}") as Json;
  } catch {
    return { error: "Invalid drawing data" };
  }

  const closed = formData.get("closed") === "true";
  const totalPoints: number = Array.isArray(strokes)
    ? (strokes as unknown[]).reduce((sum: number, stroke) => sum + (Array.isArray(stroke) ? stroke.length : 0), 0)
    : 0;
  if (!Array.isArray(strokes) || strokes.length === 0 || (!closed && totalPoints < 2)) {
    return { error: "Draw the area before saving.", fieldErrors: { drawing: "Draw the area before saving." } };
  }
  if (closed && totalPoints < 3) {
    return { error: "Close the shape before saving an area measurement.", fieldErrors: { drawing: "Close the shape before saving an area measurement." } };
  }

  const parsed = saveMeasurementPolygonShapeSchema.safeParse({
    name: formData.get("name"),
    measurementType: formData.get("measurementType"),
    unit: formData.get("unit"),
    scaleReferenceLength: formData.get("scaleReferenceLength") || undefined,
    scaleUnit: formData.get("scaleUnit"),
    closed,
    wastePercent: formData.get("wastePercent") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    const fieldErrors = zodIssuesToFieldErrors(parsed.error);
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_measurement_polygon_shape", {
    p_proposal_version_id: proposalVersionId.data,
    p_measurement_group_id: measurementGroupId.data,
    p_name: parsed.data.name,
    p_measurement_type: parsed.data.measurementType,
    p_unit: parsed.data.unit,
    p_strokes: strokes,
    p_closed: parsed.data.closed,
    p_scale_reference_length: parsed.data.scaleReferenceLength,
    p_scale_unit: parsed.data.scaleUnit,
    p_shape_data: shapeData,
    p_waste_bps: parsed.data.wastePercent,
    p_notes: (parsed.data.notes ?? null) as string,
  });
  if (error) {
    const message = friendlyRpcErrorMessage(error.message);
    const field = attributeRpcErrorToField(message, DRAWING_RPC_FIELD_MAP);
    return { error: message, fieldErrors: field ? { [field]: message } : undefined };
  }

  revalidatePath(`/proposals/${proposalId.data}/edit`);
  return {};
}

export async function generateMaterialFromMeasurementAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const proposalVersionId = uuidSchema.safeParse(formData.get("proposalVersionId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  const measurementId = uuidSchema.safeParse(formData.get("measurementId"));
  if (!proposalVersionId.success || !proposalId.success || !measurementId.success) return { error: "Invalid request" };

  const parsed = generateMaterialFromMeasurementSchema.safeParse({
    materialCatalogItemId: formData.get("materialCatalogItemId"),
    measurementValueField: formData.get("measurementValueField"),
    coverageRate: formData.get("coverageRate"),
    coverageUnit: formData.get("coverageUnit") || undefined,
    coats: formData.get("coats") || undefined,
    wastePercent: formData.get("wastePercent") || undefined,
    zipCode: formData.get("zipCode") || undefined,
    sectionId: formData.get("sectionId") || undefined,
    unitPriceCentsOverride: formData.get("unitPriceOverride") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors: zodIssuesToFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  // `as` casts for the same reason as update_proposal_scope (docs/37):
  // these params have SQL DEFAULT NULL, Postgres accepts null, but the
  // generated arg types come out non-nullable.
  const { error } = await supabase.rpc("generate_material_from_measurement", {
    p_proposal_version_id: proposalVersionId.data,
    p_proposal_measurement_id: measurementId.data,
    p_material_catalog_item_id: parsed.data.materialCatalogItemId,
    p_measurement_value_field: parsed.data.measurementValueField,
    p_coverage_rate: parsed.data.coverageRate,
    p_coverage_unit: (parsed.data.coverageUnit ?? null) as string,
    p_coats: parsed.data.coats,
    p_waste_bps: parsed.data.wastePercent,
    p_zip_code: (parsed.data.zipCode ?? null) as string,
    p_unit_price_cents_override: (parsed.data.unitPriceCentsOverride ?? null) as number,
    p_taxable: true,
    p_section_id: (parsed.data.sectionId ?? null) as string,
  });
  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  revalidatePath(`/proposals/${proposalId.data}/edit`);
  return {};
}

export async function addLaborFromMeasurementAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const proposalVersionId = uuidSchema.safeParse(formData.get("proposalVersionId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  const measurementId = uuidSchema.safeParse(formData.get("measurementId"));
  if (!proposalVersionId.success || !proposalId.success || !measurementId.success) return { error: "Invalid request" };

  const parsed = addLaborFromMeasurementSchema.safeParse({
    label: formData.get("label"),
    pricingMethod: formData.get("pricingMethod"),
    rateCents: formData.get("rate"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors: zodIssuesToFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_proposal_labor_item_from_measurement", {
    p_proposal_version_id: proposalVersionId.data,
    p_proposal_measurement_id: measurementId.data,
    p_label: parsed.data.label,
    p_pricing_method: parsed.data.pricingMethod,
    p_rate_cents: parsed.data.rateCents,
  });
  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  revalidatePath(`/proposals/${proposalId.data}/edit`);
  return {};
}
