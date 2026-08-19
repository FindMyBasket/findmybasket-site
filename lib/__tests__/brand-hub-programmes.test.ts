import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMerchantIds, findClosedProgrammeLinks } from '../brand-hub-programmes.ts';

const AWIN = (mid: string) =>
  `https://www.awin1.com/cread.php?awinmid=${mid}&amp;awinaffid=2841268&amp;ued=https%3A%2F%2Fx.com%2F`;

test('extracts merchant ids from the editorial body', () => {
  const refs = extractMerchantIds({ slug: 'abib-spotlight', body_html: `<a href="${AWIN('122652')}">x</a>` });
  assert.deepEqual(refs, [{ slug: 'abib-spotlight', merchantId: '122652', source: 'body' }]);
});

/** iLAPOTHECARY has an EMPTY body and its only link in offer.cta_url. A check reading one field
 *  would have covered exactly one of the two hubs it exists for. */
test('extracts merchant ids from the offer CTA when the body is empty', () => {
  const refs = extractMerchantIds({
    slug: 'ilapothecary', body_html: '',
    offer: { code: 'FMB15', cta_url: AWIN('125272') },
  });
  assert.equal(refs.length, 1);
  assert.equal(refs[0].merchantId, '125272');
  assert.equal(refs[0].source, 'offer');
});

test('the same merchant linked five times in a body yields one ref', () => {
  const body = Array.from({ length: 5 }, () => `<a href="${AWIN('122652')}">x</a>`).join(' ');
  assert.equal(extractMerchantIds({ slug: 's', body_html: body }).length, 1);
});

test('a hub with no outbound merchant links yields nothing', () => {
  const refs = extractMerchantIds({ slug: 's', body_html: '<a href="/brands/abib">Compare</a>', offer: null });
  assert.deepEqual(refs, []);
});

/**
 * THE CASE THIS CHECK EXISTS FOR, WHICH LIVE DATA CAN NO LONGER DEMONSTRATE.
 * Abib's five links were removed on 19 August before the check was built, so the only way to
 * prove it would have caught them is a synthetic hub in the shape the page actually had.
 */
test('CATCHES the Abib case: a hub linking to a merchant no longer joined', () => {
  const refs = extractMerchantIds({ slug: 'abib-spotlight', body_html: `<a href="${AWIN('122652')}">Shop at Abib</a>` });
  const joined = new Set(['125272', '15448']);          // 122652 absent — programme closed
  const findings = findClosedProgrammeLinks(refs, joined);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].key, 'hub:abib-spotlight:mid:122652');
  assert.match(findings[0].summary, /no longer a joined programme/);
});

test('a still-joined merchant is not a finding', () => {
  const refs = extractMerchantIds({ slug: 'ilapothecary', body_html: '', offer: { cta_url: AWIN('125272') } });
  assert.deepEqual(findClosedProgrammeLinks(refs, new Set(['125272'])), []);
});

/** The key must be stable across runs or report_count never rises and the escalation is
 *  silently disabled while appearing to work — item 194's own failure mode. */
test('finding_key is stable across runs and carries no measured value', () => {
  const refs = extractMerchantIds({ slug: 'abib-spotlight', body_html: `<a href="${AWIN('122652')}">x</a>` });
  const a = findClosedProgrammeLinks(refs, new Set())[0].key;
  const b = findClosedProgrammeLinks(refs, new Set())[0].key;
  assert.equal(a, b);
  assert.doesNotMatch(a, /\d{4}-\d{2}-\d{2}|count|=/);
});

test('one merchant linked from two hubs is two findings, keyed separately', () => {
  const refs = [
    ...extractMerchantIds({ slug: 'a', body_html: `<a href="${AWIN('999')}">x</a>` }),
    ...extractMerchantIds({ slug: 'b', body_html: `<a href="${AWIN('999')}">x</a>` }),
  ];
  const f = findClosedProgrammeLinks(refs, new Set());
  assert.equal(f.length, 2);
  assert.deepEqual(f.map((x) => x.key).sort(), ['hub:a:mid:999', 'hub:b:mid:999']);
});
