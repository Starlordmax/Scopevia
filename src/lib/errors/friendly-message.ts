/**
 * Sanitizes a raw Postgres RPC error message before it reaches a user-facing
 * error banner. The Phase 1 SECURITY DEFINER functions raise clear,
 * human-readable exceptions (e.g. "Title is required"), but a few reference
 * internal implementation details that a contractor using the app has no
 * reason to see: permission keys ("Missing permission: opportunities.archive")
 * and function names ("... uses archive_opportunity()/restore_opportunity()
 * instead"). Everything else passes through unchanged — this is deliberately
 * narrow, not a general-purpose message rewriter.
 */
export function friendlyRpcErrorMessage(raw: string): string {
  if (/^Missing permission: /.test(raw)) {
    return "You do not have permission to do that.";
  }

  if (raw.includes("()")) {
    const parenIndex = raw.indexOf("(");
    const stripped = parenIndex === -1 ? raw : raw.slice(0, parenIndex).trim();
    return stripped || "That action is not allowed right now.";
  }

  return raw;
}
