import { describe, expect, it } from "vitest";
import { GET } from "../../src/app/api/health/route";

describe("/api/health (Phase 3D.1)", () => {
  it("returns ok:true with the expected shape", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("scopevia");
    expect(typeof body.environment).toBe("string");
    expect(typeof body.timestamp).toBe("string");
  });

  it("timestamp is a valid, current ISO date", async () => {
    const response = await GET();
    const body = await response.json();
    const parsed = new Date(body.timestamp);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(Math.abs(Date.now() - parsed.getTime())).toBeLessThan(5000);
  });

  it("never exposes env var names/values, secrets, or database status", async () => {
    const response = await GET();
    const text = JSON.stringify(await response.json());
    expect(text).not.toMatch(/service_role|SUPABASE_SERVICE_ROLE_KEY|RESEND_API_KEY|password|secret/i);
  });

  it("commit is either null or a string, never leaking anything else", async () => {
    const response = await GET();
    const body = await response.json();
    expect(body.commit === null || typeof body.commit === "string").toBe(true);
  });
});
