import { CircleUserRound } from "lucide-react";
import { requireUser } from "../../../lib/auth/session";
import { createClient } from "../../../lib/supabase/server";
import { resolveActiveTenant } from "../../../lib/auth/tenant";
import { hasPermission, PERMISSIONS } from "../../../lib/auth/permissions";
import { getBusinessBranding } from "../../../lib/branding/data";
import { getBusinessProfile } from "../../../lib/business/data";
import { PageHeader } from "../../../components/page-header";
import { ProfileForm } from "./profile-form";
import { BusinessBrandingCard } from "./business-branding-card";
import { BusinessProfileCard } from "./business-profile-card";

export default async function ProfilePage() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, locale, timezone")
    .eq("id", user.id)
    .single();

  // Branding is tenant-scoped, not personal — if this user has no active
  // tenant yet (mid-onboarding), the card is simply omitted rather than
  // forcing tenant selection from the Profile page.
  const { tenant } = await resolveActiveTenant();
  const branding = tenant ? await getBusinessBranding(tenant.tenant_id) : null;
  const businessProfile = tenant ? await getBusinessProfile(tenant.tenant_id) : null;
  // Same permission gates both cards -- business profile and branding are
  // both "more tenant settings," not distinct capabilities (see
  // docs/78-business-profile-ai-context.md).
  const canUpdateTenantSettings = tenant ? await hasPermission(tenant.tenant_id, PERMISSIONS.TENANT_UPDATE) : false;

  return (
    <div className="stack">
      <PageHeader icon={CircleUserRound} title="Profile" />
      <div className="form-card">
        <ProfileForm
          email={user.email ?? ""}
          fullName={profile?.full_name ?? ""}
          locale={profile?.locale ?? "en-US"}
          timezone={profile?.timezone ?? "UTC"}
        />
      </div>
      {tenant ? (
        <BusinessBrandingCard
          tenantId={tenant.tenant_id}
          canUpdate={canUpdateTenantSettings}
          logoUrl={branding?.logoUrl ?? null}
          businessName={tenant.tenant_name}
        />
      ) : null}
      {tenant && businessProfile ? (
        <BusinessProfileCard tenantId={tenant.tenant_id} canUpdate={canUpdateTenantSettings} profile={businessProfile} />
      ) : null}
    </div>
  );
}
