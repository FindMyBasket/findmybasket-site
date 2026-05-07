import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client. Uses SERVICE_ROLE_KEY so we bypass RLS
// for product catalogue queries. NEVER import this from a Client
// Component - only from Server Components or Route Handlers.

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    'Missing Supabase env vars. Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
  },
});
