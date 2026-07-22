import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

// Mirrors src/lib/email/portal.ts's DEV_CAPTURE_DIR/captureFilePath exactly —
// one gitignored file per email (sha256 of the lowercased address), so
// Playwright's parallel workers requesting codes for different emails can
// never race each other on a shared file.
const DEV_CAPTURE_DIR = path.join(__dirname, "..", "..", "..", ".portal-otp-dev");

function captureFilePath(email: string): string {
  const digest = createHash("sha256").update(email.toLowerCase()).digest("hex");
  return path.join(DEV_CAPTURE_DIR, `${digest}.json`);
}

/**
 * Reads the dev-mode-captured one-time code for `email` (see
 * sendPortalCodeEmail(), src/lib/email/portal.ts) — the "server-side test
 * helper" the Phase 3A brief calls for, standing in for a real inbox. Polls
 * briefly since there's a small delay between the Server Action requesting
 * the code and this file appearing on disk.
 */
export async function getCapturedPortalOtpCode(email: string): Promise<string> {
  const filePath = captureFilePath(email);
  const deadline = Date.now() + 10_000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const raw = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as { code: string; sentAt: string };
      return parsed.code;
    } catch (err) {
      lastErr = err;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`No captured portal OTP code found for ${email} after waiting: ${String(lastErr)}`);
}

/**
 * True if no code was ever captured for `email` — a single, immediate
 * check (no polling), for asserting the NEGATIVE case (an unauthorized
 * email must never get a real code) without waiting out
 * getCapturedPortalOtpCode()'s full retry budget.
 */
export async function hasNoCapturedPortalOtpCode(email: string): Promise<boolean> {
  try {
    await readFile(captureFilePath(email), "utf-8");
    return false;
  } catch {
    return true;
  }
}
