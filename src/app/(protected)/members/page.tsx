import { requireUser } from "../../../lib/auth/session";
import { requireActiveTenant } from "../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../lib/auth/permissions";
import { createClient } from "../../../lib/supabase/server";
import { InviteMemberForm } from "./invite-form";
import { MemberRow } from "./member-row";

type MembershipRow = {
  id: string;
  user_id: string;
  status: "invited" | "active" | "suspended" | "removed";
  created_at: string;
  roles: { key: string; name: string } | null;
};

export default async function MembersPage() {
  const user = await requireUser();
  const { tenant } = await requireActiveTenant();

  const canView = await hasPermission(tenant.tenant_id, PERMISSIONS.MEMBERS_VIEW);
  if (!canView) {
    return (
      <div className="stack">
        <h1>Members</h1>
        <p className="hint">Your current role ({tenant.role_name}) does not include access to this page.</p>
      </div>
    );
  }

  const [canInvite, canUpdate, canRemove] = await Promise.all([
    hasPermission(tenant.tenant_id, PERMISSIONS.MEMBERS_INVITE),
    hasPermission(tenant.tenant_id, PERMISSIONS.MEMBERS_UPDATE),
    hasPermission(tenant.tenant_id, PERMISSIONS.MEMBERS_REMOVE),
  ]);

  const supabase = await createClient();
  const { data: memberships, error } = await supabase
    .from("tenant_memberships")
    .select("id, user_id, status, created_at, roles(key, name)")
    .eq("tenant_id", tenant.tenant_id)
    .order("created_at", { ascending: true });

  const rows = (memberships ?? []) as unknown as MembershipRow[];
  const userIds = rows.map((m) => m.user_id);

  const { data: profiles } =
    userIds.length > 0
      ? await supabase.from("profiles").select("id, full_name").in("id", userIds)
      : { data: [] as { id: string; full_name: string | null }[] };

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return (
    <div className="stack">
      <h1>Members</h1>
      {error ? <p className="error-banner">{error.message}</p> : null}

      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              {canUpdate || canRemove ? <th>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td data-label="Name">
                  {profileById.get(m.user_id) || "Unnamed member"}
                  {m.user_id === user.id ? <span className="hint"> (you)</span> : null}
                </td>
                <td data-label="Role">{m.roles?.name ?? "—"}</td>
                <td data-label="Status">{m.status}</td>
                {canUpdate || canRemove ? (
                  <td data-label="Actions">
                    <MemberRow
                      tenantId={tenant.tenant_id}
                      membershipId={m.id}
                      currentRoleKey={m.roles?.key ?? ""}
                      currentStatus={m.status}
                      isSelf={m.user_id === user.id}
                      isOwnerRow={m.roles?.key === "owner"}
                      canUpdate={canUpdate}
                      canRemove={canRemove}
                    />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canInvite ? (
        <div className="card stack">
          <h2 style={{ fontSize: "1rem" }}>Invite a member</h2>
          <p className="hint">
            Phase 0 can only add someone who already has a Scopevia account — ask them to sign up first. They
            won&apos;t have access until they sign in and accept the invitation themselves.
          </p>
          <InviteMemberForm tenantId={tenant.tenant_id} />
        </div>
      ) : null}
    </div>
  );
}
