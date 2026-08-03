/**
 * Homepage demo generator. Runs at build time, before `next build`.
 *
 * WHY THIS EXISTS, and why the basket is NOT hardcoded.
 * ----------------------------------------------------------------------------
 * The old demo block was hand-written, point-in-time and refreshed by nothing.
 * Worse, every leg of it cleared its delivery threshold, so no scenario paid
 * delivery and the mechanism the site exists to demonstrate was invisible: the
 * demo satisfied the optimiser rather than demonstrating it.
 *
 * The baskets below DO demonstrate it. Each one is a basket where the
 * goods-optimal split and the delivery-optimal split are genuinely DIFFERENT
 * arrangements, so buying each item at its best price costs more delivered.
 * That property was proven to exist on 3 August 2026 (work-list item 12,
 * outcome "found easily").
 *
 * THE FROZEN-STATE RULE IS LOAD-BEARING HERE, NOT PROCEDURAL.
 * docs/standing-rule-frozen-catalogue-state.md forbids hardcoding prices,
 * retailer names and counts. Usually the cost of breaking that rule is staleness.
 * Here it is worse: these baskets turn on a leg sitting a few pounds either side
 * of a delivery threshold. A single price move flips which arrangement wins, so a
 * hardcoded version would display a "best" basket that is NO LONGER BEST. That is
 * strictly worse than the block it replaces, which was merely out of date. Stale
 * is survivable; wrong is not.
 *
 * TWO CAUTIONS FOR ANYONE TEMPTED TO SHORTCUT THIS BY PICKING A BASKET BY HAND.
 * Both are from the 3 August selection pass, both were caught only by re-solving:
 *
 *   Candidate B. A medicube trio, hand-picked, looked ideal: coherent brand,
 *   good prices, an obvious cheaper-elsewhere item. Re-solved exhaustively it
 *   returned a gap of EXACTLY £0.00 — goods-optimal and delivery-optimal were the
 *   same arrangement. It demonstrated nothing. Nothing about it looked wrong.
 *
 *   Candidate F. A Beauty of Joseon routine assembled as a Beauty Bay basket,
 *   because all three items were a penny cheaper at Debenhams. Re-solving showed
 *   Stylevana undercuts Beauty Bay on all three, so THE ASSUMED HOST WAS NOT THE
 *   HOST and the real gap was a third of the expected one.
 *
 * Same lesson from two directions: you cannot tell by looking. Re-solve, always.
 *
 * KNOWN RISK: HOST CONCENTRATION. Three of the four candidates are hosted at
 * Stylevana. If its feed stalls or its prices move together, most of the shortlist
 * fails on the same build and the fallback fires. That is safe but means the demo
 * disappears rather than degrading. The shortlist is concentrated because the
 * obvious second host is unavailable: Beauty Flash to Gorgeous Shop is the
 * second-largest wedge pairing at 678 items, but Beauty Flash's `Moisturiser`
 * category returns hair cream, styling balm, hand cream and self-tan, so it cannot
 * source a basket that reads as a routine. That is work-list item 18, whose
 * priority was raised for this reason. A YesStyle-hosted fifth was searched for on
 * 3 August and not found within the timebox.
 *
 * FALLBACK. If no candidate demonstrates the mechanism, this writes copy WITHOUT
 * figures and prints a loud block to stderr. It never renders a basket it cannot
 * stand behind. Repeated firing is a catalogue finding, not a rendering detail.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'

const START = '<!-- FMB:DEMO:START -->'
const END = '<!-- FMB:DEMO:END -->'
const TARGET = 'public/index.html'

// Ordered: strongest first, then by HEADROOM rather than by gap. Headroom is the
// distance between the host leg and its delivery threshold, so it is what survives
// a price move; the gap is only what the reader sees. A leads on both.
const CANDIDATES = [
  { id: 'A', label: 'Torriden / SKIN1004 / Klairs', products: [5334, 93187, 126288] },
  { id: 'C', label: 'Arencia / Biodance', products: [2880, 1269, 1268] },
  { id: 'D', label: 'numbuzin / ongredients', products: [1656, 7710, 6254, 8640] },
  { id: 'F', label: 'Beauty of Joseon', products: [82517, 609, 16136] },
]


function deliveryFor(r, goods) {
  if (goods <= 0) return 0
  if (r.delivery_model === 'flat') return Number(r.delivery_cost)
  return goods >= Number(r.delivery_threshold) ? 0 : Number(r.delivery_cost)
}

/**
 * Exhaustive solve. Mirrors the live optimiser's ceiling of at most two retailers
 * (app/app/RoutineBuilder.tsx builds singleOptions + twoOptions and has no
 * three-retailer branch — work-list item 17). If that ceiling ever changes, this
 * must change with it or the demo will advertise an arrangement the app cannot
 * produce.
 */
