// Magic-link landing. The auth emails link here with a token_hash (see the
// magic-link / confirm-signup templates configured in Supabase Auth), which
// verifyOtp exchanges for a session — this works whichever browser or device
// the email is opened in, unlike the PKCE ?code= flow.
//
// Post-login flow: immediately after a session is established, claim any
// legacy email-keyed saved routine for this user. fmb_claim_legacy_routine()
// self-scopes to auth.uid()/email and takes no params; failures are logged
// but never block login.

import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createAuthServerClient } from '@/lib/supabase-auth-server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const rawNext = searchParams.get('next') ?? '/account';
  // Open-redirect guard: only same-site paths.
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/account';

  if (token_hash && type) {
    const supabase = createAuthServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });

    if (!error) {
      const { data: claim, error: claimError } = await supabase.rpc('fmb_claim_legacy_routine');
      if (claimError) {
        console.error('fmb_claim_legacy_routine failed:', claimError.message);
      } else if (claim?.[0]?.claimed_products) {
        console.log(
          `legacy routine claimed: ${claim[0].claimed_products} product(s), ${claim[0].skipped} skipped`
        );
      }
      return NextResponse.redirect(new URL(next, request.url));
    }
    console.error('magic-link verifyOtp failed:', error.message);
  }

  return NextResponse.redirect(new URL('/account?error=link', request.url));
}
