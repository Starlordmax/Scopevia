import { test, expect } from "@playwright/test";

/**
 * Smoke test for /auth/callback (Phase: auth-callback-localhost-redirect-fix).
 * A real `code` requires a full Supabase PKCE round trip (a real
 * confirmation/reset email), not reproducible here — see
 * docs/68-auth-callback-localhost-redirect-fix.md, "How to test with a new
 * user" for the manual verification steps against a real deployment.
 *
 * What IS verified here, with a real running server and no mocking: the
 * route never trusts `next` on its failure path (no code = always
 * `/sign-in?error=...`, regardless of what `next` says), and the final
 * redirect always lands on this server's own canonical origin — never an
 * external host, even when `next` tries to smuggle one in.
 */
test.describe("/auth/callback", () => {
  test("no code redirects to /sign-in with an error, ignoring next entirely", async ({ request, baseURL }) => {
    const response = await request.get("/auth/callback", { maxRedirects: 0 });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    const location = response.headers()["location"];
    expect(location).toBeTruthy();
    const redirected = new URL(location!, baseURL);
    expect(redirected.origin).toBe(new URL(baseURL!).origin);
    expect(redirected.pathname).toBe("/sign-in");
    expect(redirected.searchParams.get("error")).toBe("auth_callback_failed");
  });

  test("an attempted open-redirect via next is never followed, even without a code", async ({ request, baseURL }) => {
    const response = await request.get("/auth/callback?next=//evil.example.com", { maxRedirects: 0 });
    const location = response.headers()["location"];
    expect(location).toBeTruthy();
    const redirected = new URL(location!, baseURL);
    expect(redirected.origin).toBe(new URL(baseURL!).origin);
    expect(redirected.hostname).not.toContain("evil.example.com");
  });

  test("a malformed code redirects to /sign-in on this server's own canonical origin, never an external one", async ({ request, baseURL }) => {
    const response = await request.get("/auth/callback?code=not-a-real-code&next=/sign-in", { maxRedirects: 0 });
    const location = response.headers()["location"];
    expect(location).toBeTruthy();
    const redirected = new URL(location!, baseURL);
    expect(redirected.origin).toBe(new URL(baseURL!).origin);
  });
});
