import Link from "next/link";
import { Kanban } from "lucide-react";
import { requireActiveTenant } from "../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../lib/auth/permissions";
import { createClient } from "../../../lib/supabase/server";
import { opportunityStatusLabel } from "../../../lib/crm/opportunity-transitions";
import { PageHeader } from "../../../components/page-header";
import { QuickAdvance } from "./quick-advance";
import type { OpportunityStatus } from "../../../../types/enums";

export const dynamic = "force-dynamic";

const PIPELINE_COLUMNS: OpportunityStatus[] = [
  "new",
  "contacted",
  "qualified",
  "inspection_scheduled",
  "ready_for_estimate",
  "won",
  "lost",
];

// Only "simple" transitions (no extra required fields) are offered from the
// board itself — see quick-advance.tsx.
const SIMPLE_TRANSITIONS: Partial<Record<OpportunityStatus, OpportunityStatus[]>> = {
  new: ["contacted"],
  contacted: ["qualified"],
  qualified: ["ready_for_estimate"],
  inspection_scheduled: ["qualified", "ready_for_estimate"],
  ready_for_estimate: ["qualified", "won"],
  lost: ["contacted", "qualified"],
};

function formatMoney(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export default async function PipelinePage() {
  const { tenant } = await requireActiveTenant();
  const canView = await hasPermission(tenant.tenant_id, PERMISSIONS.OPPORTUNITIES_VIEW);
  if (!canView) {
    return (
      <div className="stack">
        <h1>Pipeline</h1>
        <p className="hint">Your current role ({tenant.role_name}) does not include access to this page.</p>
      </div>
    );
  }
  const canChangeStatus = await hasPermission(tenant.tenant_id, PERMISSIONS.OPPORTUNITIES_CHANGE_STATUS);
  const canCreate = await hasPermission(tenant.tenant_id, PERMISSIONS.OPPORTUNITIES_CREATE);

  const supabase = await createClient();
  const { data: opportunities, error } = await supabase
    .from("opportunities")
    .select("id, title, status, estimated_value_cents, inspection_scheduled_at, clients(display_name)")
    .eq("tenant_id", tenant.tenant_id)
    .neq("status", "archived")
    .order("created_at", { ascending: false });

  const byStatus = new Map<OpportunityStatus, typeof opportunities>();
  for (const status of PIPELINE_COLUMNS) byStatus.set(status, []);
  for (const o of opportunities ?? []) {
    const list = byStatus.get(o.status as OpportunityStatus);
    if (list) list.push(o);
  }

  return (
    <div className="stack">
      <PageHeader
        icon={Kanban}
        title="Pipeline"
        secondary={
          <Link href="/opportunities" className="button-secondary">
            List view
          </Link>
        }
        action={
          canCreate ? (
            <Link href="/opportunities/new" className="button-primary">
              + New opportunity
            </Link>
          ) : null
        }
      />

      {error ? <p className="error-banner">{error.message}</p> : null}

      <div className="kanban-board">
        {PIPELINE_COLUMNS.map((status) => {
          const items = byStatus.get(status) ?? [];
          return (
            <div key={status} className="kanban-column">
              <div className="kanban-column-header">
                <span>{opportunityStatusLabel(status)}</span>
                <span className="badge">{items.length}</span>
              </div>

              {items.length === 0 ? (
                <p className="hint">Nothing here.</p>
              ) : (
                items.map((o) => (
                  <div key={o.id} className="kanban-card">
                    <Link href={`/opportunities/${o.id}`}>
                      <strong>{o.title}</strong>
                    </Link>
                    <span className="hint">{o.clients?.display_name ?? "—"}</span>
                    <span className="hint">{formatMoney(o.estimated_value_cents)}</span>
                    {o.inspection_scheduled_at ? (
                      <span className="hint">Inspection: {new Date(o.inspection_scheduled_at).toLocaleDateString()}</span>
                    ) : null}
                    {canChangeStatus ? (
                      <QuickAdvance opportunityId={o.id} options={SIMPLE_TRANSITIONS[status] ?? []} />
                    ) : null}
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
