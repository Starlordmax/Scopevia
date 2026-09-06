import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

// Mirrors src/lib/email/providers/dev-generic.ts's DEV_CAPTURE_DIR/captureFilePath
// exactly — one gitignored file per recipient email (sha256 of the
// lowercased address), containing an APPENDED array of every notification
// sent to that address (unlike the OTP capture, a recipient can legitimately
// receive several different notifications for the same proposal over time).
const DEV_CAPTURE_DIR = path.join(__dirname, "..", "..", "..", ".notification-emails-dev");

type CapturedEmail = { subject: string; text: string; html: string; sentAt: string };

function captureFilePath(email: string): string {
  const digest = createHash("sha256").update(email.toLowerCase()).digest("hex");
  return path.join(DEV_CAPTURE_DIR, `${digest}.json`);
}

async function readCaptured(email: string): Promise<CapturedEmail[]> {
  try {
    return JSON.parse(await readFile(captureFilePath(email), "utf-8")) as CapturedEmail[];
  } catch {
    return [];
  }
}

/**
 * Polls for at least one captured notification to `email` whose subject
 * contains `subjectContains`, returning the first match. Standing in for
 * "check the team's inbox" in E2E tests — see
 * docs/62-proposal-email-notifications.md.
 */
export async function getCapturedNotification(email: string, subjectContains: string): Promise<CapturedEmail> {
  const deadline = Date.now() + 10_000;
  let lastSeen: CapturedEmail[] = [];
  while (Date.now() < deadline) {
    lastSeen = await readCaptured(email);
    const match = lastSeen.find((n) => n.subject.includes(subjectContains));
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No captured notification containing "${subjectContains}" found for ${email} after waiting. Captured: ${JSON.stringify(lastSeen)}`);
}

/** All notifications captured for `email` so far — for asserting a count (e.g. "exactly one, not spammed by a duplicate view"). */
export async function getAllCapturedNotifications(email: string): Promise<CapturedEmail[]> {
  return readCaptured(email);
}
