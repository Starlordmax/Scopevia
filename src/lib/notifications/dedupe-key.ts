/**
 * Pure dedupe-key construction for proposal_notification_deliveries — no
 * server-only dependency, so directly unit-testable. This string IS the
 * entire duplicate-email guard (the table's `unique (dedupe_key)`
 * constraint): the same (event, version, recipient) triple always
 * produces the same key, so a second attempt — a page refresh, a retried
 * Server Action, a genuine race between two near-simultaneous requests —
 * collides with the first insert and is skipped rather than sending a
 * second email. See docs/63-notification-delivery-security.md.
 */
export function buildDedupeKey(eventType: string, proposalVersionId: string, recipientEmail: string): string {
  return `${eventType}:${proposalVersionId}:${recipientEmail.trim().toLowerCase()}`;
}

const MAX_ERROR_CODE_LENGTH = 200;

/**
 * Turns a caught error into a short, storage-safe string for
 * proposal_notification_deliveries.error_code. The inputs this ever
 * actually receives are ALREADY controlled, sanitized messages (see
 * src/lib/email/send.ts and the resend-config/provider-selection modules —
 * none of them ever throw a raw provider response body, an API key, or a
 * stack trace), so this is defense in depth: capping length and stripping
 * newlines guarantees a single-line, bounded value regardless of what a
 * caller passes, without needing to trust every current and future error
 * source to already be well-behaved.
 */
export function sanitizeErrorForStorage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const singleLine = message.replace(/\s+/g, " ").trim();
  return singleLine.length > MAX_ERROR_CODE_LENGTH ? `${singleLine.slice(0, MAX_ERROR_CODE_LENGTH - 1)}…` : singleLine;
}
