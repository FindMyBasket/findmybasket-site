import { getQualityRows, getBoundaries, boundariesFor, type QualityRow, type BoundaryRow } from '../../../lib/quality-metrics';
import {
  getGa4Rows, getAwinWeeks, getOurClicks, reconcileClicks, isPartialWeek,
  type Ga4Row, type AwinWeek, type ClickSource,
} from '../../../lib/performance-metrics';

// =============================================================================
// OPS PANEL — QUALITY AND PERFORMANCE TOGETHER. Dashboard brief Steps 4, 5 and 9.
// Work-list items 111, 116 and 118.
//
// THE ROUTE IS STILL /ops/quality AND THE PAGE IS NO LONGER ONLY ABOUT QUALITY. Left
// alone deliberately: the URL is what OPS_BASIC_AUTH was configured against, and churning
// it to fix a name would be a live-access change dressed up as tidying.
//
// NOT PUBLIC, AND NOT BEHIND THE CUSTOMER LOGIN. Supabase Auth here is a CUSTOMER
// surface — four users exist and three of them are not the operator — and there is no
// role model. So this page is gated by Basic Auth in middleware, deployed SEPARATELY,
// and the underlying tables carry no anon or authenticated grants at all.
//
// ---------------------------------------------------------------------------
// THE RENDERING RULES. These are the whole design; everything else is layout.
//
//   1. A SINGLE POINT DRAWN AS A FLAT LINE ASSERTS STABILITY THAT HAS NOT BEEN
//      OBSERVED, AND A SPARKLINE WITH ONE DOT READS AS NO CHANGE.
//      So with one row there is no chart, no line and no sparkline anywhere on this
//      page. Where a trend would go, it says "first observation" and the date.
//
//   2. PACK_MISMATCH_SUSPECTS ALWAYS RENDERS ITS DENOMINATOR — 13 of 2,802 testable
//      on 110,193, 97.5 PER CENT UNMEASURED.
//      Shown bare, 13 invites "basically solved". The denominator is the finding.
//      Generalised here: every metric renders its denominator, because a percentage
//      without one is the defect this fortnight kept producing.
//
//   3. PRIOR HAND-DERIVED FIGURES ARE ANNOTATIONS LABELLED "DERIVED AD-HOC BY A
//      DIFFERENT ROUTE, NOT A SERIES MEMBER", NEVER PLOTTED.
//      Several of these quantities were computed by hand earlier in August. They are
//      not observations of this series and must never become points in it.
//
//   --- added 15 August, when performance joined quality on this page ---
//
//   4. THREE SERIES OF THREE DIFFERENT LENGTHS ARE NEVER PUT ON A SHARED AXIS.
//      GA4 holds 4 weeks, AWIN 12, quality 1, and they overlap on exactly ONE week.
//      Aligning them means either truncating AWIN to GA4's length or padding GA4 with
//      blanks that read as zeroes. Each series is rendered at its own length, and the
//      length is stated next to it.
//
//   5. A PARTIAL WEEK IS EXCLUDED FROM EVERY TOTAL AND LABELLED WHERE IT APPEARS.
//      Not a rule invented in advance. The first reading of the AWIN series counted the
//      current partial week as a member and produced a segment conversion claim wrong by
//      TWO ORDERS OF MAGNITUDE. A partial week is not a small week.
//
//   6. A NETWORK WITH NO DATA GETS A LABELLED GAP, NEVER AN EMPTY CARD AND NEVER AN
//      OMISSION. Rakuten and Amazon send real traffic that GA4 counts; what is missing is
//      the revenue side. An absent card reads as "no such thing"; a zero reads as "nothing
//      happened". Both are wrong, and the second is worse.
// ---------------------------------------------------------------------------
//
// Server Component. `supabase` is the service-role client and must never reach the
// browser; nothing here is a Client Component and nothing takes an event handler.
// =============================================================================

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ops — quality and performance', robots: { index: false, follow: false } };

