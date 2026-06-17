import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

// On-demand ISR revalidation. Called by the importer (import-awin-feed finalize)
// and the merge DB helper (fmb_revalidate_brand_slugs) after data changes, so
// brand/category pages reflect fresh prices without waiting for the 1h ISR window.
// Auth: shared secret in the x-revalidate-secret header (REVALIDATE_SECRET env).
//
// NOTE: revalidatePath operates on pathnames only — query strings (e.g.
// ?type=skincare) are ignored by Next, and revalidating the base path
// "/brands/medicube" refreshes all of its rendered variants. Senders should pass
// clean pathnames, not URLs with query strings.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-revalidate-secret');
  if (!process.env.REVALIDATE_SECRET || secret !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let paths: unknown;
  try {
    ({ paths } = await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(paths)) {
    return NextResponse.json({ ok: false, error: 'paths must be an array' }, { status: 400 });
  }

  const revalidated: string[] = [];
  for (const p of paths) {
    if (typeof p !== 'string' || !p.startsWith('/')) continue;
    // Strip any accidental query string — revalidatePath wants a pathname.
    const pathname = p.split('?')[0];
    revalidatePath(pathname);
    revalidated.push(pathname);
  }

  return NextResponse.json({ ok: true, revalidated });
}
