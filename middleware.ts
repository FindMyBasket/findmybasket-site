import { NextResponse, type NextRequest } from 'next/server';
import { get } from '@vercel/edge-config';
import { createServerClient } from '@supabase/ssr';
import { GONE_IDS, REDIRECTS, GONE_HTML } from './lib/superdrug-removed';

// Two independent jobs share this middleware:
//   /product/*  — Superdrug-removed gate (below, unchanged)
//   /account/*  — auth session refresh, so the /account Server Component sees
//                 a live session even after the access token expires (1h)
export const config = { matcher: ['/product/:path*', '/account/:path*'] };

// Refresh the Supabase auth session cookies. getUser() forces a token refresh
// when the access token is expired; setAll writes the rotated cookies onto
// both the forwarded request and the response.
async function refreshSession(req: NextRequest): Promise<NextResponse> {
  let res = NextResponse.next({ request: req });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return res; // fail open: page renders signed-out

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        cookiesToSet.forEach(({ name, value, options }) =>
          res.cookies.set(name, value, options)
        );
      },
    },
  });

  await supabase.auth.getUser();
  return res;
}

// Observability header set on every response this middleware touches. Its PRESENCE
// proves the middleware executed on the route; its VALUE proves what it decided and —
// critically — whether the Edge Config flag was actually readable. This lets us prove
// the full chain end-to-end BEFORE the flip instead of discovering a disconnect at it:
//   inert            flag read OK and false   -> pass-through (the pre-flip state) ✅
//   flag-unreadable  Edge Config threw        -> inert (fail-safe) BUT EDGE_CONFIG not wired
//   gone / redirect  flag on, orphan handled  -> 410 / 301
//   on-passthrough   flag on, id not an orphan-> survivor, passes through
const HDR = 'x-fmb-superdrug-gate';

type FlagState = 'on' | 'off' | 'error';

// Reads default to 'error' (treated as inert) on any failure, so a missing/broken
// Edge Config connection can never accidentally 410 the catalogue.
async function readFlag(): Promise<FlagState> {
  try {
    return (await get<boolean>('superdrug_removed')) === true ? 'on' : 'off';
  } catch {
    return 'error';
  }
}

function pass(state: string): NextResponse {
  const res = NextResponse.next();
  res.headers.set(HDR, state);
  return res;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  if (req.nextUrl.pathname.startsWith('/account')) {
    return refreshSession(req);
  }

  const m = req.nextUrl.pathname.match(/^\/product\/(\d+)(?:\/|$)/);
  if (!m) return NextResponse.next();

  const flag = await readFlag();

  // Inert until the removal is switched on. 'error' also stays inert (fail-safe) but is
  // tagged distinctly so a missing EDGE_CONFIG connection can't hide as a benign 200.
  if (flag !== 'on') return pass(flag === 'off' ? 'inert' : 'flag-unreadable');

  const id = Number(m[1]);

  // Curated equity-preserving redirects take precedence over 410.
  const to = REDIRECTS[id];
  if (to) {
    const res = NextResponse.redirect(new URL(to, req.url), 301);
    res.headers.set(HDR, 'redirect');
    return res;
  }

  // Long-tail orphans: 410 Gone. Merged/shade/unknown ids are NOT in GONE_IDS, so they
  // pass through and keep their existing 308-to-keeper / 404 behaviour.
  if (GONE_IDS.has(id)) {
    return new NextResponse(GONE_HTML, {
      status: 410,
      headers: { 'content-type': 'text/html; charset=utf-8', [HDR]: 'gone' },
    });
  }

  return pass('on-passthrough');
}
