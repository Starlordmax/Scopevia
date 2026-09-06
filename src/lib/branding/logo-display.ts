/**
 * Pure "what should ProposalDocument render" decision — no server-only
 * dependency, so unit-testable without a component-rendering harness (this
 * project's Vitest setup runs in the plain "node" environment with no
 * jsdom/@testing-library, so this is the same pure-logic-extraction pattern
 * used throughout: put the decision in a plain function, let the component
 * stay a thin, untested render of that decision). Businesses without a
 * logo fall back to name-only text, exactly as they did before Phase 3D.2.
 */
export type LogoDisplay = { src: string; alt: string };

export function resolveLogoDisplay(logoUrl: string | null | undefined, businessName: string): LogoDisplay | null {
  if (!logoUrl) return null;
  return { src: logoUrl, alt: `${businessName} logo` };
}
