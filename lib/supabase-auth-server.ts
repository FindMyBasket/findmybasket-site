// User-scoped Supabase client for Server Components and Route Handlers.
// Reads the auth session from cookies (written by the browser client /
// middleware), so RPCs run as the signed-in user and RLS applies.
//
// This is deliberately separate from lib/supabase.ts (service key, no user):
// use THIS one whenever the query should be scoped to the visitor.

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function createAuthServerClient() {
  if (!url || !anonKey) {
    throw new Error(
      'Missing Supabase env vars. Need NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    );
  }
  const cookieStore = cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Safe to ignore: middleware refreshes sessions for /account.
        }
      },
    },
  });
}
