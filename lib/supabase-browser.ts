// Browser-side Supabase client. Uses the ANON_KEY which is safe to expose.
// RLS protects writes; reads are public for catalogue tables.
//
// Cookie-based via @supabase/ssr so a magic-link session persists and is
// visible to Server Components (lib/supabase-auth-server.ts reads the same
// cookies). Signed-out visitors behave exactly as the old anon REST client.
//
// IMPORTANT: only import this file from Client Components. Server Components
// and Route Handlers should use lib/supabase-auth-server.ts (user-scoped) or
// the service-key client in `lib/supabase.ts` (privileged, no user).

import { createBrowserClient } from '@supabase/ssr';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing browser Supabase env vars. Need NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

export const supabaseBrowser = createBrowserClient(url, anonKey);
