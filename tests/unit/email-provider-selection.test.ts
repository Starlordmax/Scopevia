import { describe, expect, it } from "vitest";
import { resolveEmailProvider } from "../../src/lib/email/provider-selection";
import { validateResendConfig } from "../../src/lib/email/providers/resend-config";

describe("resolveEmailProvider", () => {
  it("defaults to dev when EMAIL_PROVIDER is unset, outside production", () => {
    const result = resolveEmailProvider({ emailProvider: undefined, nodeEnv: "development", allowDevProviderInProduction: undefined });
    expect(result).toEqual({ ok: true, provider: "dev" });
  });

  it("defaults to dev when EMAIL_PROVIDER is an empty string, outside production", () => {
    const result = resolveEmailProvider({ emailProvider: "", nodeEnv: "test", allowDevProviderInProduction: undefined });
    expect(result).toEqual({ ok: true, provider: "dev" });
  });

  it("is case-insensitive and trims whitespace", () => {
    const result = resolveEmailProvider({ emailProvider: "  Resend  ", nodeEnv: "development", allowDevProviderInProduction: undefined });
    expect(result).toEqual({ ok: true, provider: "resend" });
  });

  it("rejects an unrecognized provider name", () => {
    const result = resolveEmailProvider({ emailProvider: "mailgun", nodeEnv: "development", allowDevProviderInProduction: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Unknown EMAIL_PROVIDER/);
  });

  it("allows dev outside production with no override needed", () => {
    const result = resolveEmailProvider({ emailProvider: "dev", nodeEnv: "development", allowDevProviderInProduction: undefined });
    expect(result).toEqual({ ok: true, provider: "dev" });
  });

  it("allows resend/sendgrid/smtp in production with no override needed (dev is the only gated provider)", () => {
    for (const provider of ["resend", "sendgrid", "smtp"]) {
      const result = resolveEmailProvider({ emailProvider: provider, nodeEnv: "production", allowDevProviderInProduction: undefined });
      expect(result).toEqual({ ok: true, provider });
    }
  });

  it("REFUSES dev in production without the override", () => {
    const result = resolveEmailProvider({ emailProvider: "dev", nodeEnv: "production", allowDevProviderInProduction: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not allowed when NODE_ENV=production/);
  });

  it("REFUSES an unset EMAIL_PROVIDER (defaults to dev) in production without the override", () => {
    const result = resolveEmailProvider({ emailProvider: undefined, nodeEnv: "production", allowDevProviderInProduction: undefined });
    expect(result.ok).toBe(false);
  });

  it("does NOT accept a truthy-but-wrong override value (e.g. '1', 'yes') — only the exact string 'true'", () => {
    for (const value of ["1", "yes", "TRUE", "True"]) {
      const result = resolveEmailProvider({ emailProvider: "dev", nodeEnv: "production", allowDevProviderInProduction: value });
      expect(result.ok).toBe(false);
    }
  });

  it("allows dev in production when the override is exactly 'true'", () => {
    const result = resolveEmailProvider({ emailProvider: "dev", nodeEnv: "production", allowDevProviderInProduction: "true" });
    expect(result).toEqual({ ok: true, provider: "dev" });
  });
});

describe("validateResendConfig", () => {
  it("succeeds when both apiKey and from are present", () => {
    const result = validateResendConfig({ apiKey: "re_123", from: "proposals@example.com", replyTo: undefined });
    expect(result).toEqual({ ok: true, config: { apiKey: "re_123", from: "proposals@example.com", replyTo: undefined } });
  });

  it("passes through replyTo when present", () => {
    const result = validateResendConfig({ apiKey: "re_123", from: "proposals@example.com", replyTo: "support@example.com" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.replyTo).toBe("support@example.com");
  });

  it("fails when apiKey is missing", () => {
    const result = validateResendConfig({ apiKey: undefined, from: "proposals@example.com", replyTo: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("RESEND_API_KEY");
  });

  it("fails when from is missing", () => {
    const result = validateResendConfig({ apiKey: "re_123", from: undefined, replyTo: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("EMAIL_FROM");
  });

  it("fails when both are missing, listing both", () => {
    const result = validateResendConfig({ apiKey: undefined, from: undefined, replyTo: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("RESEND_API_KEY");
      expect(result.error).toContain("EMAIL_FROM");
    }
  });

  it("never echoes the actual api key value into the error message", () => {
    const result = validateResendConfig({ apiKey: undefined, from: undefined, replyTo: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toMatch(/re_[a-zA-Z0-9]/);
  });
});
