import { NextResponse } from 'next/server';
import { runSearch } from '../../../lib/search';

export const dynamic = 'force-dynamic';

// Typeahead endpoint. The search logic lives in lib/search.ts so the /search
// results page can call it directly without an internal HTTP round trip.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const results = await runSearch(searchParams.get('q') ?? '');
  return NextResponse.json(results);
}
