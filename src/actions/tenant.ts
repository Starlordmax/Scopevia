"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "../lib/supabase/server";
import { requireUser } from "../lib/auth/session";
import { ACTIVE_TENANT_COOKIE, activeTenantCookieOptions, getUserTenants } from "../lib/auth/tenant";
import { requirePermission } from "../lib/auth/permissions";
import {
  createTenantSchema,
  uuidSchema,
  roleKeySchema,
  membershipStatusSchema,
  emailSchema,
} from "../lib/validation/schemas";
import type { ActionResult } from "./auth";
import type { Database } from "../../types/database";

export async function createTenantAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const parsed = createTenantSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("create_tenant_with_owner", { p_name: parsed.data.name, p_slug: parsed.data.slug })
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: "That business URL is already taken. Try another." };
    }
    return { error: error.message };
  }

  const tenant = data as Database["public"]["Tables"]["tenants"]["Row"];
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TENANT_COOKIE, tenant.id, activeTenantCookieOptions());

  redirect("/");
}

export async function switchTenantAction(formData: FormData): Promise<void> {
  await requireUser();

  const parsed = uuidSchema.safeParse(formData.get("tenantId"));
  if (!parsed.success) {
    redirect("/select-tenant?error=invalid_tenant");
  }

  // Re-validate against the authoritative list — never trust the posted id
  // on its own, even though it came from our own <form>.
  const tenants = await getUserTenants();
  const match = tenants.find((t) => t.tenant_id === parsed.data);
  if (!match) {
    redirect("/select-tenant?error=not_a_member");
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TENANT_COOKIE, parsed.data, activeTenantCookieOptions());
  redirect("/");
}

export async function updateMembershipAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const membershipId = uuidSchema.safeParse(formData.get("membershipId"));
  const tenantId = uuidSchema.safeParse(formData.get("tenantId"));
  if (!membershipId.success || !tenantId.success) {
    return { error: "Invalid request" };
  }

  const roleKeyRaw = formData.get("roleKey");
  const statusRaw = formData.get("status");
  const roleKey = roleKeyRaw ? roleKeySchema.safeParse(roleKeyRaw) : undefined;
  const status = statusRaw ? membershipStatusSchema.safeParse(statusRaw) : undefined;
  if (roleKeyRaw && !roleKey?.success) return { error: "Invalid role" };
  if (statusRaw && !status?.success) return { error: "Invalid status" };

  try {
    // Defense in depth: pre-check in the app layer even though
    // update_membership() re-validates independently in the database and
    // cannot be bypassed by calling the RPC directly.
    await requirePermission(tenantId.data, status?.data === "removed" ? "members.remove" : "members.update");
  } catch {
    return { error: "You do not have permission to do that" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_membership", {
    p_membership_id: membershipId.data,
    p_new_status: status?.data ?? null,
    p_new_role_key: roleKey?.data ?? null,
  });
  if (error) {
    return { error: error.message };
  }

  revalidatePath("/members");
  return {};
}

export async function acceptInvitationAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const membershipId = uuidSchema.safeParse(formData.get("membershipId"));
  if (!membershipId.success) {
    return { error: "Invalid request" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("accept_invitation", { p_membership_id: membershipId.data })
    .single();
  if (error) {
    return { error: error.message };
  }

  const membership = data as Database["public"]["Tables"]["tenant_memberships"]["Row"];
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TENANT_COOKIE, membership.tenant_id, activeTenantCookieOptions());

  redirect("/");
}

export async function inviteMemberAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const tenantId = uuidSchema.safeParse(formData.get("tenantId"));
  const email = emailSchema.safeParse(formData.get("email"));
  const roleKey = roleKeySchema.safeParse(formData.get("roleKey"));
  if (!tenantId.success || !email.success || !roleKey.success) {
    return { error: "Invalid input" };
  }

  try {
    await requirePermission(tenantId.data, "members.invite");
  } catch {
    return { error: "You do not have permission to do that" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("invite_member_by_email", {
    p_tenant_id: tenantId.data,
    p_email: email.data,
    p_role_key: roleKey.data,
  });
  if (error) {
    return { error: error.message };
  }

  revalidatePath("/members");
  return {};
}
