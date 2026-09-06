import { NextResponse } from "next/server";

/**
 * Health check for Render (and any other host) — deliberately public (see
 * proxy.ts's ALWAYS_ALLOWED_PATHS) and deliberately shallow: it confirms
 * the Next.js server process is up and answering requests, nothing more.
 * No Supabase/database call, no env var dump, no service-role check, no
 * user/tenant data — see docs/64-render-staging-deployment.md, "What the
 * health check does (and does not) check."
 *
 * No "server-only" import and no dependency on any server-only module —
 * deliberately, so this route is directly unit-testable (see
 * tests/unit/health-route.test.ts) without needing a running server.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "scopevia",
    environment: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
    commit: process.env.RENDER_GIT_COMMIT ?? null,
    timestamp: new Date().toISOString(),
  });
}
