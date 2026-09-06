import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "../../../../lib/supabase/server";
import { uuidSchema } from "../../../../lib/validation/schemas";
import { validateLogoFile, buildLogoStoragePath, MAX_LOGO_SIZE_BYTES } from "../../../../lib/branding/logo-validation";
import { uploadBusinessLogoFile, deleteBusinessLogoFile } from "../../../../lib/storage/branding";
import { getBusinessLogoStoragePath } from "../../../../lib/branding/data";
import { friendlyRpcErrorMessage } from "../../../../lib/errors/friendly-message";

const GENERIC_UPLOAD_ERROR = "We couldn't upload the logo right now. Please try again.";
const PERMISSION_ERROR = "You don't have permission to update business branding.";

// Generous margin over MAX_LOGO_SIZE_BYTES for multipart/form-data's own
// boundary/header overhead (a few KB at most for a single-file form) — not
// a second real limit, just enough slack that a file exactly at the real
// limit is never rejected by this cheap pre-check before validateLogoFile()
// itself gets to give the precise, friendly "under 10 MB" message.
const MAX_REQUEST_BYTES = MAX_LOGO_SIZE_BYTES + 1024 * 1024;

/**
 * Business logo upload — a dedicated Route Handler, not a Server Action.
 *
 * Server Actions have a hard, framework-enforced body size limit
 * (`experimental.serverActions.bodySizeLimit` in next.config.ts). Any
 * request over that limit is rejected by Next.js's OWN request parser
 * BEFORE a Server Action's function body ever runs — as an uncaught
 * exception that surfaces as the generic "This page couldn't load" error
 * boundary, with no way for application code to intercept it and show a
 * friendly message instead. Raising that limit only moves the crash
 * threshold higher; it can never eliminate it while also allowing a clean,
 * friendly rejection for anything above the app's own real 10 MB limit —
 * see docs/71-logo-upload-crash-fix.md, "Update" section.
 *
 * A Route Handler has no such built-in ceiling: this code reads and
 * validates the request itself, so ANY size — too small, exactly at the
 * limit, or wildly over it — always gets a clean, typed JSON response.
 * The manual Content-Length pre-check below exists only so a grossly
 * oversized request (someone deliberately posting hundreds of MB) is
 * rejected cheaply, before buffering the whole body into memory.
 */
export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json(
      { error: "Please upload a PNG, JPG, or WEBP image under 10 MB.", fieldErrors: { file: "Please upload a PNG, JPG, or WEBP image under 10 MB." } },
      { status: 413 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "You must be signed in to do that." }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: GENERIC_UPLOAD_ERROR }, { status: 400 });
  }

  const tenantId = uuidSchema.safeParse(formData.get("tenantId"));
  if (!tenantId.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: "Choose a logo file to upload", fieldErrors: { file: "Choose a logo file to upload." } },
      { status: 400 }
    );
  }

  const validation = validateLogoFile({ type: file.type, size: file.size });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error, fieldErrors: { file: validation.error } }, { status: 400 });
  }

  try {
    const previousPath = await getBusinessLogoStoragePath(tenantId.data);

    const path = buildLogoStoragePath(tenantId.data, file.type, crypto.randomUUID());
    const uploadResult = await uploadBusinessLogoFile(path, file);
    if ("error" in uploadResult) {
      return NextResponse.json({ error: uploadResult.error }, { status: 502 });
    }

    const { error } = await supabase.rpc("update_tenant_branding", {
      p_tenant_id: tenantId.data,
      p_logo_storage_path: path,
      p_logo_original_filename: file.name.slice(0, 200),
      p_logo_content_type: file.type,
      p_logo_size_bytes: file.size,
    });

    if (error) {
      await deleteBusinessLogoFile(path);
      if (error.code === "42501") {
        return NextResponse.json({ error: PERMISSION_ERROR }, { status: 403 });
      }
      return NextResponse.json({ error: friendlyRpcErrorMessage(error.message) }, { status: 400 });
    }

    if (previousPath && previousPath !== path) {
      await deleteBusinessLogoFile(previousPath);
    }

    revalidatePath("/profile");
    return NextResponse.json({ message: "Logo uploaded successfully." });
  } catch (error) {
    console.error("Business logo upload failed:", error);
    return NextResponse.json({ error: GENERIC_UPLOAD_ERROR }, { status: 500 });
  }
}
