"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "../lib/supabase/server";
import { requireUser } from "../lib/auth/session";
import { zodIssuesToFieldErrors } from "../lib/validation/field-errors";
import type { ActionResult } from "./auth";

const updateProfileSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required.").max(120),
  locale: z.string().trim().min(2, "Enter a valid locale (e.g. en-US).").max(20),
  timezone: z.string().trim().min(2, "Enter a valid timezone.").max(64),
});

export async function updateProfileAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = updateProfileSchema.safeParse({
    fullName: formData.get("fullName"),
    locale: formData.get("locale"),
    timezone: formData.get("timezone"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors: zodIssuesToFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  // RLS (profiles_update_self) already guarantees this can only ever affect
  // the caller's own row; the .eq() below is belt-and-suspenders clarity,
  // not the security boundary.
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      locale: parsed.data.locale,
      timezone: parsed.data.timezone,
    })
    .eq("id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/profile");
  return {};
}
