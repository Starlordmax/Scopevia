/**
 * Pure display-name formatting for Quick Create Client — no "server-only"
 * import, directly unit-testable (see tests/unit/quick-client.test.ts).
 * Business clients don't have a dedicated "company name" field on this
 * model (see docs/34-proposal-builder-ux.md, "Known limitations"), so this
 * same formula is used for both client types: the contact person's name
 * becomes the client's display_name.
 */
export function buildQuickClientDisplayName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}
