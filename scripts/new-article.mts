/**
 * Savings Hub article generator.
 *
 * Publishes one or more articles in a single pass, eliminating the hand-copy
 * errors: slug mismatch (canonical / og:url / JSON-LD url out of sync), a
 * missing sitemap line, a forgotten card, a left-in {{PLACEHOLDER}}, or a
 * stray `noindex`. It fills docs/article-template.html (the single SEO source
 * of truth), then wires the card into public/savings-hub.html and the entry
 * into app/sitemap-pages.xml/route.ts.
 *
 * KNOWN TRADE-OFF (accepted): articles are copied static files, so a future
 * change to the SEO baseline (new meta tag, schema field, etc.) means editing
 * docs/article-template.html AND re-running this script over each article, OR
 * editing each published file. There is no live template inheritance. Fine for
 * now; do not re-architect into a DB/MDX route without a deliberate decision.
 *
 * Run:  npx tsx scripts/new-article.mts <spec.json> [--dry] [--force]
 *
 *   <spec.json>  a single spec object, or an array of them (batch).
 *   --dry        validate + print planned actions, write nothing.
 *   --force      overwrite an existing public/articles/<slug>.html.
 *   --top        insert new hub cards at the TOP of .hub-grid (newest-first).
 *                Default is append (end of grid). Batch specs are inserted as
 *                one ordered block, so array order is preserved either way
 *                (with --top the whole block sits above the existing cards).
 *
 * Spec shape (see SpecSchema notes below):
 * {
 *   "slug": "beauty-of-joseon-vs-cosrx-uk",
 *   "title": "Beauty of Joseon vs COSRX, Which K-Beauty Brand Is Better Value in the UK?",
 *   "metaDescription": "We compared ... in 2026.",
 *   "keywords": "Beauty of Joseon vs COSRX, K-beauty best value UK",
 *   "ogDescription": "optional, defaults to metaDescription",
 *   "datePublished": "2026-07-02",
 *   "dateModified": "2026-07-02 (optional, defaults to datePublished)",
 *   "categoryLabel": "Retailer Guide · K-Beauty",
 *   "brandSlug": "beauty-of-joseon (optional; drives the article-tag brand link)",
 *   "brandName": "Beauty of Joseon (optional; required if brandSlug set)",
 *   "h1": "optional, defaults to title",
 *   "updatedLabel": "optional, e.g. 'July 2026'; derived from datePublished if omitted",
 *   "readMins": 5,
 *   "bodyHtml": "<p>...</p> ... inner HTML of .article-body; disclosure auto-appended if absent",
 *   "card": { "emoji": "🐌", "bg": "#D4E8C8", "category": "Retailer Guide · K-Beauty", "title": "optional, defaults to h1/title", "excerpt": "one-sentence card excerpt" },
 *   "sitemapPriority": 0.7,
 *   "sitemapChangefreq": "monthly"
 * }
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ROOT = process.cwd();
const TEMPLATE = `${ROOT}/docs/article-template.html`;
const HUB = `${ROOT}/public/savings-hub.html`;
const SITEMAP = `${ROOT}/app/sitemap-pages.xml/route.ts`;
const ARTICLES_DIR = `${ROOT}/public/articles`;

const DISCLOSURE =
  '<p class="disclosure">Prices vary across retailers and change regularly. Use FindMyBasket for live prices. FindMyBasket may earn a small commission when you shop through our links, at no extra cost to you.</p>';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type Card = {
  emoji: string;
  bg: string;
  category: string;
  title?: string;
  excerpt: string;
};

type Spec = {
  slug: string;
  title: string;
  metaDescription: string;
  keywords: string;
  ogDescription?: string;
  datePublished: string;
  dateModified?: string;
  categoryLabel: string;
  brandSlug?: string;
  brandName?: string;
  h1?: string;
  updatedLabel?: string;
  readMins?: number;
  bodyHtml?: string;
  bodyHtmlFile?: string; // path to a raw .html fragment; used if bodyHtml is absent
  card: Card;
  sitemapPriority?: number;
  sitemapChangefreq?: string;
};

// ---- helpers ---------------------------------------------------------------

/** Fields that land in BOTH an HTML attribute and a JSON-LD string. Keeping
 *  them free of ", <, >, & sidesteps dual-context escaping entirely. */
