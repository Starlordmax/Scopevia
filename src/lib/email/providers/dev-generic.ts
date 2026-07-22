import "server-only";

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { GenericEmailInput } from "../types";

// Gitignored — see .gitignore, ".notification-emails-dev/". A SEPARATE
// directory from the OTP capture path (.portal-otp-dev/, providers/dev.ts)
// — deliberately not reused, so Phase 3D's new notification-email capture
// can never collide with or interfere with the already-battle-tested OTP
// capture mechanism every existing E2E/RLS test depends on. One file PER
// RECIPIENT (hashed email), containing an APPENDED array of every
// notification sent to that address — unlike the OTP capture (always
// exactly one live code per email), a contractor can legitimately receive
// several different notifications (viewed, then later accepted/declined)
// for the same email address, and tests need to find a specific one by
// subject — see tests/e2e/fixtures/notifications.ts.
const DEV_CAPTURE_DIR = path.join(process.cwd(), ".notification-emails-dev");

function captureFilePath(to: string): string {
  const digest = createHash("sha256").update(to.toLowerCase()).digest("hex");
  return path.join(DEV_CAPTURE_DIR, `${digest}.json`);
}

type CapturedEmail = { subject: string; text: string; html: string; sentAt: string };

/**
 * The `dev`/test provider for generic notification emails (Phase 3D).
 * Never sends a real email — logs server-side only and appends to a local,
 * gitignored capture file so Playwright/RLS tests can retrieve it
 * deterministically. Gated at the caller (src/lib/email/send.ts, reusing
 * resolveEmailProvider() unchanged) so this can never run in a real
 * production deployment without the same explicit, dangerous override the
 * OTP path already requires.
 */
export async function sendViaDevCaptureGeneric(input: GenericEmailInput): Promise<void> {
  console.log(`[dev-email] Notification for ${input.to}: ${input.subject}`);

  try {
    await mkdir(DEV_CAPTURE_DIR, { recursive: true });
    const filePath = captureFilePath(input.to);
    let existing: CapturedEmail[] = [];
    try {
      existing = JSON.parse(await readFile(filePath, "utf-8"));
    } catch {
      existing = [];
    }
    existing.push({ subject: input.subject, text: input.text, html: input.html, sentAt: new Date().toISOString() });
    await writeFile(filePath, JSON.stringify(existing, null, 2));
  } catch (err) {
    // A local dev convenience must never block the actual notification flow.
    console.error("[dev-email] failed to write local notification capture file", err);
  }
}