function solve(products, offers, retailers) {
  const priceAt = (pid, rid) =>
    offers.find(o => o.product_id === pid && o.retailer_id === rid)?.price ?? null

  const all = []

  for (let i = 0; i < retailers.length; i++) {
    for (let j = i; j < retailers.length; j++) {
      const a = retailers[i], b = retailers[j]
      const assignment = new Map()
      let ga = 0, gb = 0, goods = 0, ok = true

      for (const pid of products) {
        const pa = priceAt(pid, a.id), pb = priceAt(pid, b.id)
        if (pa == null && pb == null) { ok = false; break }
        const useA = pb == null || (pa != null && Number(pa) <= Number(pb))
        const price = Number(useA ? pa : pb)
        assignment.set(pid, useA ? a : b)
        if (useA) ga += price; else gb += price
        goods += price
      }
      if (!ok) continue

      const delivered =
        ga + (ga > 0 ? deliveryFor(a, ga) : 0) +
        (a.id === b.id ? 0 : gb + (gb > 0 ? deliveryFor(b, gb) : 0))

      all.push({ retailers: [a, b], goods, delivered, assignment })
    }
  }
  if (!all.length) return null

  const byGoods = [...all].sort((x, y) => x.goods - y.goods || x.delivered - y.delivered)[0]
  const byDelivered = [...all].sort((x, y) => x.delivered - y.delivered || x.goods - y.goods)[0]

  const names = (a) =>
    [...new Set([...a.assignment.values()].map(r => r.name))].sort().join(' + ')

  return {
    goodsOptimal: byGoods, deliveryOptimal: byDelivered,
    differ: names(byGoods) !== names(byDelivered),
    gap: Number((byGoods.delivered - byDelivered.delivered).toFixed(2)),
    goodsOptimalName: names(byGoods), deliveryOptimalName: names(byDelivered),
  }
}

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const money = (n) => '£' + n.toFixed(2)

function renderDemo(products, solved, offers) {
  const best = solved.deliveryOptimal
  const worse = solved.goodsOptimal

  // Dots are decorative. The original block carried per-product gradients chosen by
  // hand; generated output cannot know a product's colour, so one neutral treatment is
  // used rather than inventing a palette per item.
  const items = products.map(p => `
          <div class="demo-product"><div class="demo-product-dot" style="background:linear-gradient(135deg,rgba(201,169,110,0.55),rgba(201,169,110,0.2))"></div><div class="demo-product-info"><div class="demo-product-name">${esc(p.name)}</div><div class="demo-product-brand">${esc(p.brand)}</div></div></div>`).join('')

  return `${START}
      <!-- GENERATED by scripts/generate-homepage-demo.mjs at build time. Do not edit by hand;
           your edit will be overwritten on the next build. See that file for why this is
           generated rather than written, and for the two candidates that looked ideal and
           demonstrated nothing. -->
      <div class="demo-card reveal">
        <div class="demo-result-label">Your routine</div>
        <div class="demo-routine">${items}
        </div>
        <div class="demo-result-label">Best value, delivered</div>
        <div class="demo-basket best">
          <div><div class="basket-retailer">${esc(solved.deliveryOptimalName)}</div><div class="basket-items">Whole routine, delivery included</div></div>
          <div><div class="basket-price">${money(best.delivered)}</div></div>
        </div>
        <div class="demo-basket">
          <div><div class="basket-retailer">${esc(solved.goodsOptimalName)}</div><div class="basket-items">Each item at its best price</div></div>
          <div><div class="basket-price">${money(worse.delivered)}</div><div class="basket-saving">${money(solved.gap)} more, delivered</div></div>
        </div>
        <p style="font-size:13px;color:rgba(250,248,244,0.45);margin-top:18px;line-height:1.6;">
          Buying each product where it costs least splits the order and adds a delivery charge to each leg.
          Priced as one basket it costs ${money(solved.gap)} less, delivered.
        </p>
      </div>
${END}`
}

function renderFallback() {
  return `${START}
      <!-- GENERATED FALLBACK. No candidate basket demonstrated the mechanism at build
           time, so no figures are shown. This is deliberate: a hero showing a "best"
           basket that is no longer best is worse than one that is merely stale.
           See scripts/generate-homepage-demo.mts. -->
      <div class="demo-card reveal">
        <div class="demo-result-label">Your whole routine, priced properly</div>
        <p style="font-size:16px;color:rgba(250,248,244,0.72);line-height:1.7;margin-bottom:16px;">
          Most comparison tools answer one question: where is this one product at its best price?
          A routine is not one product. It is a basket, and a basket has a delivery cost that
          depends on how you group it.
        </p>
        <p style="font-size:16px;color:rgba(250,248,244,0.72);line-height:1.7;margin-bottom:24px;">
          FindMyBasket works out the best value way to buy your whole routine across multiple UK
          retailers, with delivery charges and free delivery thresholds included in the answer.
          Sometimes that means one retailer. Sometimes it means two. It is the delivered total
          that decides.
        </p>
        <a href="/app" class="btn-primary" style="display:inline-block;padding:14px 32px;">Build your routine →</a>
      </div>
${END}`
}

