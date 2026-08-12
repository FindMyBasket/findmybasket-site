/**
 * THE TWO NAVIGATIONS MUST NOT DRIFT APART.
 *
 * The site has two independently maintained navs: the static blocks in
 * public/index.html (desktop and mobile — themselves two copies) and SiteNav.tsx,
 * which renders on every React route. On 12 August 2026 they had drifted three
 * separate ways at once: Supplements absent from both static blocks, /finder absent
 * from both, and "Build a routine" pointing at /app in one and /app.html in the
 * other. Work-list item 68.
 *
 * NONE OF THEM WAS DETECTABLE, and that is the reason this test exists rather than
 * a code-review habit. Each nav is internally consistent — open either and it reads
 * as a complete, deliberate list. Every link resolves. No build breaks, no test
 * fails, nothing 404s. Supplements was live on its route, in the sitemap, on the
 * homepage cards and in the React nav, and a homepage visitor still had no way to
 * click it. There is no position from which the two can be compared except
 * deliberately putting them side by side, which is what this does.
 *
 * WHY A PARSER AND NOT AN IMPORT. public/index.html is a static file with no import
 * of anything — its links are duplicated CONTENT, not duplicated logic, which is why
 * lib/__tests__/category-labels.test.ts cannot reach it. Same instrument as that
 * file's catRoutes assertion: read the un-importable copy as text and assert it
 * agrees.
 *
 * THIS TEST IS EXPECTED TO BECOME REDUNDANT. Work-list item 69 migrates the homepage
 * to a Next page that consumes SiteNav directly, at which point there is one nav and
 * nothing to compare. That migration sits behind Boots supplements, so this holds the
 * line until then. A parser that becomes redundant is a better outcome than a launch
 * that finds a fourth divergence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HTML = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
const SITENAV = readFileSync(join(ROOT, 'components', 'SiteNav.tsx'), 'utf8');

/**
 * KNOWN DIVERGENCES, each with the item that closes it.
 *
 * This list is NOT an escape hatch. Every entry is asserted to STILL DIVERGE below,
 * so fixing one without deleting its line here fails the suite. The list cannot rot
 * into a permanent set of exemptions, which is the usual fate of an allowlist.
 */
const KNOWN_DIVERGENCES: { href: string; why: string }[] = [
  {
    href: '/app.html',
    why: 'Item 68: "Build a routine" is /app in the static navs and /app.html in SiteNav. ' +
      'Both resolve; /app is a 200 and /app.html a 308 hop. Recorded, not scheduled.',
  },
];

