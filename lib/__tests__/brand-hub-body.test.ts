import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeBrandHubBody } from '../brand-hub-body.ts';

const AFFILIATE =
  'https://www.awin1.com/cread.php?awinmid=122652&awinaffid=2841268&ued=https%3A%2F%2Fabib.global%2F';

// The affiliate rel tokens are the whole compliance story: strip 'sponsored'
// and the link reads as undisclosed; strip 'noopener' and target="_blank"
// hands the opened page a handle back to ours. sanitize-html's own default
// <a> attribute list omits rel, so this is the regression that matters most.
test('preserves rel and target on affiliate links', () => {
  const out = sanitizeBrandHubBody(
    `<p><a href="${AFFILIATE}" rel="sponsored nofollow noopener" target="_blank">Shop Abib</a></p>`
  );

  assert.match(out, /rel="[^"]*sponsored[^"]*"/);
  assert.match(out, /rel="[^"]*nofollow[^"]*"/);
  assert.match(out, /rel="[^"]*noopener[^"]*"/);
  assert.match(out, /target="_blank"/);
  assert.ok(out.includes('awinmid=122652'), 'affiliate URL must survive intact');
});

test('keeps relative internal comparison links', () => {
  const out = sanitizeBrandHubBody(
    '<p><a href="/product/16160">Compare</a> <a href="/brands/abib">Brand</a> <a href="/app">Routine</a></p>'
  );

  assert.ok(out.includes('href="/product/16160"'));
  assert.ok(out.includes('href="/brands/abib"'));
  assert.ok(out.includes('href="/app"'));
});

test('adds noopener when a _blank link omits it', () => {
  const out = sanitizeBrandHubBody(
    `<p><a href="${AFFILIATE}" rel="sponsored" target="_blank">Shop</a></p>`
  );

  assert.match(out, /rel="[^"]*noopener[^"]*"/);
  assert.match(out, /rel="[^"]*sponsored[^"]*"/, 'authored tokens must survive');
});

test('leaves rel alone on same-tab internal links', () => {
  const out = sanitizeBrandHubBody('<p><a href="/product/2744">Compare</a></p>');
  assert.ok(!out.includes('rel='), 'internal links should not gain noopener');
});

test('strips script tags and their contents', () => {
  const out = sanitizeBrandHubBody('<p>Copy</p><script>alert(1)</script>');
  assert.ok(!out.includes('script'));
  assert.ok(!out.includes('alert'));
  assert.ok(out.includes('Copy'));
});

test('strips event handlers and javascript: URLs', () => {
  const out = sanitizeBrandHubBody(
    '<p onclick="alert(1)">Copy</p><a href="javascript:alert(1)">Bad</a>'
  );
  assert.ok(!out.includes('onclick'));
  assert.ok(!out.includes('javascript:'));
});

test('drops tags outside the allowlist but keeps their text', () => {
  const out = sanitizeBrandHubBody('<div><p>Kept</p><img src="x.png"><h1>Heading</h1></div>');
  assert.ok(!out.includes('<div'));
  assert.ok(!out.includes('<img'));
  assert.ok(!out.includes('<h1'));
  assert.ok(out.includes('<p>Kept</p>'));
});

test('keeps the tags the spotlight body actually uses', () => {
  const out = sanitizeBrandHubBody(
    '<h2>Section</h2><p><strong>Bold</strong> and <em>italic</em></p>'
  );
  assert.ok(out.includes('<h2>Section</h2>'));
  assert.ok(out.includes('<strong>Bold</strong>'));
  assert.ok(out.includes('<em>italic</em>'));
});

test('returns empty string for null or empty body', () => {
  assert.equal(sanitizeBrandHubBody(null), '');
  assert.equal(sanitizeBrandHubBody(''), '');
});
