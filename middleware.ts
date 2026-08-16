import { NextResponse, type NextRequest } from 'next/server';
import { get } from '@vercel/edge-config';
import { createServerClient } from '@supabase/ssr';
import { GONE_IDS, REDIRECTS, GONE_HTML } from './lib/orphan-gate';

// THREE independent jobs share this middleware:
//   /product/*  — Superdrug-removed gate (below, unchanged)
//   /account/*  — auth session refresh, so the /account Server Component sees
//                 a live session even after the access token expires (1h)
//   /ops/*      — Basic Auth on the internal panels (added 15 Aug 2026)
//
// THE MATCHER IS SHARED, AND THAT IS THE RISK IN THIS FILE. Adding one path here puts
// every product page in the blast radius of the change, because the same function now
// runs for both. The /ops branch returns before any Superdrug logic is reached, and this
// deploy carries NOTHING ELSE, so if product pages misbehave the cause is unambiguous.
export const config = { matcher: ['/product/:path*', '/account/:path*', '/ops/:path*'] };

// Basic Auth for /ops/*. One env var, no roles table, no coupling to Supabase Auth —
// which is a CUSTOMER surface here (four users, three of them not the operator) and would
// show catalogue diagnostics to customers if used as the gate.
//
// FAIL CLOSED. If OPS_BASIC_AUTH is unset, every /ops request is refused. The opposite
// default would turn a missing env var into a public internal panel, and a missing env
// var is exactly what a first deploy has.
function opsAuth(req: NextRequest): NextResponse {
  const expected = process.env.OPS_BASIC_AUTH; // "user:password"
  const deny = new NextResponse('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="fmb-ops", charset="UTF-8"' },
  });
  if (!expected) return deny;

  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith('Basic ')) return deny;

  let supplied: string;
  try {
    supplied = atob(header.slice(6));
  } catch {
    return deny;
  }

  // Length-independent comparison. The strings are short and the endpoint is not
  // rate-limited, so a naive === leaks length and prefix through timing.
  const a = new TextEncoder().encode(supplied);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  if (diff !== 0) return deny;

  const res = NextResponse.next();
  res.headers.set('x-robots-tag', 'noindex, nofollow');
  return res;
}

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
// Second header, added rather than renaming HDR. HDR's vocabulary is what ops greps
// for, and renaming it changes the search term during exactly the window you would be
// searching. This one carries PROVENANCE: where the gate's value came from, which HDR
// cannot express because HDR reports the OUTCOME.
const HDR_SRC = 'x-fmb-gate-source';

// KEY RENAME, PHASE 4 OF 5 (expand/contract) -- COMPLETE ON THIS SIDE.
// `superdrug_removed` gated more than Superdrug, so the name read as more than it was.
// The transition read BOTH keys because EITHER HALF ALONE OPENS THE GATE: renaming in
// Edge Config first leaves the code reading a key that no longer exists, and deploying
// a new-key-only read first leaves it reading one that does not exist yet.
//   1. DONE  deploy: read NEW, fall back to LEGACY.       gate stayed on
//   2. DONE  Edge Config: added orphan_gate_enabled=true. gate stayed on
//   3. DONE  verified on 16 Aug 2026 via HDR_SRC=config, and all three outcomes with it:
//            /product/650 -> 410 gone, /product/3308 -> 301 /brands/clearasil,
//            /product/81755 -> 200 on-passthrough.
//   4. THIS DEPLOY: legacy read dropped.
//   5. REMAINING, ROBBIE: delete `superdrug_removed` from the store. Safe once this is
//      live -- nothing reads it. Until then it is a harmless orphan, NOT a fallback:
//      after this deploy the only fallback is GATE_DEFAULT below.
const ORPHAN_GATE_KEY = 'orphan_gate_enabled';

