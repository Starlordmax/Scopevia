import { describe, expect, it } from "vitest";
import { proposalBadgeClass, versionStatusBadgeClass } from "../../src/lib/crm/status-badge";

describe("proposalBadgeClass (Phase 3B: accepted/declined)", () => {
  it("maps 'accepted' to the success (positive) badge", () => {
    expect(proposalBadgeClass("accepted")).toBe("badge-success");
  });

  it("maps 'declined' to the danger (negative) badge", () => {
    expect(proposalBadgeClass("declined")).toBe("badge-danger");
  });

  it("still distinguishes 'ready' and 'draft' from the response outcomes", () => {
    expect(proposalBadgeClass("ready")).toBe("badge-success");
    expect(proposalBadgeClass("draft")).toBe("");
  });
});

describe("versionStatusBadgeClass (Phase 3B.1: revisions)", () => {
  it("marks 'draft' as in-progress (warning)", () => {
    expect(versionStatusBadgeClass("draft")).toBe("badge-warning");
  });

  it("marks 'locked' and 'superseded' as neutral/historical", () => {
    expect(versionStatusBadgeClass("locked")).toBe("badge-neutral");
    expect(versionStatusBadgeClass("superseded")).toBe("badge-neutral");
  });

  it("returns an empty class for an unknown status", () => {
    expect(versionStatusBadgeClass("nonsense")).toBe("");
  });
});
