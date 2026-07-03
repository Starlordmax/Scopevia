import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * One page title + at most one primary action, by design (see
 * docs/26-phase-1.6-ui-redesign.md, "action oriented") — never pass more
 * than one button as `action`. `secondary` is for a lower-emphasis control
 * that belongs next to the title but isn't the page's main action (e.g. a
 * "List view" toggle).
 */
export function PageHeader({
  icon: Icon,
  title,
  description,
  action,
  secondary,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="page-header-heading">
        {Icon ? (
          <span className="page-header-icon">
            <Icon size={20} aria-hidden="true" />
          </span>
        ) : null}
        <div>
          <h1>{title}</h1>
          {description ? <p className="hint">{description}</p> : null}
        </div>
      </div>
      {action || secondary ? (
        <div className="tenant-form" style={{ alignItems: "center" }}>
          {secondary}
          {action}
        </div>
      ) : null}
    </div>
  );
}
