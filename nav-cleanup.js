#!/usr/bin/env node
/**
 * FindMyBasket nav unification + cleanup script.
 *
 * Run from repo root: node nav-cleanup.js
 *
 * Does:
 * 1. Rewrites <nav>...</nav> in HTML files to a unified version
 * 2. Rewrites #mobileMenu div similarly
 * 3. Updates editorial /product-finder.html references in articles
 *    to the relevant brand page
 * 4. Deletes 6 root-level duplicate article files
 * 5. Deletes /public/product-finder.html
 *
 * Logs each change.
 */

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');
const ARTICLES_DIR = path.join(PUBLIC_DIR, 'articles');

// Article slug -> brand page or category page mapping
const ARTICLE_BRAND_MAP = {
  'elemis-best-price-uk': '/brands/elemis',
  'the-ordinary-cheapest-uk': '/brands/the-ordinary',
  'cerave-cheapest-uk': '/brands/cerave',
  'clarins-best-price-uk': '/brands/clarins',
  'cosrx-best-price-uk': '/brands/cosrx',
  'k-beauty-uk-best-prices': '/edit/k-beauty',
  'skincare-routine-under-40': '/skincare',
  'lookfantastic-vs-boots': '/skincare',
  'overpaying-for-skincare': '/skincare',
};

// Files that get their root-level duplicate deleted
const DUPLICATES_TO_DELETE = [
  'cosrx-best-price-uk.html',
  'elemis-best-price-uk.html',
  'the-ordinary-cheapest-uk.html',
  'lookfantastic-vs-boots.html',
  'overpaying-for-skincare.html',
  'skincare-routine-under-40.html',
];

const PRODUCT_FINDER_FILE = 'product-finder.html';

const NEW_DESKTOP_NAV_LINKS = `    <div class="nav-links">
      <a href="/skincare">Skincare</a>
      <a href="/makeup">Makeup</a>
      <a href="/hair">Hair</a>
      <a href="/edit/k-beauty">K-Beauty</a>
      <a href="/savings-hub.html">Savings Hub</a>
      <a href="/about.html">About</a>
      <a href="/app.html" class="nav-cta">Build a routine</a>
    </div>`;

const NEW_MOBILE_MENU = `  <div class="mobile-menu" id="mobileMenu">
    <a href="/skincare">Skincare</a>
    <a href="/makeup">Makeup</a>
    <a href="/hair">Hair</a>
    <a href="/edit/k-beauty">K-Beauty</a>
    <a href="/savings-hub.html">Savings Hub</a>
    <a href="/about.html">About</a>
    <a href="/app.html">Build a routine</a>
  </div>`;

let totalChanges = 0;

function rewriteHtmlFile(filepath, articleSlug) {
  if (!fs.existsSync(filepath)) {
    console.log(`SKIP (missing): ${filepath}`);
    return;
  }

  let content = fs.readFileSync(filepath, 'utf8');
  const original = content;

  // 1. Replace <div class="nav-links">...</div> within <nav>...</nav>
  // The pattern matches the nav-links block. We preserve everything else
  // in the nav (logo, hamburger).
  const navLinksPattern = /<div class="nav-links">[\s\S]*?<\/div>/;
  if (navLinksPattern.test(content)) {
    content = content.replace(navLinksPattern, NEW_DESKTOP_NAV_LINKS.trim());
  }

  // 2. Replace the mobile menu div
  const mobileMenuPattern = /<div class="mobile-menu" id="mobileMenu">[\s\S]*?<\/div>/;
  if (mobileMenuPattern.test(content)) {
    content = content.replace(mobileMenuPattern, NEW_MOBILE_MENU.trim());
  }

  // 3. If this is an article, rewrite editorial product-finder.html links
  if (articleSlug && ARTICLE_BRAND_MAP[articleSlug]) {
    const target = ARTICLE_BRAND_MAP[articleSlug];
    // Match /product-finder.html with optional query string
    const pfPattern = /\/product-finder\.html(\?[^"'\s]*)?/g;
    content = content.replace(pfPattern, target);
  }

  if (content !== original) {
    fs.writeFileSync(filepath, content);
    console.log(`UPDATED: ${path.relative(process.cwd(), filepath)}`);
    totalChanges++;
  } else {
    console.log(`UNCHANGED: ${path.relative(process.cwd(), filepath)}`);
  }
}

console.log('=== Step 1: Rewriting navs in all HTML files ===\n');

// Root-level public/*.html files
const rootFiles = fs.readdirSync(PUBLIC_DIR)
  .filter(f => f.endsWith('.html'))
  .filter(f => f !== PRODUCT_FINDER_FILE) // Don't touch this; we delete it
  .filter(f => !DUPLICATES_TO_DELETE.includes(f)); // Don't touch dupes; we delete them

for (const file of rootFiles) {
  rewriteHtmlFile(path.join(PUBLIC_DIR, file), null);
}

// Articles
if (fs.existsSync(ARTICLES_DIR)) {
  const articleFiles = fs.readdirSync(ARTICLES_DIR).filter(f => f.endsWith('.html'));
  for (const file of articleFiles) {
    const slug = file.replace(/\.html$/, '');
    rewriteHtmlFile(path.join(ARTICLES_DIR, file), slug);
  }
}

console.log(`\nUpdated ${totalChanges} HTML files.\n`);

console.log('=== Step 2: Deleting duplicate root-level articles ===\n');
let deletedCount = 0;
for (const dup of DUPLICATES_TO_DELETE) {
  const fp = path.join(PUBLIC_DIR, dup);
  if (fs.existsSync(fp)) {
    fs.unlinkSync(fp);
    console.log(`DELETED: public/${dup}`);
    deletedCount++;
  } else {
    console.log(`SKIP (missing): public/${dup}`);
  }
}

console.log(`\nDeleted ${deletedCount} duplicate files.\n`);

console.log('=== Step 3: Deleting product-finder.html ===\n');
const pfPath = path.join(PUBLIC_DIR, PRODUCT_FINDER_FILE);
if (fs.existsSync(pfPath)) {
  fs.unlinkSync(pfPath);
  console.log(`DELETED: public/${PRODUCT_FINDER_FILE}`);
} else {
  console.log(`SKIP (missing): public/${PRODUCT_FINDER_FILE}`);
}

console.log('\n=== Done ===');
console.log('Review changes with: git diff');
console.log('If something looks wrong, restore with: git restore public/');
