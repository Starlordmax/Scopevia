import { describe, expect, it } from "vitest";
import { friendlyRpcErrorMessage } from "../../src/lib/errors/friendly-message";

describe("friendlyRpcErrorMessage", () => {
  it("replaces a raw permission-key message with a generic one", () => {
    expect(friendlyRpcErrorMessage("Missing permission: opportunities.change_status")).toBe(
      "You do not have permission to do that."
    );
  });

  it("strips a trailing parenthetical that references internal function names", () => {
    expect(
      friendlyRpcErrorMessage(
        "Invalid transition: new -> won (archiving/restoring a won or lost opportunity uses archive_opportunity()/restore_opportunity() instead)"
      )
    ).toBe("Invalid transition: new -> won");
  });

  it("strips a project-status function-name parenthetical the same way", () => {
    expect(
      friendlyRpcErrorMessage("Invalid transition: draft -> won (archiving/restoring uses archive_project()/restore_project() instead)")
    ).toBe("Invalid transition: draft -> won");
  });

  it("leaves an already-friendly message untouched", () => {
    expect(friendlyRpcErrorMessage("Title is required")).toBe("Title is required");
    expect(friendlyRpcErrorMessage("Client not found in this tenant")).toBe("Client not found in this tenant");
    expect(friendlyRpcErrorMessage("lost_reason is required when marking an opportunity as lost")).toBe(
      "lost_reason is required when marking an opportunity as lost"
    );
  });
});
