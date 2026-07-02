import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "../../lib/auth/session";
import { getUserTenants } from "../../lib/auth/tenant";
import { getPendingInvitations } from "../../lib/auth/invitations";
import { switchTenantAction } from "../../actions/tenant";
import { AcceptInvitationForm } from "./accept-invitation-form";

export const dynamic = "force-dynamic";

export default async function SelectTenantPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireUser();
  const { error } = await searchParams;
  const [tenants, invitations] = await Promise.all([getUserTenants(), getPendingInvitations()]);

  // The only place that decides "you have nothing yet, go create a
  // business" — requireActiveTenant() always lands here first so this
  // decision isn't duplicated (see src/lib/auth/tenant.ts).
  if (tenants.length === 0 && invitations.length === 0) {
    redirect("/onboarding");
  }

  return (
    <div className="center-page">
      <div className="card stack">
        <div>
          <h1>Choose a business</h1>
          <p className="hint">Pick a workspace to continue, or accept a pending invitation below.</p>
        </div>

        {error ? <p className="error-banner">That workspace is not available. Choose another.</p> : null}

        {invitations.length > 0 ? (
          <div className="stack" style={{ gap: 8 }}>
            <strong style={{ fontSize: "0.9rem" }}>Pending invitations</strong>
            {invitations.map((inv) => (
              <div
                key={inv.membership_id}
                className="stack"
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}
              >
                <span>
                  {inv.tenant_name} <span className="hint">as {inv.role_name}</span>
                </span>
                <AcceptInvitationForm membershipId={inv.membership_id} />
              </div>
            ))}
          </div>
        ) : null}

        {tenants.length > 0 ? (
          <div className="stack" style={{ gap: 8 }}>
            {invitations.length > 0 ? <strong style={{ fontSize: "0.9rem" }}>Your businesses</strong> : null}
            {tenants.map((t) => (
              <form key={t.tenant_id} action={switchTenantAction}>
                <input type="hidden" name="tenantId" value={t.tenant_id} />
                <button type="submit" className="button-secondary" style={{ width: "100%", textAlign: "left" }}>
                  <strong>{t.tenant_name}</strong>
                  <br />
                  <span className="hint">{t.role_name}</span>
                </button>
              </form>
            ))}
          </div>
        ) : null}

        <Link href="/onboarding" className="hint">
          + Create another business
        </Link>
      </div>
    </div>
  );
}
