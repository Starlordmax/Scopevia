import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "../../../types/database";

function getEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill them in."
    );
  }
  return { url, anonKey };
}

/**
 * Server-side Supabase client for Server Components, Server Actions and
 * Route Handlers. Runs with the anon key + the caller's session cookie, so
 * every query and RPC call is still subject to RLS as that specific user —
 * it does NOT bypass security, it just reads the session from cookies
 * instead of a browser-held token.
 */
export async function createClient() {
  const { url, anonKey } = getEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render, where cookies are read-only.
          // The middleware is responsible for refreshing the session cookie in
          // that case — see src/lib/supabase/middleware.ts.
        }
      },
    },
  });
}