/**
 * Data source. Normally Supabase. FMB_DEMO_FIXTURE points at a JSON file with the
 * same shape, which exists so the success path can be exercised without live
 * credentials — otherwise the only provable path locally is the fallback, and a
 * generator whose happy path has never run is not known to work.
 */
async function loadData(allIds) {
  const fixture = process.env.FMB_DEMO_FIXTURE
  if (fixture) {
    const f = JSON.parse(readFileSync(fixture, 'utf8'))
    console.log(`FMB demo: using fixture ${fixture} (NOT live data)`)
    return { retailers: f.retailers, offers: f.offers, products: f.products }
  }
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return { missingCreds: true }

  const supabase = createClient(url, key)
  const { data: retailers } = await supabase
    .from('retailers').select('id,name,delivery_model,delivery_threshold,delivery_cost')
    .eq('active', true)
  const { data: offers } = await supabase
    .from('retailer_prices').select('product_id,retailer_id,price')
    .in('product_id', allIds).eq('in_stock', true)
  const { data: products } = await supabase
    .from('products').select('id,name,brand').in('id', allIds)
  return { retailers, offers, products }
}

async function main() {
  const allIds = [...new Set(CANDIDATES.flatMap(c => c.products))]
  const loaded = await loadData(allIds)
  if (loaded.missingCreds) {
    fallbackLoud(['SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set'])
    return
  }
  const { retailers, offers, products } = loaded

  const rejections = []

  if (!retailers?.length || !offers?.length || !products?.length) {
    fallbackLoud(['query returned no rows for retailers, offers or products'])
    return
  }

  const liveRetailers = retailers
  const liveOffers = offers.filter(o => o.price != null && Number(o.price) > 0)

  for (const cand of CANDIDATES) {
    const theseOffers = liveOffers.filter(o => cand.products.includes(o.product_id))
    const stocked = new Set(theseOffers.map(o => o.product_id))
    if (cand.products.some(p => !stocked.has(p))) {
      rejections.push(`${cand.id} (${cand.label}): one or more items out of stock everywhere`)
      continue
    }
    const solved = solve(cand.products, theseOffers, liveRetailers)
    if (!solved) { rejections.push(`${cand.id} (${cand.label}): no retailer pair covers the basket`); continue }
    if (!solved.differ || solved.gap <= 0) {
      rejections.push(
        `${cand.id} (${cand.label}): goods-optimal and delivery-optimal are the SAME arrangement ` +
        `(${solved.goodsOptimalName}), gap ${money(solved.gap)} — demonstrates nothing`)
      continue
    }

    const ordered = cand.products
      .map(pid => products.find(p => p.id === pid))
      .filter(Boolean)

    const html = readFileSync(TARGET, 'utf8')
    const block = renderDemo(ordered, solved, theseOffers)
    writeFileSync(TARGET, replaceBlock(html, block), 'utf8')

    console.log(
      `FMB demo: candidate ${cand.id} (${cand.label}) selected. ` +
      `goods-optimal ${solved.goodsOptimalName} ${money(solved.goodsOptimal.delivered)} delivered; ` +
      `delivery-optimal ${solved.deliveryOptimalName} ${money(solved.deliveryOptimal.delivered)}; ` +
      `gap ${money(solved.gap)}.`)
    if (rejections.length) {
      console.log('FMB demo: candidates rejected before this one:')
      rejections.forEach(r => console.log('  - ' + r))
    }
    return
  }

  fallbackLoud(rejections, null)
}

function replaceBlock(html, block) {
  const s = html.indexOf(START), e = html.indexOf(END)
  if (s === -1 || e === -1) {
    throw new Error(`FMB demo: markers ${START} / ${END} not found in ${TARGET}. ` +
      `The generator refuses to guess where the block goes.`)
  }
  return html.slice(0, s) + block + html.slice(e + END.length)
}

function fallbackLoud(rejections) {
  const html = readFileSync(TARGET, 'utf8')
  writeFileSync(TARGET, replaceBlock(html, renderFallback()), 'utf8')

  const bar = '='.repeat(72)
  console.error(bar)
  console.error('FMB DEMO FALLBACK FIRED — no candidate basket demonstrates the')
  console.error('mechanism. Hero rendered WITHOUT figures.')
  console.error(`  candidates evaluated : ${CANDIDATES.length}`)
  rejections.forEach(r => console.error(`  rejected             : ${r}`))
  console.error('')
  console.error('This is a CATALOGUE finding, not a rendering detail. If it fires on')
  console.error('consecutive builds, either the shortlist needs rebuilding or the wedge')
  console.error('has stopped biting. See work-list item 12.')
  console.error(bar)

  if (process.env.FMB_DEMO_FALLBACK_FATAL === '1') {
    process.exit(1)
  }
}

main().catch(err => {
  console.error('FMB demo: generator threw, falling back to copy without figures.')
  console.error(err)
  try { fallbackLoud([`generator threw: ${String(err)}`]) } catch { /* last resort */ }
})
