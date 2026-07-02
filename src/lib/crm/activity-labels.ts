/**
 * Turns a crm_activities row into a human-friendly, UUID-free sentence for
 * the CRM activity timeline (distinct from the security audit_logs view —
 * see docs/20-phase-1-crm-and-projects.md).
 */
export function describeActivity(activityType: string, metadata: Record<string, unknown>): string {
  const from = typeof metadata.from_status === "string" ? humanizeStatus(metadata.from_status) : undefined;
  const to = typeof metadata.to_status === "string" ? humanizeStatus(metadata.to_status) : undefined;

  switch (activityType) {
    case "client_created":
      return "Client created";
    case "client_archived":
      return "Client archived";
    case "client_restored":
      return "Client restored";
    case "contact_created":
      return "Contact added";
    case "contact_primary_changed":
      return "Primary contact changed";
    case "contact_archived":
      return "Contact archived";
    case "contact_restored":
      return "Contact restored";
    case "opportunity_created":
      return "Opportunity created";
    case "opportunity_won":
      return "Opportunity marked as won";
    case "opportunity_lost":
      return typeof metadata.reason === "string" ? `Opportunity marked as lost — ${metadata.reason}` : "Opportunity marked as lost";
    case "opportunity_archived":
      return "Opportunity archived";
    case "opportunity_restored":
      return "Opportunity restored";
    case "opportunity_converted_to_project":
      return "Converted to a project";
    case "project_created":
      return "Project created";
    case "project_archived":
      return "Project archived";
    case "project_restored":
      return "Project restored";
    case "inspection_scheduled":
      return "Inspection scheduled";
    case "address_primary_changed":
      return "Primary address changed";
    case "status_changed":
      return from && to ? `Status changed from ${from} to ${to}` : "Status changed";
    case "note_added":
      return "Note added";
    default:
      return activityType.replace(/_/g, " ");
  }
}

function humanizeStatus(status: string): string {
  return status.replace(/_/g, " ");
}
