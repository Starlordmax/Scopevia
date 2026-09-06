import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The RLS suite makes real network round trips to a remote Postgres
    // instance (tests/rls/*.test.ts); the 5s default occasionally times out
    // under normal latency variance even though the assertion itself would
    // have passed. Unit tests finish in milliseconds regardless, so raising
    // this globally has no downside for them.
    testTimeout: 15000,
    // afterAll cleanup (deleting several users + a tenant) can exceed the
    // 10s default under real network latency — same reasoning as testTimeout.
    hookTimeout: 15000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // See tests/stubs/server-only-stub.ts -- the real "server-only"
      // package throws unconditionally outside Next.js's server bundler,
      // which would break any unit test importing a genuinely
      // server-only module (e.g. src/lib/ai/openrouter.ts).
      "server-only": path.resolve(__dirname, "./tests/stubs/server-only-stub.ts"),
    },
  },
});
