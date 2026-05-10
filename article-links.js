#!/usr/bin/env node
/**
 * FindMyBasket article internal-linking script.
 *
 * Run from repo root: node article-links.js
 *
 * For each article in public/articles/, finds the FIRST mention of a
 * known brand in body text and wraps it in <a href="/brands/...">.
 *
 * Conservative rules:
 *  - One link per brand per article
 *  - Skip mentions already inside <a> tags
 *  - Skip mentions inside <script>, <title>, <meta>, <h1>-<h3>
 *  - Skip mentions inside HTML attributes
 *  - Word-boundary matching: char before/after must not be alphanumeric
 *
 * Logs each link added or skipped.
 */

const fs = require('fs');
const path = require('path');

const ARTICLES_DIR = path.join(__dirname, 'public', 'articles');

const BRAND_MAP = [
  { slug: 'cerave', variants: ['CeraVe', 'Cerave'] },
  { slug: 'the-ordinary', variants: ['The Ordinary'] },
  { slug: 'clarins', variants: ['Clarins'] },
  { slug: 'elemis', variants: ['Elemis', 'ELEMIS'] },
  { slug: 'cosrx', variants: ['CosRx', 'COSRX', 'Cosrx'] },
  { slug: 'la-roche-posay', variants: ['La Roche-Posay', 'La Roche Posay'] },
  { slug: 'eucerin', variants: ['Eucerin'] },
  { slug: 'paula-s-choice', variants: ["Paula's Choice", 'Paulas Choice'] },
  { slug: 'beauty-of-joseon', variants: ['Beauty of Joseon'] },
  { slug: 'medik8', variants: ['Medik8'] },
  { slug: 'no7', variants: ['No7', 'NO7'] },
  { slug: 'olay', variants: ['Olay'] },
  { slug: 'l-oreal-paris', variants: ["L'Oréal Paris", "L'Oreal Paris"] },
  { slug: 'shiseido', variants: ['Shiseido'] },
  { slug: 'laneige', variants: ['LANEIGE', 'Laneige'] },
  { slug: 'innisfree', variants: ['Innisfree'] },
  { slug: 'missha', variants: ['MISSHA', 'Missha'] },
  { slug: 'klairs', variants: ['Klairs'] },
  { slug: 'tirtir', variants: ['TirTir', 'Tirtir', 'TIRTIR'] },
];

let totalLinksAdded = 0;

// Build a list of "excluded regions" - char index ranges where matches should
// not occur because they're inside <a>, <script>, <title>, <meta>, <h1>-<h3>,
// or any HTML tag (attributes).
function findExcludedRegions(html) {
  const regions = [];

  // Pattern: any open tag, attributes, etc. - mask all <...>
  let match;
  const tagRe = /<[^>]+>/g;
  while ((match = tagRe.exec(html)) !== null) {
    regions.push([match.index, match.index + match[0].length]);
  }

  // Pattern: <a>...</a>, <script>...</script>, <title>...</title>,
  // <h1>...</h1>, <h2>...</h2>, <h3>...</h3> - mask the contents too.
  const blockRes = [
    /<a\b[^>]*>[\s\S]*?<\/a>/gi,
    /<script\b[^>]*>[\s\S]*?<\/script>/gi,
    /<title\b[^>]*>[\s\S]*?<\/title>/gi,
    /<h[123]\b[^>]*>[\s\S]*?<\/h[123]>/gi,
  ];

  for (const re of blockRes) {
    while ((match = re.exec(html)) !== null) {
      regions.push([match.index, match.index + match[0].length]);
    }
  }

  return regions;
}

function indexInRegions(idx, regions) {
  for (const [start, end] of regions) {
    if (idx >= start && idx < end) return true;
  }
  return false;
}

function processFile(filepath) {
  const slug = path.basename(filepath, '.html');
  let content = fs.readFileSync(filepath, 'utf8');
  const original = content;

  console.log(`\n--- ${slug} ---`);

  // For each brand, find the first valid mention and wrap with <a>
  // We process brands one at a time so we can re-compute excluded regions
  // after each addition (the new <a> we added becomes excluded).
  for (const brand of BRAND_MAP) {
    const excluded = findExcludedRegions(content);
    let bestIdx = -1;
    let bestVariant = null;

    for (const variant of brand.variants) {
      let searchFrom = 0;
      while (searchFrom < content.length) {
        const idx = content.indexOf(variant, searchFrom);
        if (idx === -1) break;

        // Word boundary check
        const before = idx > 0 ? content[idx - 1] : ' ';
        const after = content[idx + variant.length] ?? ' ';
        if (/[a-zA-Z0-9]/.test(before)) {
          searchFrom = idx + 1;
          continue;
        }
        if (/[a-zA-Z0-9]/.test(after)) {
          searchFrom = idx + 1;
          continue;
        }

        // Skip if inside excluded region
        if (indexInRegions(idx, excluded)) {
          searchFrom = idx + variant.length;
          continue;
        }

        // First valid match for this variant
        if (bestIdx === -1 || idx < bestIdx) {
          bestIdx = idx;
          bestVariant = variant;
        }
        break; // Found the earliest match for this variant
      }
    }

    if (bestIdx !== -1 && bestVariant) {
      const link = `<a href="/brands/${brand.slug}">${bestVariant}</a>`;
      content =
        content.substring(0, bestIdx) +
        link +
        content.substring(bestIdx + bestVariant.length);
      console.log(`  + Linked "${bestVariant}" -> /brands/${brand.slug}`);
      totalLinksAdded++;
    }
  }

  if (content !== original) {
    fs.writeFileSync(filepath, content);
    console.log(`  WROTE`);
  } else {
    console.log(`  No changes`);
  }
}

console.log('=== Article internal linking ===');

if (!fs.existsSync(ARTICLES_DIR)) {
  console.error(`ERROR: ${ARTICLES_DIR} does not exist`);
  process.exit(1);
}

const articleFiles = fs.readdirSync(ARTICLES_DIR)
  .filter(f => f.endsWith('.html'))
  .sort();

for (const file of articleFiles) {
  processFile(path.join(ARTICLES_DIR, file));
}

console.log(`\n=== Done ===`);
console.log(`Links added: ${totalLinksAdded}`);
console.log(`\nReview with: git diff public/articles/`);
console.log(`Restore with: git restore public/articles/`);
