import { describe, expect, it } from "vitest";
import { validateStagingEnv } from "../../src/lib/env-validation";

const VALID_PRODUCTION_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  APP_BASE_URL: "https://scopevia-staging.onrender.com",
  EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: "re_123",
  EMAIL_FROM: "noreply@example.com",
};

describe("validateStagingEnv (Phase 3D.1)", () => {
  it("is a no-op outside production (local dev is expected to run with a subset of these unset)", () => {
    expect(validateStagingEnv({ NODE_ENV: "development" })).toEqual({ ok: true });
    expect(validateStagingEnv({ NODE_ENV: "test" })).toEqual({ ok: true });
  });

  it("passes with a complete, valid production config (resend)", () => {
    expect(validateStagingEnv(VALID_PRODUCTION_ENV)).toEqual({ ok: true });
  });

  it("fails when NEXT_PUBLIC_SUPABASE_URL is missing", () => {
    const { NEXT_PUBLIC_SUPABASE_URL: _omit, ...rest } = VALID_PRODUCTION_ENV;
    const result = validateStagingEnv(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("NEXT_PUBLIC_SUPABASE_URL"))).toBe(true);
  });

  it("fails when SUPABASE_SERVICE_ROLE_KEY is missing", () => {
    const { SUPABASE_SERVICE_ROLE_KEY: _omit, ...rest } = VALID_PRODUCTION_ENV;
    const result = validateStagingEnv(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("SUPABASE_SERVICE_ROLE_KEY"))).toBe(true);
  });

  it("fails when APP_BASE_URL is missing", () => {
    const { APP_BASE_URL: _omit, ...rest } = VALID_PRODUCTION_ENV;
    const result = validateStagingEnv(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("APP_BASE_URL"))).toBe(true);
  });

  it("fails when EMAIL_PROVIDER=resend but RESEND_API_KEY is missing", () => {
    const { RESEND_API_KEY: _omit, ...rest } = VALID_PRODUCTION_ENV;
    const result = validateStagingEnv(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("RESEND_API_KEY"))).toBe(true);
  });

  it("fails when EMAIL_PROVIDER=resend but EMAIL_FROM is missing", () => {
    const { EMAIL_FROM: _omit, ...rest } = VALID_PRODUCTION_ENV;
    const result = validateStagingEnv(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("EMAIL_FROM"))).toBe(true);
  });

  it("fails when EMAIL_PROVIDER is dev (or unset) in production without the dangerous override", () => {
    const { EMAIL_PROVIDER: _omit, RESEND_API_KEY: _omit2, EMAIL_FROM: _omit3, ...rest } = VALID_PRODUCTION_ENV;
    const result = validateStagingEnv(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("EMAIL_PROVIDER=dev"))).toBe(true);
  });

  it("allows EMAIL_PROVIDER=dev in production ONLY with the explicit override (e.g. local/CI E2E via `next start`)", () => {
    const { EMAIL_PROVIDER: _omit, RESEND_API_KEY: _omit2, EMAIL_FROM: _omit3, ...rest } = VALID_PRODUCTION_ENV;
    const result = validateStagingEnv({ ...rest, EMAIL_ALLOW_DEV_PROVIDER_IN_PRODUCTION: "true" });
    expect(result).toEqual({ ok: true });
  });

  it("aggregates every missing variable into one result, not just the first", () => {
    const result = validateStagingEnv({ NODE_ENV: "production" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("never includes a secret value in its own error messages", () => {
    const result = validateStagingEnv({ NODE_ENV: "production", SUPABASE_SERVICE_ROLE_KEY: "super-secret-value-should-never-appear" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const joined = result.errors.join(" ");
      expect(joined).not.toContain("super-secret-value-should-never-appear");
    }
  });
});
