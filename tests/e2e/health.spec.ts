import { test, expect } from "@playwright/test";

/**
 * Smoke test for the Render health check (Phase 3D.1) — a pure HTTP check
 * (Playwright's `request` fixture, no browser page) against the real
 * running server, unauthenticated. No storageState — /api/health must be
 * reachable without a session, exactly like Render's own health checker.
 */
test.describe("/api/health", () => {
  test("returns ok:true without requiring authentication", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("scopevia");
    expect(typeof body.timestamp).toBe("string");
  });

  test("never exposes secrets or env var names in the response", async ({ request }) => {
    const response = await request.get("/api/health");
    const text = await response.text();
    expect(text).not.toMatch(/service_role|SUPABASE_SERVICE_ROLE_KEY|RESEND_API_KEY|password|secret/i);
  });
});
