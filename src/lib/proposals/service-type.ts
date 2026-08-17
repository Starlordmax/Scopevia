/**
 * Pure, shared "service type" display label — used by the builder's
 * page header, the standalone /preview route, the Phase 3C print/export
 * routes, and the Client Portal (all via proposal-document.tsx). Never
 * shows the bare enum value "custom" — see
 * docs/74-custom-service-name-and-multistroke-drawing.md.
 */
const SERVICE_TYPE_LABELS: Record<string, string> = {
  interior_painting: "Interior painting",
  exterior_painting: "Exterior painting",
  bathroom_remodeling: "Bathroom remodeling",
  general_remodeling: "General remodeling",
  flooring: "Flooring",
};

/**
 * `customServiceName` is required at creation whenever service_type is
 * 'custom' (enforced client + server-side — see createProposalDirectSchema
 * and the proposals_custom_service_name_required_check CHECK constraint),
 * but a pre-existing row from before this column existed could still have
 * one that's null/blank — "Custom service" is the documented fallback for
 * that case, never the raw word "custom".
 */
export function serviceTypeLabel(serviceType: string, customServiceName?: string | null): string {
  if (serviceType === "custom") {
    const trimmed = customServiceName?.trim();
    return trimmed ? trimmed : "Custom service";
  }
  return SERVICE_TYPE_LABELS[serviceType] ?? serviceType;
}
