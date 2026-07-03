import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * A real empty state explains what the module is, why it matters, and what
 * to do next — never just "0" or a bare "No X yet." (see
 * docs/26-phase-1.6-ui-redesign.md, "clear empty states"). `action` is
 * optional: read-only roles (e.g. Viewer) see the explanation without a
 * button they can't use.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        <Icon size={24} aria-hidden="true" />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
