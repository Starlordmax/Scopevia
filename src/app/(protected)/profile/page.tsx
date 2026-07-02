import { requireUser } from "../../../lib/auth/session";
import { createClient } from "../../../lib/supabase/server";
import { ProfileForm } from "./profile-form";

export default async function ProfilePage() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, locale, timezone")
    .eq("id", user.id)
    .single();

  return (
    <div className="stack">
      <h1>Profile</h1>
      <div className="card">
        <ProfileForm
          email={user.email ?? ""}
          fullName={profile?.full_name ?? ""}
          locale={profile?.locale ?? "en-US"}
          timezone={profile?.timezone ?? "UTC"}
        />
      </div>
    </div>
  );
}
