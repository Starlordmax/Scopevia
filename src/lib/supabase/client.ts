"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "../../../types/database";

/**
 * Browser-side Supabase client. Uses only the public URL + anon key — safe
 * to bundle into client components. All authorization still happens on the
 * server (RLS + SECURITY DEFINER functions); this client never bypasses it.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill them in."
    );
  }

  return createBrowserClient<Database>(url, anonKey);
}
