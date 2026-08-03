/**
 * House-rule guard for EMAIL COPY.
 *
 * WHY THIS EXISTS. The no-em-dash rule has been enforced on the site and in docs for
 * a fortnight. Email templates were never checked once, and on 3 August 2026 a sweep
 * found four em dashes in customer-facing copy including TWO SUBJECT LINES that had
 * been shipping to subscribers since the feature launched.
 *
 * An email is the one artefact that lands in someone's inbox. It is the least visible
 * surface to audit and the most visible to the recipient, which is exactly the
 * combination that lets a rule rot unnoticed. A grep run once fixes today; this fixes
 * the next time.
 *
 * SCOPE. String and template literals only, with comments stripped: a rule about copy
 * should not fail on a code comment. Operator-facing strings pushed into `errors` are
 * exempt and named as such, because they go to a log, not a subscriber.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** Files that render copy a CUSTOMER will read. Not operator alert emails. */
const CUSTOMER_EMAIL_TEMPLATES = [
  'supabase/functions/send-routine-email/index.ts',
];

/** Characters the house rule bans from copy, with the reason attached. */
const BANNED = [
  { ch: '—', name: 'em dash' },
  { ch: '–', name: 'en dash' },
];

/**
 * Remove a trailing // comment, but only when the // is OUTSIDE a string. A naive
 * regex eats `https://` and, worse, leaves real comments in place on lines that also
 * carry a string literal, which is exactly the false positive this guard hit first.
 */
function stripTrailingComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c;
    } else if (c === '/' && line[i + 1] === '/') {
      return line.slice(0, i);
    }
  }
  return line;
}

function copyLines(src: string): { line: number; text: string }[] {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')); // keep line numbers
  const out: { line: number; text: string }[] = [];
  s.split('\n').forEach((l, i) => {
    const stripped = stripTrailingComment(l).replace(/^\s*\/\/.*$/, '');
    if (!stripped.trim()) return;
    // Operator-facing: goes to a log or an API response, never to a subscriber.
    if (/errors\.push\(/.test(stripped)) return;
    // Only lines that actually contain a string or template literal carry copy.
    if (!/["'`]/.test(stripped)) return;
    out.push({ line: i + 1, text: stripped });
  });
  return out;
}

for (const file of CUSTOMER_EMAIL_TEMPLATES) {
  for (const { ch, name } of BANNED) {
    test(`${file} contains no ${name} in customer copy`, () => {
      const offenders = copyLines(readFileSync(file, 'utf8')).filter((l) => l.text.includes(ch));
      assert.deepEqual(
        offenders.map((o) => `L${o.line}: ${o.text.trim().slice(0, 100)}`),
        [],
        `${name} found in customer-facing email copy. House rule: no em dashes.\n` +
        `This is the artefact that lands in an inbox; it is the last place the rule should slip.`,
      );
    });
  }

  test(`${file} uses "multiple UK retailers", never a whole-market claim`, () => {
    // Same claim rule as the site (convention 12). Email copy was never swept for it.
    const src = readFileSync(file, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const bad = code.match(/the UK'?s (major|leading|top|biggest)[^<."'`]*|all major UK[^<."'`]*|every UK [^<."'`]*/gi) ?? [];
    assert.deepEqual(bad, [], 'whole-market coverage claim in email copy');
  });
}
