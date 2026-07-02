import { requireUser } from "../../lib/auth/session";
import { requireActiveTenant } from "../../lib/auth/tenant";
import { getActiveRolePermissions } from "../../lib/auth/role-permissions";

export default async function HomePage() {
  const user = await requireUser();
  const { tenant, tenants } = await requireActiveTenant();
  const permissions = await getActiveRolePermissions(tenant.role_key);

  return (
    <div className="stack">
      <div>
        <h1>Scopevia Foundation</h1>
        <p className="hint">
          Temporary Phase 0 verification panel — confirms auth, multi-tenancy, roles and permissions are wired
          correctly end to end. Not the product UI.
        </p>
      </div>

      <div className="card stack">
        <div>
          <span className="hint">Current user</span>
          <p>
            {user.email} <span className="badge">{user.id.slice(0, 8)}…</span>
          </p>
        </div>

        <div>
          <span className="hint">Active tenant</span>
          <p>
            {tenant.tenant_name} <span className="badge">{tenant.tenant_slug}</span>
          </p>
        </div>

        <div>
          <span className="hint">Current role</span>
          <p>{tenant.role_name}</p>
        </div>

        <div>
          <span className="hint">Membership count</span>
          <p>You belong to {tenants.length} tenant{tenants.length === 1 ? "" : "s"}.</p>
        </div>

        <div>
          <span className="hint">Available permissions for this role</span>
          <ul>
            {permissions.length === 0 ? (
              <li className="hint">None</li>
            ) : (
              permissions.map((p) => <li key={p}>{p}</li>)
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