type Card = {
  key: string;
  label: string;
  value: (r: QualityRow) => string;
  denom: (r: QualityRow) => string | null;
  note?: string;
};

const nf = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : n.toLocaleString('en-GB');
const gbp = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `£${n.toFixed(2)}`;

const C = {
  ink: '#2b2723', mid: '#6b645c', dim: '#8a8378', faint: '#a09789',
  line: '#e5e0d8', hair: '#f2eee8', warn: '#b05c3c', card: '#fff',
};

const box: React.CSSProperties = {
  border: `1px solid ${C.line}`, borderRadius: 10, padding: 16, background: C.card,
};
const th: React.CSSProperties = { padding: '6px 8px', borderBottom: `1px solid ${C.line}`, textAlign: 'left' };
const td: React.CSSProperties = { padding: '6px 8px', borderBottom: `1px solid ${C.hair}` };
const num: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

const CARDS: Card[] = [
  {
    key: 'comparison_depth_pct',
    label: 'Comparison depth',
    value: (r) => (r.comparison_depth_pct === null ? '—' : `${r.comparison_depth_pct}%`),
    denom: (r) => `${nf(r.comparison_depth_num)} of ${nf(r.comparison_depth_den)} root in-stock products with 2+ live retailers`,
    note: 'Expected to FALL when Boots supplements land: ~1,715 mostly single-stockist products enter the denominator. A fall is the change working, not a regression.',
  },
  {
    key: 'suspect_price_count',
    label: 'Suspect prices',
    value: (r) => nf(r.suspect_price_count),
    denom: (r) =>
      `of ${nf(r.suspect_price_den)} rows having a peer · threshold ${r.suspect_price_threshold ?? '—'} of peer median`,
    note: 'Threshold is stored per row, so changing it records a new definition rather than continuing this series.',
  },
  {
    key: 'ean_coverage_pct',
    label: 'Barcode coverage',
    value: (r) => (r.ean_coverage_pct === null ? '—' : `${r.ean_coverage_pct}%`),
    denom: (r) => `${nf(r.ean_coverage_num)} of ${nf(r.ean_coverage_den)} live in-stock rows`,
  },
  {
    key: 'ambiguous_ean_groups',
    label: 'Ambiguous barcodes',
    value: (r) => nf(r.ambiguous_ean_groups),
    denom: (r) => `of ${nf(r.ambiguous_ean_den)} distinct barcodes on live rows`,
    note: 'One barcode resolving to more than one product. This is what tier 1 refuses to link, every night.',
  },
  {
    key: 'sole_supplier_share_pct',
    label: 'Sole-supplier share',
    value: (r) => (r.sole_supplier_share_pct === null ? '—' : `${r.sole_supplier_share_pct}%`),
    denom: (r) => `${nf(r.sole_supplier_num)} of ${nf(r.sole_supplier_den)} indexed barcodes from exactly one retailer`,
  },
  {
    key: 'no_in_stock_offer_count',
    label: 'No in-stock offer',
    value: (r) => nf(r.no_in_stock_offer_count),
    denom: (r) => `of ${nf(r.no_in_stock_offer_den)} products_active`,
    note: 'products_active does not filter on in_stock, so these hold a page with nothing buyable on it.',
  },
  {
    key: 'stale_in_stock_rows',
    label: 'Stale in-stock rows',
    value: (r) => nf(r.stale_in_stock_rows),
    denom: (r) => `of ${nf(r.stale_in_stock_den)} in-stock rows at enabled retailers`,
    note: 'Measured against each retailer’s OWN last import, not a fixed day bucket — YesStyle’s absence threshold is 9999, which makes fixed buckets meaningless for it.',
  },
  {
    key: 'pack_mismatch_suspects',
    label: 'Pack mismatch',
    // RULE 2. The denominator is not decoration here; it is the entire meaning.
    value: (r) => nf(r.pack_mismatch_suspects),
    denom: (r) => {
      const t = r.pack_mismatch_testable ?? 0;
      const d = r.pack_mismatch_den ?? 0;
      const pct = d ? (100 - (100 * t) / d).toFixed(1) : '—';
      return `of ${nf(t)} testable, on ${nf(d)} live rows — ${pct}% UNMEASURED`;
    },
    note: 'Needs a pack count stated on BOTH the product name and the row URL. An empty result means "nothing found in the tested slice", never "nothing wrong".',
  },
  {
    key: 'cross_product_price_outliers',
    label: 'Cross-product outliers',
    value: (r) => nf(r.cross_product_price_outliers),
    denom: (r) =>
      `pairs over ${nf(r.cross_product_candidate_den)} candidate products · plus ${nf(r.cross_product_identical_pairs)} identical-name pairs`,
    note: 'Exists because a within-product comparator cannot see a between-product defect at any threshold.',
  },
];

