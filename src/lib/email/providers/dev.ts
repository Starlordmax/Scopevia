import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { PortalCodeEmailInput } from "../types";

// Gitignored — see .gitignore, ".portal-otp-dev/". Local dev/test
// convenience only. One file PER EMAIL (not one shared JSON blob) so that
// Playwright's parallel workers requesting codes for different emails at
// the same time can never race each other with a read-modify-write on a
// single file.
const DEV_CAPTURE_DIR = path.join(process.cwd(), ".portal-otp-dev");

function captureFilePath(email: string): string {
  const digest = createHash("sha256").update(email.toLowerCase()).digest("hex");
  return path.join(DEV_CAPTURE_DIR, `${digest}.json`);
}

/**
 * The `dev`/test provider: never sends a real email. Logs the code
 * server-side only (never returned to the browser, never in the database
 * in plaintext) and writes it to a local, gitignored capture file so
 * Playwright/RLS tests can retrieve it deterministically — see
 * tests/e2e/fixtures/portal.ts. Gated at the caller (see
 * src/lib/email/provider-selection.ts) so this can never run in a real
 * production deployment without an explicit, dangerous override.
 */
export async function sendViaDevCapture(input: PortalCodeEmailInput): Promise<void> {
  console.log(
    `[dev-email] Client portal access code for ${input.email}: ${input.code} (proposal "${input.proposalTitle}", ${input.businessName})`
  );

  try {
    await mkdir(DEV_CAPTURE_DIR, { recursive: true });
    await writeFile(captureFilePath(input.email), JSON.stringify({ code: input.code, sentAt: new Date().toISOString() }, null, 2));
  } catch (err) {
    // A local dev convenience must never block the actual OTP request.
    console.error("[dev-email] failed to write local capture file", err);
  }
}
