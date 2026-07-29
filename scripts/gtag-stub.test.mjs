/**
 * Tests for public/fmb-gtag-stub.js.
 *
 *   node scripts/gtag-stub.test.mjs
 *
 * Loads the REAL file rather than a copy, so the tests cannot drift from the
 * shipped behaviour. The stub touches no DOM and no storage by design, so a
 * bare object standing in for `window` is enough and no jsdom is needed.
 *
 * Covers, in order of how much they matter:
 *   THE GATE   refuse, browse, then accept: nothing from the refused period is
 *              transmitted. This is the only test that proves the DISCARD, and
 *              the discard is the half with legal consequence.
 *   the bound  the 51st event is dropped, and dropping does not corrupt the
 *              replay of the first fifty.
 *   the replay ordering (js and config ahead of replayed events), no double
 *              replay on a second grant, cap lifted after consent.
 */

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUB = readFileSync(join(HERE, '..', 'public', 'fmb-gtag-stub.js'), 'utf8');

// Fresh window per test. The stub is an IIFE that only ever reads and writes
// `window`, so this is a complete environment for it.
function loadStub() {
  const win = {};
  runInNewContext(STUB, { window: win });
  return win;
}

// gtag stores raw `arguments` objects. Render them comparably.
//
// Array.from twice, rather than dl.map, deliberately: `dl` and its entries were
// created inside the vm realm, so their prototypes are that realm's Array and
// Object. assert.strict compares prototypes by identity and would report
// "same structure but not reference-equal" on values that are in fact correct.
// Array.from is this realm's, so the result is this realm's.
const readable = (dl) => Array.from(dl, (a) => Array.from(a));