// RULE 3. Figures computed by hand earlier in August, shown for context only.
const ANNOTATIONS: Record<string, string> = {
  sole_supplier_share_pct: '79.2% on 13 Aug, 77.3% on 14 Aug',
  no_in_stock_offer_count: '13,335 on 13 Aug',
  ambiguous_ean_groups: '8,606 on 14 Aug (active AND enabled — a different predicate)',
};

// RULE 6. The networks that exist commercially but have no revenue table.
const GAPS = [
  {
    network: 'Rakuten',
    clicks: (g: Ga4Row[]) => g.reduce((a, r) => a + (r.outbound_clicks_rakuten ?? 0), 0),
    why: 'No puller and no table. GA4 counts the outbound clicks, so the traffic side is measured and the revenue side is not.',
  },
  {
    network: 'Amazon',
    clicks: (g: Ga4Row[]) => g.reduce((a, r) => a + (r.outbound_clicks_amazon ?? 0), 0),
    why: 'No puller and no table. The Creators API gate is a rolling 30-day sales requirement, so reporting access is not yet open.',
  },
];

function Trend({ rows }: { rows: QualityRow[] }) {
  // RULE 1. With one row there is nothing to draw, and drawing nothing is the point.
  if (rows.length < 2) {
    return (
      <p style={{ margin: '10px 0 0', fontSize: 12, color: C.dim }}>
        <strong>First observation</strong> · {rows[0]?.week_start ?? '—'} · no trend yet
      </p>
    );
  }
  return (
    <p style={{ margin: '10px 0 0', fontSize: 12, color: C.dim }}>
      {rows.length} observations from {rows[rows.length - 1].week_start}
    </p>
  );
}

function Section({ title, sub, children }: { title: string; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <h2 style={{ fontSize: 17, margin: '40px 0 4px', paddingTop: 12, borderTop: `2px solid ${C.line}` }}>{title}</h2>
      {sub && <p style={{ fontSize: 12, color: C.dim, margin: '0 0 14px', lineHeight: 1.6, maxWidth: 760 }}>{sub}</p>}
      {children}
    </>
  );
}

