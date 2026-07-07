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

  it("replaces a PostgREST 'schema cache' overload-resolution error with a generic message, leaking no internal names", () => {
    const raw =
      "Could not find the function public.update_proposal_scope(p_estimated_start_date, p_proposal_version_id, p_summary) in the schema cache";
    const result = friendlyRpcErrorMessage(raw);
    expect(result).toBe("We couldn't complete that action. Please try again.");
    expect(result).not.toContain("update_proposal_scope");
    expect(result).not.toContain("public.");
    expect(result).not.toContain("p_proposal_version_id");
    expect(result).not.toContain("schema cache");
  });

  it("catches a 'Could not find the function' message even without the exact schema-cache wording", () => {
    const result = friendlyRpcErrorMessage("Could not find the function public.some_other_rpc(a, b) in the schema cache");
    expect(result).toBe("We couldn't complete that action. Please try again.");
  });
});
