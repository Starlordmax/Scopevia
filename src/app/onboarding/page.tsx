import { redirect } from "next/navigation";
import { requireUser } from "../../lib/auth/session";
import { getUserTenants } from "../../lib/auth/tenant";
import { CreateTenantForm } from "./create-tenant-form";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  await requireUser();

  // If the user already has at least one active tenant, onboarding is not
  // the right place for them — send them to the selector/shell instead.
  const tenants = await getUserTenants();
  if (tenants.length > 0) {
    redirect("/select-tenant");
  }

  return (
    <div className="center-page">
      <div className="card stack">
        <div>
          <h1>Set up your business</h1>
          <p className="hint">This creates your Scopevia workspace. You&apos;ll be its owner.</p>
        </div>
        <CreateTenantForm />
      </div>
    </div>
  );
}