export default async function OpsPanel() {
  const [rows, boundaries, ga4, awin, ours] = await Promise.all([
    getQualityRows(), getBoundaries(), getGa4Rows(), getAwinWeeks(), getOurClicks(),
  ]);
  const latest = rows[0];
  const recon = reconcileClicks(ga4, awin, ours);

  // RULE 5. Every total below is over COMPLETE weeks only.
  const awinComplete = awin.filter((w) => !isPartialWeek(w.week_start));
  const tot = awinComplete.reduce(
    (a, w) => ({ clicks: a.clicks + w.clicks, sales: a.sales + w.sales, value: a.value + w.value, comm: a.comm + w.comm }),
    { clicks: 0, sales: 0, value: 0, comm: 0 },
  );
  const rate = tot.value ? (100 * tot.comm) / tot.value : null;
  const perSale = tot.sales ? tot.comm / tot.sales : null;
  const epc = tot.clicks ? tot.comm / tot.clicks : null;

  const ga4Stale = ga4[0] ? (Date.now() - new Date(ga4[0].updated_at).getTime()) / 86400000 : null;

  return (
    <main style={{ padding: '32px 24px 80px', maxWidth: 1100, margin: '0 auto', fontFamily: 'system-ui, sans-serif', color: C.ink }}>
      <h1 style={{ fontSize: 26, margin: '0 0 4px' }}>Ops — quality and performance</h1>
      <p style={{ margin: 0, fontSize: 13, color: C.mid }}>
        Three series of three different lengths, each at its own length.{' '}
        <strong>GA4 {ga4.length} weeks · AWIN {awin.length} weeks · quality {rows.length} {rows.length === 1 ? 'week' : 'weeks'}.</strong>{' '}
        They overlap on {new Set(ga4.map((r) => r.week_start)).size && rows.length ? 'one week' : 'no weeks'}, which is why nothing here shares an axis.
      </p>

      {/* ── COMMERCIAL ───────────────────────────────────────────────────────── */}
      <Section
        title="Commission"
        sub={<>AWIN, {awinComplete.length} complete weeks. <strong>The current partial week is excluded from these totals</strong> — it is not a small week, and counting it as one is how the first reading of this series produced a conversion claim wrong by two orders of magnitude.</>}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 14 }}>
          {[
            ['Realised commission rate', rate === null ? '—' : `${rate.toFixed(2)}%`, `${gbp(tot.comm)} on ${gbp(tot.value)} of sale value`],
            ['Commission per sale', gbp(perSale), `${nf(tot.sales)} tracked sales · AOV ${gbp(tot.sales ? tot.value / tot.sales : null)}`],
            ['Commission per click', epc === null ? '—' : `${(epc * 100).toFixed(2)}p`, `${nf(tot.clicks)} AWIN-reported clicks — see the reconciliation below`],
            ['Conversion', tot.clicks ? `${((100 * tot.sales) / tot.clicks).toFixed(2)}%` : '—', `${nf(tot.sales)} of ${nf(tot.clicks)} clicks`],
          ].map(([l, v, d]) => (
            <section key={l as string} style={box}>
              <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: C.dim, margin: '0 0 8px', fontWeight: 600 }}>{l}</h3>
              <p style={{ fontSize: 26, fontWeight: 600, margin: '0 0 6px', lineHeight: 1.1 }}>{v}</p>
              <p style={{ fontSize: 11, color: C.mid, margin: 0, lineHeight: 1.5 }}>{d}</p>
            </section>
          ))}
        </div>
        <p style={{ fontSize: 12, color: C.dim, margin: '14px 0 0', lineHeight: 1.6, maxWidth: 760 }}>
          <strong>Commission validates over weeks, not days.</strong> A sale is pending, then approved or
          declined, and the week&rsquo;s figures keep moving the whole time — which is why the puller
          re-reads 12 trailing weeks and upserts rather than appending. A recent week showing
          pending and no confirmed is the lag, not a loss.
        </p>
      </Section>

      {/* ── THE RECONCILIATION ───────────────────────────────────────────────── */}
      <Section
        title="Outbound clicks — three sources, one event"
        sub={<>Commission per click is the steering metric for the whole funnel, and this is its denominator. <strong>Rendered as three columns and never as one reconciled number</strong>: there is no basis for choosing between them, and averaging three counts of the same event would invent a fourth.</>}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, maxWidth: 720 }}>
          <thead>
            <tr style={{ color: C.dim }}>
              <th style={th}>Week</th>
              <th style={{ ...th, textAlign: 'right' }}>Ours</th>
              <th style={{ ...th, textAlign: 'right' }}>GA4</th>
              <th style={{ ...th, textAlign: 'right' }}>AWIN</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {recon.map((r: ClickSource) => {
              const partial = isPartialWeek(r.week_start);
              const vals = [r.ours, r.ga4, r.awin].filter((v): v is number => v !== null);
              const spread = vals.length > 1 && Math.min(...vals) > 0 ? Math.max(...vals) / Math.min(...vals) : null;
              return (
                <tr key={r.week_start} style={partial ? { color: C.faint } : undefined}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.week_start}</td>
                  {/* A dash is "no row". A zero is "a row saying none". Different facts. */}
                  <td style={num}>{r.ours === null ? '—' : nf(r.ours)}</td>
                  <td style={num}>{r.ga4 === null ? '—' : nf(r.ga4)}</td>
                  <td style={num}>{r.awin === null ? '—' : nf(r.awin)}</td>
                  <td style={{ ...td, fontSize: 11, color: spread && spread >= 3 ? C.warn : C.faint }}>
                    {partial ? 'PARTIAL WEEK — excluded from totals' : spread && spread >= 3 ? `${spread.toFixed(1)}× apart` : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={{ fontSize: 12, color: C.warn, margin: '14px 0 0', lineHeight: 1.6, maxWidth: 760 }}>
          <strong>These have never agreed.</strong> GA4&rsquo;s count is falling, AWIN&rsquo;s is rising and ours is
          roughly flat. Three sources moving in three directions does not mean they need
          reconciling — it means at least two of them are wrong, and the flat first-party
          series is the most credible of the three.
          {ga4Stale !== null && ga4Stale > 3 && (
            <> <strong>GA4 has not been written for {Math.floor(ga4Stale)} days</strong>, so its column is stale as well as low.</>
          )}
        </p>
      </Section>

      {/* ── TRAFFIC ──────────────────────────────────────────────────────────── */}
      <Section
        title="Traffic"
        sub={<>GA4, {ga4.length} weeks — a shorter history than AWIN&rsquo;s and not padded to match it.</>}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, maxWidth: 760 }}>
          <thead>
            <tr style={{ color: C.dim }}>
              <th style={th}>Week</th>
              <th style={{ ...th, textAlign: 'right' }}>Sessions</th>
              <th style={{ ...th, textAlign: 'right' }}>Comparison views</th>
              <th style={{ ...th, textAlign: 'right' }}>Out: AWIN</th>
              <th style={{ ...th, textAlign: 'right' }}>Rakuten</th>
              <th style={{ ...th, textAlign: 'right' }}>Amazon</th>
            </tr>
          </thead>
          <tbody>
            {ga4.map((r) => (
              <tr key={r.week_start} style={isPartialWeek(r.week_start) ? { color: C.faint } : undefined}>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {r.week_start}{isPartialWeek(r.week_start) && <em style={{ fontSize: 11 }}> partial</em>}
                </td>
                <td style={num}>{nf(r.sessions)}</td>
                {/* null here is "the metric did not exist yet", not "nobody viewed one". */}
                <td style={num}>{r.comparison_views === null ? <em style={{ color: C.faint, fontSize: 11 }}>not yet defined</em> : nf(r.comparison_views)}</td>
                <td style={num}>{nf(r.outbound_clicks_awin)}</td>
                <td style={num}>{nf(r.outbound_clicks_rakuten)}</td>
                <td style={num}>{nf(r.outbound_clicks_amazon)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* ── RULE 6: LABELLED GAPS ────────────────────────────────────────────── */}
      <Section
        title="Networks with no revenue data"
        sub={<>These are <strong>gaps, not zeroes</strong>. Both send real traffic that GA4 already counts; what is missing is the money side. An absent card would read as &ldquo;no such thing&rdquo; and a zero would read as &ldquo;nothing happened&rdquo; — both wrong, and the second one worse.</>}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {GAPS.map((g) => (
            <section key={g.network} style={{ ...box, background: 'repeating-linear-gradient(45deg, #fff, #fff 8px, #faf8f4 8px, #faf8f4 16px)' }}>
              <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: C.dim, margin: '0 0 8px', fontWeight: 600 }}>
                {g.network}
              </h3>
              <p style={{ fontSize: 20, fontWeight: 600, margin: '0 0 6px', lineHeight: 1.2, color: C.warn }}>No revenue data</p>
              <p style={{ fontSize: 12, color: C.mid, margin: '0 0 8px' }}>
                {nf(g.clicks(ga4))} outbound clicks in GA4&rsquo;s {ga4.length} weeks · commission <strong>unknown</strong>
              </p>
              <p style={{ fontSize: 12, color: C.dim, margin: 0, lineHeight: 1.5 }}>{g.why}</p>
            </section>
          ))}
        </div>
      </Section>

      {/* ── QUALITY ──────────────────────────────────────────────────────────── */}
      <Section
        title="Data quality"
        sub={latest ? <>Week starting <strong>{latest.week_start}</strong>, written {new Date(latest.updated_at).toISOString().replace('T', ' ').slice(0, 16)} UTC.</> : undefined}
      >
        {!latest ? (
          <p style={{ ...box, color: C.warn }}>
            <strong>metrics_quality_weekly holds no rows.</strong> The writer is{' '}
            <code>fmb_quality_snapshot_write()</code>; it has not been run, or it has been run
            and failed. This is not &ldquo;everything is fine&rdquo;.
          </p>
        ) : (
          <>
            <Trend rows={rows} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16, marginTop: 18 }}>
              {CARDS.map((c) => {
                const marks = boundariesFor(boundaries, c.key);
                return (
                  <section key={c.key} style={box}>
                    <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.06em', color: C.dim, margin: '0 0 8px', fontWeight: 600 }}>
                      {c.label}
                    </h3>
                    <p style={{ fontSize: 30, fontWeight: 600, margin: '0 0 6px', lineHeight: 1.1 }}>{c.value(latest)}</p>
                    {/* Denominator is never optional. A figure without one is the defect. */}
                    <p style={{ fontSize: 12, color: C.mid, margin: 0 }}>{c.denom(latest)}</p>
                    {c.note && <p style={{ fontSize: 12, color: C.dim, margin: '10px 0 0', lineHeight: 1.5 }}>{c.note}</p>}

                    {ANNOTATIONS[c.key] && (
                      <p style={{ fontSize: 11, color: C.faint, margin: '10px 0 0', lineHeight: 1.5 }}>
                        Earlier: {ANNOTATIONS[c.key]} — <em>derived ad-hoc by a different route, not a series member</em>
                      </p>
                    )}

                    <p style={{ fontSize: 11, color: marks.length ? C.mid : C.warn, margin: '10px 0 0' }}>
                      {marks.length
                        ? `${marks.length} boundary row${marks.length > 1 ? 's' : ''} name this metric`
                        : 'NO boundary row names this metric — a step here would be unexplained'}
                    </p>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </Section>

      {/* ── BOUNDARIES ───────────────────────────────────────────────────────── */}
      <Section
        title="Boundaries"
        sub={<>From <code>platform_changes</code>, matched to metrics <strong>by name</strong>. A renamed or dropped metric silently matches nothing, so the cards above say when no boundary names them.</>}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ color: C.dim }}>
              <th style={th}>Date</th>
              <th style={th}>Status</th>
              <th style={th}>Change</th>
              <th style={th}>Metrics named</th>
            </tr>
          </thead>
          <tbody>
            {boundaries.map((b: BoundaryRow) => (
              <tr key={b.id}>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {/* An 'expected' row has no date and cannot be placed on a time axis. */}
                  {b.changed_at ? b.changed_at.slice(0, 10) : <em style={{ color: C.faint }}>not yet dated</em>}
                </td>
                <td style={td}>{b.status}</td>
                <td style={td}>{b.title}</td>
                <td style={{ ...td, color: C.mid }}>{(b.metrics_affected ?? []).join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </main>
  );
}