// THE BUILD-TIME RECORD OF WHAT THE SWITCH IS EXPECTED TO SAY, and the fallback when
// Edge Config cannot be read.
//
// THE FAIL-SAFE DIRECTION WAS INVERTED BY THE FLIP AND IS NOW CORRECTED. The old
// comment read: "Reads default to 'error' (treated as inert) on any failure, so a
// missing/broken Edge Config connection can never accidentally 410 the catalogue."
// That was TRUE AND CORRECT while the gate was off. Once the gate went on it described
// a world that no longer exists: an unreadable flag no longer prevents an accidental
// 410, it CAUSES AN ACCIDENTAL UN-410 -- 20,849 ids revert from 410 to 404 and the 54
// curated 301s stop, for the duration of the outage.
//
// WHY A BUILD-TIME CONSTANT AND NOT THE ALTERNATIVES:
//   * A CACHED LAST VALUE is not viable here. Middleware isolates are per-region,
//     short-lived and recycled; a cold start has nothing. During an outage some regions
//     would answer from a warm cache and others from a cold one -- split-brain, which is
//     worse than either consistent answer and far harder to diagnose.
//   * TREATING UNREADABLE AS ON fails exactly when it matters. This switch exists for
//     instant rollback; if unreadable means on, then during an incident -- when Edge
//     Config is most likely degraded and when you are most likely rolling back -- a
//     rollback can silently undo itself.
//   * A CONSTANT is deterministic in every region, version-controlled, and visible in a
//     diff. It matches the deploy-speed rollback model already chosen for the id map.
//
// RESIDUAL, AND IT IS REAL: this constant must be updated to FOLLOW a deliberate flip.
// Roll back via Edge Config without deploying a change here and an outage reverts to
// this value, re-applying the removal. That divergence is why HDR_SRC exists.
const GATE_DEFAULT = true;

type FlagState = 'on' | 'off';
type GateSource = 'config' | 'default-absent' | 'default-unreadable';

// Per-key try/catch, NOT one around both: a throw on the new key must still reach the
// legacy fallback. A single catch spanning both would skip it and land on the default,
// which is the failure the fallback exists to prevent.
async function readKey(key: string): Promise<boolean | undefined | 'error'> {
  try {
    return await get<boolean>(key);
  } catch {
    return 'error';
  }
}

async function readGate(): Promise<{ state: FlagState; source: GateSource }> {
  // A BOOLEAN IS A REAL ANSWER AND STOPS HERE, INCLUDING `false`. That is the deliberate
  // kill switch, and it must never be mistaken for "no answer" and overridden by the
  // build-time default below. This is why the check is `typeof === 'boolean'` and not a
  // truthiness test: `if (primary)` would send a deliberate `false` to the fallback and
  // turn the gate back on, which is the exact inversion the transition guarded against.
  const primary = await readKey(ORPHAN_GATE_KEY);
  if (typeof primary === 'boolean') {
    return { state: primary ? 'on' : 'off', source: 'config' };
  }
  // No answer. Fail closed to the last deliberate state rather than going inert.
  return {
    state: GATE_DEFAULT ? 'on' : 'off',
    source: primary === 'error' ? 'default-unreadable' : 'default-absent',
  };
}

function pass(state: string, source?: GateSource): NextResponse {
  const res = NextResponse.next();
  res.headers.set(HDR, state);
  if (source) res.headers.set(HDR_SRC, source);
  return res;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  // FIRST, and before anything that can throw. /ops must never fall through to a
  // pass-through branch because something above it errored.
  if (req.nextUrl.pathname.startsWith('/ops')) {
    return opsAuth(req);
  }

  if (req.nextUrl.pathname.startsWith('/account')) {
    return refreshSession(req);
  }

  const m = req.nextUrl.pathname.match(/^\/product\/(\d+)(?:\/|$)/);
  if (!m) return NextResponse.next();

  const gate = await readGate();

  // HDR keeps its existing vocabulary so ops greps still work. 'flag-unreadable' now
  // means "neither key answered AND the default resolved to off" -- an unreadable flag
  // no longer forces inert, it falls back to GATE_DEFAULT. HDR_SRC is what distinguishes
  // a read from a fallback, on every response.
  if (gate.state !== 'on') {
    return pass(gate.source === 'default-unreadable' ? 'flag-unreadable' : 'inert', gate.source);
  }

  const id = Number(m[1]);

  // Curated equity-preserving redirects take precedence over 410.
  const to = REDIRECTS[id];
  if (to) {
    const res = NextResponse.redirect(new URL(to, req.url), 301);
    res.headers.set(HDR, 'redirect');
    res.headers.set(HDR_SRC, gate.source);
    return res;
  }

  // Long-tail orphans: 410 Gone. Merged/shade/unknown ids are NOT in GONE_IDS, so they
  // pass through and keep their existing 308-to-keeper / 404 behaviour.
  if (GONE_IDS.has(id)) {
    return new NextResponse(GONE_HTML, {
      status: 410,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        [HDR]: 'gone',
        // Provenance on the 410 too, because a KNOWN-GONE id is what a checker probes:
        // it is the one request whose expected outcome is unambiguous, so it is the one
        // that can carry "and the value came from Edge Config, not from the fallback".
        [HDR_SRC]: gate.source,
      },
    });
  }

  return pass('on-passthrough', gate.source);
}
