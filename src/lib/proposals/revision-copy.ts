/**
 * Pure copy-generation for the Phase 3B.1 revision flow — kept separate
 * from the page components so the actual wording is unit-testable without
 * rendering React (this codebase has no component-test infrastructure; see
 * tests/unit/status-badge.test.ts and friendly-message.test.ts for the same
 * "extract the string logic, test it directly" pattern).
 */

export function declinedRevisionCardMessage(declineReason: string | null): string {
  return declineReason
    ? `This proposal was declined. Reason: ${declineReason}. Create a revised version to make changes and send it again.`
    : "This proposal was declined. Create a revised version to make changes and send it again.";
}

export function acceptedRevisionCardMessage(): string {
  return "This proposal has already been accepted. To make changes, create a new revision.";
}

export function acceptedRevisionConfirmMessage(): string {
  return "This proposal was already accepted by the client. Creating a new revision starts a fresh draft and does not undo or delete the client's acceptance — it stays in the version history. Continue?";
}

/** The link text ("Create a new revision") is rendered separately by the caller so it can be a real <Link>. */
export function lockedVersionMessage(): string {
  return "This version is locked because the client already responded.";
}

export function revisionInProgressSuffix(isRevisionInProgress: boolean): string {
  return isRevisionInProgress ? " — Revision in progress" : "";
}

export function versionHistoryLabel(versionNumber: number, isCurrent: boolean): string {
  return isCurrent ? `Version ${versionNumber} (current)` : `Version ${versionNumber}`;
}