// Stands in for the banner's loadAnalytics: pushes js + config, exactly as the
// real one does, without creating a script element.
function fakeLoadAnalytics(win) {
  return () => {
    win.gtag('js', 'DATE');
    win.gtag('config', 'G-TEST', { anonymize_ip: true });
  };
}

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message}`);
  }
}

console.log('\nfmb-gtag-stub.js\n');

// ── THE GATE ────────────────────────────────────────────────────────────────
// Everything else proves the replay works. Only this proves the discard works.

test('GATE: refuse, browse, then accept transmits NOTHING from the refused period', () => {
  const win = loadStub();

  // Visitor browses before deciding.
  win.gtag('event', 'view_item', { item_id: 'before-decision' });
  win.gtag('event', 'search', { search_term: 'before-decision' });
  assert.equal(win.dataLayer.length, 2, 'events should queue before a decision');

  // They refuse.
  win.FMBGtag.resolve(false, fakeLoadAnalytics(win));
  assert.equal(win.dataLayer.length, 0, 'refusal must empty the queue');

  // They keep browsing. None of this may be retained.
  win.gtag('event', 'view_item', { item_id: 'during-refusal' });
  win.gtag('event', 'retailer_click', { retailer_name: 'during-refusal' });
  assert.equal(win.dataLayer.length, 0, 'events after refusal must not queue');

  // They later change their mind via Cookie Settings.
  win.FMBGtag.resolve(true, fakeLoadAnalytics(win));

  const sent = readable(win.dataLayer);
  const flat = JSON.stringify(sent);
  assert.ok(!flat.includes('before-decision'), 'pre-decision events must not be transmitted after a refusal');
  assert.ok(!flat.includes('during-refusal'), 'events from the refused period must NEVER be transmitted');

  // And the acceptance itself must still work from that point forward.
  assert.deepEqual(sent[0], ['js', 'DATE']);
  assert.deepEqual(sent[1], ['config', 'G-TEST', { anonymize_ip: true }]);
  assert.equal(sent.length, 2, 'only js + config should be present, nothing replayed');
});

test('GATE: accepting after a refusal restores working analytics', () => {
  // Regression test. The first implementation set gtag to a hard no-op on
  // refusal and never restored it, so a later acceptance configured nothing and
  // analytics stayed dead for the rest of the page. The discard was correct and
  // the recovery was not, and only the refuse-then-accept order exposes it.
  const win = loadStub();
  win.gtag('event', 'view_item', { item_id: 'refused-period' });
  win.FMBGtag.resolve(false, fakeLoadAnalytics(win));
  win.FMBGtag.resolve(true, fakeLoadAnalytics(win));

  assert.equal(typeof win.gtag, 'function');
  win.gtag('event', 'view_item', { item_id: 'after-acceptance' });

  const sent = readable(win.dataLayer);
  const flat = JSON.stringify(sent);
  assert.ok(flat.includes('after-acceptance'), 'events after acceptance must be transmitted');
  assert.ok(!flat.includes('refused-period'), 'events from the refused period must still never appear');
});

test('GATE: refusal replaces gtag outright, so nothing can re-enter the queue', () => {
  const win = loadStub();
  win.gtag('event', 'a');
  win.FMBGtag.resolve(false, fakeLoadAnalytics(win));

  // Hammer it: neither the queue nor a later grant may pick anything up.
  for (let i = 0; i < 200; i++) win.gtag('event', 'after_refusal_' + i);
  assert.equal(win.dataLayer.length, 0, 'gtag must be inert after refusal');
});

// ── THE BOUND ───────────────────────────────────────────────────────────────

test('bound: the 51st queued event is dropped', () => {
  const win = loadStub();
  assert.equal(win.FMBGtag.QUEUE_LIMIT, 50, 'limit should be 50');

  for (let i = 1; i <= 51; i++) win.gtag('event', 'e' + i);

  assert.equal(win.dataLayer.length, 50, 'queue must stop at the limit');
  assert.equal(win.FMBGtag.state.dropped, 1, 'exactly one event should be recorded as dropped');

  const names = readable(win.dataLayer).map((a) => a[1]);
  assert.equal(names[0], 'e1', 'the FIRST event must be kept');
  assert.equal(names[49], 'e50', 'the 50th must be kept');
  assert.ok(!names.includes('e51'), 'the 51st must be the one dropped, not an earlier event');
});

test('bound: dropping does not corrupt the replay of the first fifty', () => {
  const win = loadStub();
  for (let i = 1; i <= 60; i++) win.gtag('event', 'e' + i);
  assert.equal(win.FMBGtag.state.dropped, 10);

  win.FMBGtag.resolve(true, fakeLoadAnalytics(win));

  const sent = readable(win.dataLayer);
  assert.deepEqual(sent[0], ['js', 'DATE'], 'js must come first');
  assert.deepEqual(sent[1], ['config', 'G-TEST', { anonymize_ip: true }], 'config must come second');

  const replayed = sent.slice(2).map((a) => a[1]);
  assert.equal(replayed.length, 50, 'all fifty survivors must replay');
  assert.deepEqual(replayed, Array.from({ length: 50 }, (_, i) => 'e' + (i + 1)),
    'survivors must replay complete and in original order');
});

test('bound: the cap is lifted once consent is granted', () => {
  const win = loadStub();
  win.FMBGtag.resolve(true, fakeLoadAnalytics(win));

  // gtag.js keeps pushing to dataLayer for the life of the page. A cap still in
  // force here would silently stop analytics mid-session.
  for (let i = 0; i < 500; i++) win.gtag('event', 'post_consent_' + i);

  assert.equal(win.dataLayer.length, 502, 'js + config + 500 events, uncapped');
  assert.equal(win.FMBGtag.state.dropped, 0, 'nothing should be dropped after consent');
});

// ── THE REPLAY ──────────────────────────────────────────────────────────────

test('replay: queued events survive a grant, ordered after js and config', () => {
  const win = loadStub();
  win.gtag('event', 'view_item', { item_id: '110955' });
  win.gtag('event', 'search', { search_term: 'abib' });

  win.FMBGtag.resolve(true, fakeLoadAnalytics(win));

  const sent = readable(win.dataLayer);
  assert.deepEqual(sent[0], ['js', 'DATE']);
  assert.deepEqual(sent[1], ['config', 'G-TEST', { anonymize_ip: true }]);
  assert.deepEqual(sent[2], ['event', 'view_item', { item_id: '110955' }]);
  assert.deepEqual(sent[3], ['event', 'search', { search_term: 'abib' }]);
});

test('replay: a second grant does not replay the queue twice', () => {
  const win = loadStub();
  win.gtag('event', 'view_item', { item_id: 'once' });

  win.FMBGtag.resolve(true, fakeLoadAnalytics(win));
  const after_first = win.dataLayer.length;

  // Opening Cookie Settings and saving again with analytics still on.
  win.FMBGtag.resolve(true, fakeLoadAnalytics(win));

  assert.equal(win.dataLayer.length, after_first, 'a repeat grant must be a no-op');
  const occurrences = readable(win.dataLayer).filter((a) => a[2] && a[2].item_id === 'once').length;
  assert.equal(occurrences, 1, 'the event must appear exactly once');
});

test('replay: granting with an empty queue still configures analytics', () => {
  const win = loadStub();
  win.FMBGtag.resolve(true, fakeLoadAnalytics(win));
  assert.deepEqual(readable(win.dataLayer), [
    ['js', 'DATE'],
    ['config', 'G-TEST', { anonymize_ip: true }],
  ]);
});

test('stub: defines gtag and dataLayer and transmits nothing on its own', () => {
  const win = loadStub();
  assert.equal(typeof win.gtag, 'function', 'gtag must exist immediately');
  assert.ok(Array.isArray(win.dataLayer), 'dataLayer must exist immediately');
  assert.equal(win.dataLayer.length, 0, 'loading the stub must not push anything');
  assert.equal(win.FMBGtag.state.resolved, false, 'consent must start unresolved');
});

test('inlining: the source contains no literal closing-script sequence', () => {
  // app/layout.tsx inlines this file into the server-rendered HTML. An HTML
  // parser ends a script element at the first such sequence regardless of
  // JavaScript context, including inside a comment, so one here would truncate
  // the inlined block part-way and leave window.gtag undefined.
  //
  // This shipped once, on 29 July: the file's own header comment documented the
  // static-page script tag literally, the inline block was cut before
  // `window.gtag = pusher` was reached, and nothing failed. Caught only by
  // reading the emitted HTML byte offsets.
  //
  // layout.tsx escapes defensively too. This test is the backstop for someone
  // removing that escape as redundant, which it would look like.
  const matches = STUB.match(/<\/script/gi) || [];
  assert.equal(
    matches.length,
    0,
    'the source must not contain a literal closing-script sequence, not even in a comment',
  );
});

test('stub: an existing dataLayer is preserved, not replaced', () => {
  const win = { dataLayer: [['event', 'pre_existing']] };
  runInNewContext(STUB, { window: win });
  assert.equal(win.dataLayer.length, 1, 'the stub must not discard an existing dataLayer');
});

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}\n`);
process.exit(failures === 0 ? 0 : 1);
