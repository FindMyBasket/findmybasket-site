import { NextResponse, type NextRequest } from 'next/server';
import { get } from '@vercel/edge-config';
import { GONE_IDS, REDIRECTS, GONE_HTML } from './lib/superdrug-removed';

// Only run on product detail URLs. Everything else skips the middleware entirely.
export const config = { matcher: '/product/:path*' };

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
