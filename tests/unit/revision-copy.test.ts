import { describe, expect, it } from "vitest";
import {
  declinedRevisionCardMessage,
  acceptedRevisionCardMessage,
  acceptedRevisionConfirmMessage,
  lockedVersionMessage,
  revisionInProgressSuffix,
  versionHistoryLabel,
} from "../../src/lib/proposals/revision-copy";

describe("declinedRevisionCardMessage (Phase 3B.1)", () => {
  it("includes the decline reason when present", () => {
    const message = declinedRevisionCardMessage("Too expensive");
    expect(message).toContain("Too expensive");
    expect(message).toContain("Create a revised version");
  });

  it("omits the reason clause entirely when there is none", () => {
    const message = declinedRevisionCardMessage(null);
    expect(message).not.toContain("Reason:");
    expect(message).toContain("This proposal was declined.");
    expect(message).toContain("Create a revised version");
  });
});

describe("acceptedRevisionCardMessage / acceptedRevisionConfirmMessage (Phase 3B.1)", () => {
  it("the card message never implies the acceptance itself is undone", () => {
    const message = acceptedRevisionCardMessage();
    expect(message).toContain("already been accepted");
    expect(message).not.toMatch(/undo|cancel|delete/i);
  });

  it("the confirmation dialog explicitly warns that acceptance is preserved, not erased", () => {
    const message = acceptedRevisionConfirmMessage();
    expect(message).toMatch(/does not undo or delete/i);
    expect(message).toMatch(/version history/i);
  });
});

describe("lockedVersionMessage (Phase 3B.1 builder guard)", () => {
  it("explains why editing is blocked", () => {
    expect(lockedVersionMessage()).toMatch(/locked/i);
    expect(lockedVersionMessage()).toMatch(/client already responded/i);
  });
});

describe("revisionInProgressSuffix (Phase 3B.1)", () => {
  it("is empty when not a revision in progress", () => {
    expect(revisionInProgressSuffix(false)).toBe("");
  });

  it("flags a revision in progress without inventing a new status word", () => {
    expect(revisionInProgressSuffix(true)).toBe(" — Revision in progress");
  });
});

describe("versionHistoryLabel (Phase 3B.1 version history formatting)", () => {
  it("marks the current version distinctly", () => {
    expect(versionHistoryLabel(2, true)).toBe("Version 2 (current)");
  });

  it("does not mark a historical version as current", () => {
    expect(versionHistoryLabel(1, false)).toBe("Version 1");
  });

  it("never renders a raw UUID or version_status literal", () => {
    const label = versionHistoryLabel(3, false);
    expect(label).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(label).not.toMatch(/draft|locked|superseded/);
  });
});
