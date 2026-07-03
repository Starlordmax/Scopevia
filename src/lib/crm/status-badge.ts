/**
 * Maps a status value to a badge color modifier class (badge-success/
 * -warning/-danger/-neutral), applied ALONGSIDE the existing `badge` class
 * — never replacing it, since tests/e2e/*.spec.ts locate status badges via
 * `.locator(".badge").filter({ hasText: ... })`. Purely a visual affordance;
 * the status text itself remains the source of truth everywhere.
 */
export function opportunityBadgeClass(status: string): string {
  switch (status) {
    case "won":
      return "badge-success";
    case "lost":
      return "badge-danger";
    case "archived":
      return "badge-neutral";
    case "inspection_scheduled":
      return "badge-warning";
    default:
      return "";
  }
}

export function projectBadgeClass(status: string): string {
  switch (status) {
    case "ready_for_estimate":
      return "badge-success";
    case "cancelled":
      return "badge-danger";
    case "archived":
      return "badge-neutral";
    case "inspection_pending":
      return "badge-warning";
    default:
      return "";
  }
}
