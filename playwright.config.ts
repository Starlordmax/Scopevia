import { defineConfig, devices } from "@playwright/test";

/**
 * Real-browser E2E suite for Phase 1. Targets the same dedicated
 * `scopevia-test` Supabase project used by tests/rls/*.test.ts (see
 * .env.local — NEXT_PUBLIC_SUPABASE_URL there already points at it).
 * Never run this against production.
 *
 * No retries: a passing run must mean the interaction actually worked, not
 * "it worked on attempt 2" — retries would hide real flakiness rather than
 * surface it, per docs/25-phase-1-e2e-verification.md.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Even against a prebuilt (non-dev) server, all workers still share one
  // Next.js process AND one remote Postgres project (scopevia-test) — every
  // page load does several sequential DB round trips (auth, tenant
  // resolution, permission checks), and that network latency — not just
  // dev-mode compilation — is what serializes badly at higher concurrency.
  workers: process.env.CI ? 2 : 2,
  reporter: [["html", { open: "never" }], ["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    navigationTimeout: 45_000,
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      // Any *.mobile.spec.ts asserts real mobile-viewport layout (stacked
      // columns, no horizontal scroll) — those assertions are only true
      // under the "mobile" project's 390x844 viewport, so they must not
      // also run here under desktop.
      testIgnore: [/.*\.setup\.ts/, /.*\.mobile\.spec\.ts/],
    },
    {
      name: "mobile",
      // ~390x844 — matches an iPhone 12/13/14-class viewport, per the brief.
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
      dependencies: ["setup"],
      testMatch: [/.*\.mobile\.spec\.ts/],
    },
  ],
  webServer: {
    // A production build, not `next dev`: dev mode compiles each route the
    // first time it's requested, and that on-demand compilation serialized
    // badly under concurrent test load (real navigation timeouts across
    // several runs of this suite — see docs/25-phase-1-e2e-verification.md).
    // A prebuilt server has no compile-time contention at all.
    command: "npm run build && npm run start",
    url: "http://localhost:3000/sign-in",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
