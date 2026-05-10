// Browser-side Supabase client. Uses the ANON_KEY which is safe to expose.
// RLS protects writes; reads are public for catalogue tables.
//
// IMPORTANT: only import this file from Client Components. Server Components
// and Route Handlers should use the service-key client in `lib/supabase.ts`.

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing browser Supabase env vars. Need NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

export const supabaseBrowser = createClient(url, anonKey, {
  auth: {
    persistSession: false,
  },
});
