import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

// Routes that only make sense for a signed-OUT visitor — an authenticated
// user is redirected away from these to "/".
const GUEST_ONLY_PATHS = ["/sign-in", "/sign-up", "/forgot-password"];

// Routes that are reachable regardless of auth state and never trigger a
// redirect either way. "/reset-password" is here deliberately: a user
// arriving from a password-recovery email link IS authenticated (via a
// short-lived recovery session established by /auth/callback), so the
// guest-only redirect rule would otherwise bounce them straight to "/"
// before they can set a new password.
const ALWAYS_ALLOWED_PATHS = ["/auth/callback", "/reset-password"];

function matches(paths: string[], pathname: string): boolean {
  return paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Coarse-grained gate: authenticated vs. not. Tenant membership, role and
 * permission checks are deliberately NOT done here — they require a database
 * round trip against the caller's actual membership rows, and are re-checked
 * in the protected layout / server actions on every request (see
 * src/lib/auth/tenant.ts, src/lib/auth/permissions.ts). Treat this proxy
 * (formerly "middleware") as a UX convenience and a first line of defense,
 * not the security boundary.
 */
export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  if (matches(ALWAYS_ALLOWED_PATHS, pathname)) {
    return response;
  }

  const isGuestOnly = matches(GUEST_ONLY_PATHS, pathname);

  if (!user && !isGuestOnly) {
    const redirectUrl = new URL("/sign-in", request.url);
    redirectUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && isGuestOnly) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
