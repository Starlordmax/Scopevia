import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "../../../types/database";
import type { User } from "@supabase/supabase-js";

/**
 * Refreshes the Supabase auth session cookie on every request. This is what
 * keeps a signed-in user's session alive across server components without
 * every page having to handle token refresh itself.
 *
 * This ONLY tells us whether a request is authenticated. It intentionally
 * does not resolve tenant membership or permissions — those require a DB
 * round trip and are re-validated per request in layouts/server actions
 * (see src/lib/auth/tenant.ts), never trusted from middleware alone.
 */
export async function updateSession(request: NextRequest): Promise<{ response: NextResponse; user: User | null }> {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Fail open to a clear error page rather than a silent redirect loop.
    return { response, user: null };
  }

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
