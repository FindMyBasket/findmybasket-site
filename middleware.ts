import { NextResponse, type NextRequest } from 'next/server';
import { get } from '@vercel/edge-config';
import { GONE_IDS, REDIRECTS, GONE_HTML } from './lib/superdrug-removed';

// Only run on product detail URLs. Everything else skips the middleware entirely.
export const config = { matcher: '/product/:path*' };

// Instant kill-switch. While this returns false the middleware is a pure
// pass-through, so it can be deployed BEFORE the Superdrug (r12) removal with zero
// user-visible effect (orphan pages still serve their live offer). Flip the Edge
// Config `superdrug_removed` key to true at the SAME moment as
// `UPDATE retailers SET active=false WHERE id=12` for zero-gap activation: no window
// where orphan pages 404 (dropped from products_active before middleware is live),
// and none where they 410 while still live. Rollback = flip both back.
//
// Defaults to false on any error / missing Edge Config, so a misconfiguration can
// never accidentally 410 the catalogue.
async function superdrugRemoved(): Promise<boolean> {
  try {
    return (await get<boolean>('superdrug_removed')) === true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const m = req.nextUrl.pathname.match(/^\/product\/(\d+)(?:\/|$)/);
  if (!m) return NextResponse.next();

  // No-op until the removal is switched on.
  if (!(await superdrugRemoved())) return NextResponse.next();

  const id = Number(m[1]);

  // Curated equity-preserving redirects take precedence over 410 (few hundred
  // orphans with real organic traffic → their surviving brand page).
  const to = REDIRECTS[id];
  if (to) return NextResponse.redirect(new URL(to, req.url), 301);

  // Long-tail orphans: 410 Gone (honest, faster de-index than 404). Merged/shade
  // children and unknown ids are NOT in GONE_IDS, so they fall through to the page
  // and keep their existing 308-to-keeper / 404 behaviour.
  if (GONE_IDS.has(id)) {
    return new NextResponse(GONE_HTML, {
      status: 410,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  return NextResponse.next();
}
