// Test-only stub for the "server-only" package. That package's default
// export throws unconditionally outside Next.js's server bundler (it
// only resolves to a no-op when the "react-server" module resolution
// condition is active) -- which includes plain Node/vitest, so any real
// unit test importing a `import "server-only"`-guarded module (like
// src/lib/ai/openrouter.ts, which genuinely reads a secret env var) would
// fail immediately. Aliased in vitest.config.ts's resolve.alias -- ONLY
// for tests, never affects the real Next.js build, where the guard still
// does its job normally.
export {};