/** hrefs in a named block of public/index.html. */
function staticNav(block: 'desktop' | 'mobile'): Set<string> {
  const pattern = block === 'desktop'
    ? /<div class="nav-links">(.*?)\n {4}<\/div>/s
    : /<div class="mobile-menu"[^>]*>(.*?)\n {2}<\/div>/s;
  const m = HTML.match(pattern);
  assert.ok(m, `could not find the ${block} nav block in public/index.html — has its markup changed?`);
  return new Set([...m[1].matchAll(/href="([^"]+)"/g)].map(x => x[1]));
}

/**
 * Every href SiteNav renders. BOTH forms are read, deliberately: the `href: '...'`
 * properties of NAV_LINKS/SPOTLIGHT_LINK/FINDER_LINK, and the `href="..."` JSX
 * attributes written directly in the markup.
 *
 * Reading only the first form is how the /app.html divergence hid from an earlier
 * draft of this test — "Build a routine" is a literal JSX attribute, so the guard
 * looked green while the thing it exists to catch sat two lines away. The anti-rot
 * test below is what surfaced it.
 */
function reactNav(): Set<string> {
  const hrefs = new Set([
    ...[...SITENAV.matchAll(/href:\s*'([^']+)'/g)].map(x => x[1]),
    ...[...SITENAV.matchAll(/href="(\/[^"]*)"/g)].map(x => x[1]),
  ]);
  assert.ok(hrefs.size > 5, 'parsed too few hrefs from SiteNav.tsx — has NAV_LINKS changed shape?');
  return hrefs;
}

// Links that exist for reasons other than navigation parity, and are not expected
// in both. The logo and the search icon are chrome, not nav entries.
const NOT_NAV = new Set(['/index.html', '/search']);

test('every SiteNav link appears in BOTH static nav blocks', () => {
  const react = reactNav();
  const desktop = staticNav('desktop');
  const mobile = staticNav('mobile');
  const known = new Set(KNOWN_DIVERGENCES.map(d => d.href));

  const missing: string[] = [];
  for (const href of react) {
    if (NOT_NAV.has(href) || known.has(href)) continue;
    if (!desktop.has(href)) missing.push(`${href} — missing from the DESKTOP block`);
    if (!mobile.has(href)) missing.push(`${href} — missing from the MOBILE block`);
  }
  assert.deepEqual(
    missing,
    [],
    'SiteNav.tsx and public/index.html have drifted. A link in the React nav and not the ' +
      'static one is invisible: both navs still render, every link still resolves, and a ' +
      'homepage visitor simply cannot reach the page.\n  ' + missing.join('\n  '),
  );
});

test('the two static blocks agree with each other', () => {
  // They are two copies of one list in one file, which is the easiest pair to let
  // drift: an entry added to the desktop nav and not the mobile one is invisible on
  // a desktop reviewer's screen.
  const desktop = staticNav('desktop');
  const mobile = staticNav('mobile');
  const onlyDesktop = [...desktop].filter(h => !mobile.has(h) && !NOT_NAV.has(h));
  const onlyMobile = [...mobile].filter(h => !desktop.has(h) && !NOT_NAV.has(h));
  assert.deepEqual(onlyDesktop, [], `in the desktop nav only: ${onlyDesktop.join(', ')}`);
  assert.deepEqual(onlyMobile, [], `in the mobile nav only: ${onlyMobile.join(', ')}`);
});

test('the category run is the ALL_CATEGORIES order in every nav', () => {
  // Item 66 found four different orderings of the same category list, the fourth
  // being the card grid — the one a visitor actually sees. Order is content too.
  const queries = readFileSync(join(ROOT, 'lib', 'queries.ts'), 'utf8');
  const cats = [...(queries.match(/export const ALL_CATEGORIES[^=]*=\s*\[([^\]]*)\]/) ?? ['', ''])[1]
    .matchAll(/'([^']+)'/g)].map(x => x[1]);
  assert.ok(cats.length >= 6, 'could not parse ALL_CATEGORIES');

  const slugFor = (c: string) => (c === 'bath_body' ? '/bath-and-body' : `/${c}`);
  const expected = cats.map(slugFor);

  for (const [name, hrefs] of [
    ['desktop', [...staticNav('desktop')]],
    ['mobile', [...staticNav('mobile')]],
    ['SiteNav', [...reactNav()]],
  ] as [string, string[]][]) {
    const seen = hrefs.filter(h => expected.includes(h));
    assert.deepEqual(
      seen,
      expected,
      `${name} does not list the categories in ALL_CATEGORIES order, or is missing one.\n` +
        `  expected: ${expected.join(' ')}\n  found:    ${seen.join(' ')}`,
    );
  }
});

test('KNOWN_DIVERGENCES cannot rot: every entry must still actually diverge', () => {
  // The point of this test. An allowlist entry that has been fixed but not deleted
  // is a silent exemption for the NEXT divergence on the same href.
  const react = reactNav();
  const desktop = staticNav('desktop');
  const mobile = staticNav('mobile');

  for (const { href, why } of KNOWN_DIVERGENCES) {
    const stillDiverges = react.has(href) !== (desktop.has(href) && mobile.has(href));
    assert.ok(
      stillDiverges,
      `KNOWN_DIVERGENCES still lists ${href}, but the navs now agree on it. ` +
        `Delete the entry — leaving it exempts this href from the guard forever.\n  was: ${why}`,
    );
  }
});
