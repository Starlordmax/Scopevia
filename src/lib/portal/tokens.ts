import "server-only";

import { randomBytes, randomInt, createHash } from "node:crypto";

/**
 * Client Portal secret generation and hashing (Phase 3A). Every secret this
 * module produces — link tokens, OTP codes, session tokens — is generated
 * here with Node's CSPRNG and hashed with SHA-256 before it ever reaches
 * Postgres. The raw value is handed back to the caller exactly once (to put
 * in a URL, email, or cookie) and is never stored anywhere, in any form —
 * only its hash is persisted (proposal_portal_links.token_hash,
 * proposal_portal_otps.code_hash, proposal_portal_sessions.session_token_hash).
 * See docs/53-client-portal-security.md.
 */

/** 256 bits of randomness, URL-safe — embedded directly in the /p/[token] URL. */
export function generatePortalLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

/** 256 bits of randomness, URL-safe — held only in the session cookie. */
export function generatePortalSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** A 6-digit numeric one-time code, zero-padded (e.g. "004821"). */
export function generatePortalOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** SHA-256 hex digest — the only form of a secret ever sent to Postgres. */
export function hashPortalSecret(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * A coarse, non-reversible fingerprint for rate-limiting/abuse investigation
 * (proposal_portal_otps.ip_hash/user_agent_hash, proposal_view_events.ip_hash/
 * user_agent_hash) — never the raw IP/user-agent (brief: "No guardar IP
 * cruda si no es necesario"). Returns null for an empty/missing input rather
 * than hashing an empty string, so "no IP available" stays distinguishable
 * from "hash of an empty string" in the data.
 */
export function hashIdentifier(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Namespaces the portal session cookie by link, so a visitor with several
 * portal links open in different tabs (different proposals) gets
 * independent cookies instead of one clobbering another — and a session
 * cookie is only ever looked up under the exact token it was issued for.
 * Deterministic (same token -> same cookie name), not secret (the token
 * hash it's derived from is itself never exposed, only used internally).
 */
export function portalSessionCookieName(tokenHash: string): string {
  return `scopevia_portal_session_${tokenHash.slice(0, 32)}`;
}

export const PORTAL_SESSION_TTL_HOURS = 24;

/**
 * httpOnly + sameSite=lax + secure-in-production, matching
 * activeTenantCookieOptions() (src/lib/auth/tenant.ts). `path` is scoped to
 * this exact link's own route tree (`/p/<token>`), not `/` — the browser
 * will never even send this cookie to a different link's pages, an extra
 * layer on top of the cookie being named per-link in the first place.
 */
export function portalSessionCookieOptions(rawToken: string) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: `/p/${rawToken}`,
    maxAge: PORTAL_SESSION_TTL_HOURS * 60 * 60,
  };
}
