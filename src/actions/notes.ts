"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../lib/supabase/server";
import { requireUser } from "../lib/auth/session";
import { uuidSchema } from "../lib/validation/schemas";
import { createNoteSchema, updateNoteSchema } from "../lib/validation/crm";
import type { ActionResult } from "./auth";

function parentPath(clientId?: string, opportunityId?: string, projectId?: string): string {
  if (clientId) return `/clients/${clientId}`;
  if (opportunityId) return `/opportunities/${opportunityId}`;
  if (projectId) return `/projects/${projectId}`;
  return "/";
}

export async function createNoteAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const tenantId = uuidSchema.safeParse(formData.get("tenantId"));
  if (!tenantId.success) return { error: "Invalid request" };

  const parsed = createNoteSchema.safeParse({
    body: formData.get("body"),
    clientId: formData.get("clientId") || undefined,
    opportunityId: formData.get("opportunityId") || undefined,
    projectId: formData.get("projectId") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_note", {
    p_tenant_id: tenantId.data,
    p_body: parsed.data.body,
    p_client_id: parsed.data.clientId,
    p_opportunity_id: parsed.data.opportunityId,
    p_project_id: parsed.data.projectId,
  });

  if (error) return { error: error.message };

  revalidatePath(parentPath(parsed.data.clientId, parsed.data.opportunityId, parsed.data.projectId));
  return {};
}

export async function updateNoteAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const noteId = uuidSchema.safeParse(formData.get("noteId"));
  if (!noteId.success) return { error: "Invalid request" };

  const redirectPath = parentPath(
    (formData.get("clientId") as string) || undefined,
    (formData.get("opportunityId") as string) || undefined,
    (formData.get("projectId") as string) || undefined
  );

  const parsed = updateNoteSchema.safeParse({ body: formData.get("body") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_note", { p_note_id: noteId.data, p_body: parsed.data.body });

  if (error) return { error: error.message };

  revalidatePath(redirectPath);
  return {};
}

export async function archiveNoteAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const noteId = uuidSchema.safeParse(formData.get("noteId"));
  if (!noteId.success) return { error: "Invalid request" };

  const redirectPath = parentPath(
    (formData.get("clientId") as string) || undefined,
    (formData.get("opportunityId") as string) || undefined,
    (formData.get("projectId") as string) || undefined
  );

  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_note", { p_note_id: noteId.data });

  if (error) return { error: error.message };

  revalidatePath(redirectPath);
  return {};
}
