"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "../lib/supabase/server";
import { signUpSchema, signInSchema, forgotPasswordSchema, resetPasswordSchema } from "../lib/validation/schemas";
import { logAuditEvent } from "../lib/audit/log";
import { resolveSiteOrigin } from "../lib/auth/site-origin";

/**
 * `fieldErrors` is optional and additive to `error` — a form that wants
 * inline, per-field red states (see docs/74-custom-service-name-and-multistroke-drawing.md,
 * "Validation UX") reads it directly; every existing consumer that only
 * reads `error` keeps working unchanged.
 */
export type ActionResult = { error?: string; message?: string; fieldErrors?: Record<string, string> };

/**
 * `NEXT_PUBLIC_SITE_URL` wins whenever it's set (Render/staging/production),
 * `APP_BASE_URL` (Phase 3D's notification-link env var — already required
 * on any real deployment, see docs/64) is a secondary fallback, then the
 * request's `Origin` header, then localhost — see src/lib/auth/site-origin.ts
 * for why the env vars must come before the header. This is the SAME
 * canonical-URL resolution /auth/callback/route.ts uses for the final
 * post-confirmation redirect — see docs/68-auth-callback-localhost-redirect-fix.md.
 */
async function siteOrigin(): Promise<string> {
  const originHeader = (await headers()).get("origin");
  return resolveSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_BASE_URL, originHeader);
}

export async function signUpAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const origin = await siteOrigin();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: parsed.data.fullName ? { full_name: parsed.data.fullName } : undefined,
      // After confirming, land the user on /sign-in (not straight into the
      // app) — a deliberate product choice, not a bug: see
      // docs/68-auth-callback-localhost-redirect-fix.md.
      emailRedirectTo: `${origin}/auth/callback?next=/sign-in`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  redirect("/sign-up/check-email");
}

export async function signInAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Deliberately generic — do not reveal whether the email exists.
    return { error: "Invalid email or password" };
  }

  if (data.user) {
    await logAuditEvent({
      tenantId: null,
      actorUserId: data.user.id,
      action: "auth.signed_in",
      entityType: "user",
      entityId: data.user.id,
    });
  }

  redirect("/");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await logAuditEvent({
      tenantId: null,
      actorUserId: user.id,
      action: "auth.signed_out",
      entityType: "user",
      entityId: user.id,
    });
  }

  await supabase.auth.signOut();
  redirect("/sign-in");
}

export async function forgotPasswordAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const origin = await siteOrigin();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  // Always redirect to the same "check your email" page regardless of
  // whether the address exists, to avoid account enumeration.
  redirect("/forgot-password/check-email");
}

export async function resetPasswordAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: error.message };
  }

  redirect("/");
}
