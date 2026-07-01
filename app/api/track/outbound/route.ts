import { NextResponse } from 'next/server';
import { logOutboundClick } from '../../../../lib/events';
import { getSessionId } from '../../../../lib/session';

export const dynamic = 'force-dynamic';

// Receives a fire-and-forget beacon from ClickOutLink when a user clicks an
// outbound affiliate link. The click itself proceeds via the anchor's direct href
// (no redirect hop, so the affiliate link stays clean for AWIN and SEO); this route
// only records the event server-side, keeping the service-role write and the
// session cookie off the client. The service-role client and session id are both
// resolved here on the server. Always returns 204 and never throws, so a logging
// failure can never affect the user's navigation.
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    await logOutboundClick({
      productId: typeof body.productId === 'number' ? body.productId : null,
      retailerId: typeof body.retailerId === 'number' ? body.retailerId : null,
      awinMid: typeof body.awinMid === 'string' ? body.awinMid : null,
      price: typeof body.price === 'number' ? body.price : null,
      source: typeof body.source === 'string' ? body.source : null,
      path: typeof body.path === 'string' ? body.path : null,
      sessionId: getSessionId(),
    });
  } catch (err) {
    console.error('[track/outbound] failed:', err);
  }
  return new NextResponse(null, { status: 204 });
}