function assertPlain(field: string, value: string, errs: string[], slug: string) {
  const bad = /["<>&]/.exec(value);
  if (bad) {
    errs.push(
      `[${slug}] ${field} contains "${bad[0]}" — remove it (rephrase, or use "and" for &). ` +
        `These fields are used raw in HTML attributes and JSON-LD.`,
    );
  }
}

/** Escape for HTML *text* content (card fields). */
function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function isDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function derivedUpdatedLabel(datePublished: string): string {
  const [y, m] = datePublished.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

// ---- template fill ---------------------------------------------------------

function loadTemplate(): string {
  if (!existsSync(TEMPLATE)) {
    throw new Error(`Template not found at ${TEMPLATE}`);
  }
  return readFileSync(TEMPLATE, 'utf8');
}

function buildArticle(tpl: string, spec: Spec, errs: string[]): string {
  const slug = spec.slug;

  // 1. Strip the template-only instruction banner (between doctype and <html>)
  //    and the noindex guard (its warning comment + the meta tag).
  let html = tpl.replace(/<!DOCTYPE html>\n[\s\S]*?<html lang="en">/, '<!DOCTYPE html>\n<html lang="en">');
  html = html
    .split('\n')
    .filter(
      line =>
        !/name="robots"\s+content="noindex"/.test(line) &&
        !/DELETE THE NEXT LINE WHEN YOU COPY/.test(line),
    )
    .join('\n');

  // 2. Fill <head> tokens (each may appear in several places -> replace all).
  const ogDesc = spec.ogDescription ?? spec.metaDescription;
  const dateMod = spec.dateModified ?? spec.datePublished;
  const headTokens: Record<string, string> = {
    '{{TITLE}}': spec.title,
    '{{META_DESCRIPTION}}': spec.metaDescription,
    '{{OG_DESCRIPTION}}': ogDesc,
    '{{KEYWORDS}}': spec.keywords,
    '{{SLUG}}': slug,
    '{{DATE_PUBLISHED}}': spec.datePublished,
    '{{DATE_MODIFIED}}': dateMod,
  };
  for (const [token, value] of Object.entries(headTokens)) {
    html = html.split(token).join(value);
  }

  // 3. Rebuild the whole <div class="article-wrap"> ... region from the spec,
  //    leaving nav (above) and footer (below) untouched.
  const h1 = spec.h1 ?? spec.title;
  const updated = spec.updatedLabel ?? derivedUpdatedLabel(spec.datePublished);
  const readMins = spec.readMins ?? 5;
  const tag =
    spec.brandSlug && spec.brandName
      ? `${spec.categoryLabel} · <a href="/brands/${spec.brandSlug}">${spec.brandName}</a>`
      : spec.categoryLabel;

  let body = (spec.bodyHtml ?? readFileSync(spec.bodyHtmlFile as string, 'utf8')).trim();
  if (!/class="disclosure"/.test(body)) {
    body += `\n\n    ${DISCLOSURE}`;
  }

  const articleWrap =
    `<div class="article-wrap">\n` +
    `  <p class="article-tag">${tag}</p>\n` +
    `  <h1 class="article-title">${h1}</h1>\n` +
    `  <div class="article-meta">By FindMyBasket &nbsp;·&nbsp; Updated ${updated} &nbsp;·&nbsp; ${readMins} min read</div>\n` +
    `  <div class="article-body">\n\n    ${body}\n\n  </div>\n` +
    `</div>\n`;

  html = html.replace(
    /<div class="article-wrap">[\s\S]*?(?=<!-- ===== Unified site footer \(canonical\) ===== -->)/,
    articleWrap,
  );

  // 4. Safety gates.
  const leftover = html.match(/\{\{[A-Z_]+\}\}/g);
  if (leftover) {
    errs.push(`[${slug}] unfilled placeholders remain: ${[...new Set(leftover)].join(', ')}`);
  }
  if (/name="robots"\s+content="noindex"/.test(html)) {
    errs.push(`[${slug}] noindex survived into output — refusing to publish a non-indexable article`);
  }
  // House copy rules ([[copy-standing-rules]]): no em dashes, never cheapest/cheaper.
  if (html.includes('—')) {
    errs.push(`[${slug}] contains an em dash (—). House style forbids it; use commas or restructure.`);
  }
  const cheap = /\bcheape(st|r)\b/i.exec(html);
  if (cheap) {
    errs.push(`[${slug}] contains "${cheap[0]}". House style forbids "cheapest"/"cheaper"; use "best value"/"best price".`);
  }

  return html;
}

// ---- hub card + sitemap (operate on in-memory strings; write once) ---------

function buildCard(spec: Spec): string {
  const href = `/articles/${spec.slug}.html`;
  const c = spec.card;
  const cardTitle = escText(c.title ?? spec.h1 ?? spec.title);
  return (
    `      <article class="article-card reveal" style="animation-delay:0.08s" onclick="window.location='${href}'">\n` +
    `        <div class="card-image" style="background:${c.bg}">\n` +
    `          <span class="card-emoji">${c.emoji}</span>\n` +
    `          <span class="card-category">${escText(c.category)}</span>\n` +
    `        </div>\n` +
    `        <div class="card-body">\n` +
    `          <h2 class="card-title">${cardTitle}</h2>\n` +
    `          <p class="card-excerpt">${escText(c.excerpt)}</p>\n` +
    `          <span class="card-link">Read guide →</span>\n` +
    `        </div>\n` +
    `      </article>\n`
  );
}

/** Insert all not-yet-present cards as one ordered block, at top or bottom of
 *  .hub-grid. Array order is preserved regardless of position. */
function insertCards(hub: string, specs: Spec[], top: boolean, errs: string[]): string {
  const cards: string[] = [];
  for (const spec of specs) {
    if (hub.includes(`/articles/${spec.slug}.html`)) {
      console.log(`  • card already present for ${spec.slug} — skipping card insert`);
      continue;
    }
    cards.push(buildCard(spec));
  }
  if (cards.length === 0) return hub;
  const block = cards.join('');

  if (top) {
    const open = '<div class="hub-grid">\n';
    if (!hub.includes(open)) {
      errs.push(`[hub] could not locate the .hub-grid open marker in ${HUB}`);
      return hub;
    }
    return hub.replace(open, `${open}${block}`);
  }
  const close = '\n</div>\n  <div class="hub-cta">';
  if (!hub.includes(close)) {
    errs.push(`[hub] could not locate the .hub-grid close marker in ${HUB}`);
    return hub;
  }
  return hub.replace(close, `\n${block}</div>\n  <div class="hub-cta">`);
}

function insertSitemap(sitemap: string, spec: Spec, errs: string[]): string {
  const loc = `/articles/${spec.slug}.html`;
  if (sitemap.includes(loc)) {
    console.log(`  • sitemap already has ${spec.slug} — skipping sitemap insert`);
    return sitemap;
  }
  const priority = spec.sitemapPriority ?? 0.7;
  const changefreq = spec.sitemapChangefreq ?? 'monthly';
  const line = `  { loc: '${loc}', changefreq: '${changefreq}', priority: ${priority} },`;

  const lines = sitemap.split('\n');
  let lastIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/loc: '\/articles\//.test(lines[i])) lastIdx = i;
  }
  if (lastIdx === -1) {
    errs.push(`[${spec.slug}] could not find an existing /articles/ sitemap entry to anchor to in ${SITEMAP}`);
    return sitemap;
  }
  lines.splice(lastIdx + 1, 0, line);
  return lines.join('\n');
}

// ---- validation ------------------------------------------------------------

function validate(spec: Spec, errs: string[]) {
  const slug = spec.slug ?? '(missing slug)';
  const required: (keyof Spec)[] = [
    'slug', 'title', 'metaDescription', 'keywords', 'datePublished', 'categoryLabel', 'card',
  ];
  for (const f of required) {
    if (spec[f] == null || spec[f] === '') errs.push(`[${slug}] missing required field: ${f}`);
  }
  if (!spec.bodyHtml && !spec.bodyHtmlFile) {
    errs.push(`[${slug}] provide either bodyHtml or bodyHtmlFile`);
  } else if (!spec.bodyHtml && spec.bodyHtmlFile && !existsSync(spec.bodyHtmlFile)) {
    errs.push(`[${slug}] bodyHtmlFile not found: ${spec.bodyHtmlFile}`);
  }
  if (spec.card) {
    for (const f of ['emoji', 'bg', 'category', 'excerpt'] as const) {
      if (!spec.card[f]) errs.push(`[${slug}] missing required card.${f}`);
    }
  }
  if (spec.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(spec.slug)) {
    errs.push(`[${slug}] invalid slug — use lowercase kebab-case (a-z, 0-9, hyphens)`);
  }
  if (spec.datePublished && !isDate(spec.datePublished)) {
    errs.push(`[${slug}] datePublished must be YYYY-MM-DD`);
  }
  if (spec.dateModified && !isDate(spec.dateModified)) {
    errs.push(`[${slug}] dateModified must be YYYY-MM-DD`);
  }
  if (spec.brandSlug && !spec.brandName) {
    errs.push(`[${slug}] brandSlug set but brandName missing (both needed for the article-tag brand link)`);
  }
  // Dual-context fields must be attribute/JSON-safe.
  if (spec.title) assertPlain('title', spec.title, errs, slug);
  if (spec.metaDescription) assertPlain('metaDescription', spec.metaDescription, errs, slug);
  if (spec.ogDescription) assertPlain('ogDescription', spec.ogDescription, errs, slug);
  if (spec.keywords) assertPlain('keywords', spec.keywords, errs, slug);
}

// ---- main ------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry');
  const force = argv.includes('--force');
  const top = argv.includes('--top');
  const specPath = argv.find(a => !a.startsWith('--'));
  if (!specPath) {
    console.error('Usage: npx tsx scripts/new-article.mts <spec.json> [--dry] [--force]');
    process.exit(1);
  }
  if (!existsSync(specPath)) {
    console.error(`Spec file not found: ${specPath}`);
    process.exit(1);
  }

  const parsed = JSON.parse(readFileSync(specPath, 'utf8'));
  const specs: Spec[] = Array.isArray(parsed) ? parsed : [parsed];
  const tpl = loadTemplate();
  const errs: string[] = [];

  // Phase 1: validate everything up front (no writes until all pass).
  const seen = new Set<string>();
  for (const spec of specs) {
    validate(spec, errs);
    if (spec.slug) {
      if (seen.has(spec.slug)) errs.push(`[${spec.slug}] duplicate slug within this batch`);
      seen.add(spec.slug);
      const path = `${ARTICLES_DIR}/${spec.slug}.html`;
      if (existsSync(path) && !force) {
        errs.push(`[${spec.slug}] ${path} already exists (use --force to overwrite)`);
      }
    }
  }

  // Phase 2: build all article HTML (lints run here too).
  const built = errs.length === 0 ? specs.map(s => ({ spec: s, html: buildArticle(tpl, s, errs) })) : [];

  if (errs.length) {
    console.error(`\n✗ ${errs.length} problem(s) — nothing written:\n`);
    for (const e of errs) console.error('  ' + e);
    process.exit(1);
  }

  // Phase 3: apply card + sitemap inserts in memory, then write once.
  let hub = readFileSync(HUB, 'utf8');
  let sitemap = readFileSync(SITEMAP, 'utf8');
  const insertErrs: string[] = [];
  hub = insertCards(hub, built.map(b => b.spec), top, insertErrs);
  for (const { spec } of built) {
    sitemap = insertSitemap(sitemap, spec, insertErrs);
  }
  if (insertErrs.length) {
    console.error(`\n✗ insertion problem(s) — nothing written:\n`);
    for (const e of insertErrs) console.error('  ' + e);
    process.exit(1);
  }

  if (dry) {
    console.log('\n[--dry] Would write:');
    for (const { spec } of built) console.log(`  • public/articles/${spec.slug}.html  (+ hub card + sitemap line)`);
    console.log('\nNo files changed.');
    return;
  }

  for (const { spec, html } of built) {
    writeFileSync(`${ARTICLES_DIR}/${spec.slug}.html`, html);
    console.log(`  ✓ wrote public/articles/${spec.slug}.html`);
  }
  writeFileSync(HUB, hub);
  writeFileSync(SITEMAP, sitemap);
  console.log(`  ✓ updated public/savings-hub.html (cards)`);
  console.log(`  ✓ updated app/sitemap-pages.xml/route.ts (sitemap)`);
  console.log(`\n✓ Published ${built.length} article(s). Verify, then commit.`);
}

main();
