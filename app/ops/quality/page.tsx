import { getQualityRows, getBoundaries, boundariesFor, type QualityRow, type BoundaryRow } from '../../../lib/quality-metrics';

// =============================================================================
// DATA-QUALITY PANEL. Dashboard brief Step 9. Work-list items 111 and 116.
//
// NOT PUBLIC, AND NOT BEHIND THE CUSTOMER LOGIN. Supabase Auth here is a CUSTOMER
// surface — four users exist and three of them are not the operator — and there is no
// role model. So this page is gated by Basic Auth in middleware, deployed SEPARATELY,
// and the underlying tables carry no anon or authenticated grants at all.
//
// ---------------------------------------------------------------------------
// THREE RENDERING RULES. These are the whole design; everything else is layout.
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
// ---------------------------------------------------------------------------
//
// Server Component. `supabase` is the service-role client and must never reach the
// browser; nothing here is a Client Component and nothing takes an event handler.
// =============================================================================

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Data quality', robots: { index: false, follow: false } };

type Card = {
  key: string;
  label: string;
  value: (r: QualityRow) => string;
  denom: (r: QualityRow) => string | null;
  note?: string;
};

const nf = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : n.toLocaleString('en-GB');

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

function Trend({ rows }: { rows: QualityRow[] }) {
  // RULE 1. With one row there is nothing to draw, and drawing nothing is the point.
  if (rows.length < 2) {
    return (
      <p style={{ margin: '10px 0 0', fontSize: 12, color: '#8a8378' }}>
        <strong>First observation</strong> · {rows[0]?.week_start ?? '—'} · no trend yet
      </p>
    );
  }
  return (
    <p style={{ margin: '10px 0 0', fontSize: 12, color: '#8a8378' }}>
      {rows.length} observations from {rows[rows.length - 1].week_start}
    </p>
  );
}

export default async function QualityPanel() {
  const [rows, boundaries] = await Promise.all([getQualityRows(), getBoundaries()]);
  const latest = rows[0];

  if (!latest) {
    return (
      <main style={{ padding: 40, fontFamily: 'system-ui, sans-serif' }}>
        <h1>Data quality</h1>
        <p>
          <strong>metrics_quality_weekly holds no rows.</strong> The writer is
          <code> fmb_quality_snapshot_write()</code>; it has not been run, or it has been run
          and failed. This is not &ldquo;everything is fine&rdquo;.
        </p>
      </main>
    );
  }

  return (
    <main style={{ padding: '32px 24px 64px', maxWidth: 1100, margin: '0 auto', fontFamily: 'system-ui, sans-serif', color: '#2b2723' }}>
      <h1 style={{ fontSize: 26, margin: '0 0 4px' }}>Data quality</h1>
      <p style={{ margin: '0 0 6px', fontSize: 13, color: '#6b645c' }}>
        Week starting <strong>{latest.week_start}</strong> · written{' '}
        {new Date(latest.updated_at).toISOString().replace('T', ' ').slice(0, 16)} UTC
      </p>
      <Trend rows={rows} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16, marginTop: 24 }}>
        {CARDS.map((c) => {
          const marks = boundariesFor(boundaries, c.key);
          return (
            <section key={c.key} style={{ border: '1px solid #e5e0d8', borderRadius: 10, padding: 16, background: '#fff' }}>
              <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.06em', color: '#8a8378', margin: '0 0 8px', fontWeight: 600 }}>
                {c.label}
              </h2>
              <p style={{ fontSize: 30, fontWeight: 600, margin: '0 0 6px', lineHeight: 1.1 }}>{c.value(latest)}</p>
              {/* Denominator is never optional. A figure without one is the defect. */}
              <p style={{ fontSize: 12, color: '#6b645c', margin: 0 }}>{c.denom(latest)}</p>
              {c.note && <p style={{ fontSize: 12, color: '#8a8378', margin: '10px 0 0', lineHeight: 1.5 }}>{c.note}</p>}

              {ANNOTATIONS[c.key] && (
                <p style={{ fontSize: 11, color: '#a09789', margin: '10px 0 0', lineHeight: 1.5 }}>
                  Earlier: {ANNOTATIONS[c.key]} — <em>derived ad-hoc by a different route, not a series member</em>
                </p>
              )}

              <p style={{ fontSize: 11, color: marks.length ? '#6b645c' : '#b05c3c', margin: '10px 0 0' }}>
                {marks.length
                  ? `${marks.length} boundary row${marks.length > 1 ? 's' : ''} name this metric`
                  : 'NO boundary row names this metric — a step here would be unexplained'}
              </p>
            </section>
          );
        })}
      </div>

      <h2 style={{ fontSize: 16, margin: '36px 0 4px' }}>Boundaries</h2>
      <p style={{ fontSize: 12, color: '#8a8378', margin: '0 0 12px' }}>
        From <code>platform_changes</code>, matched to metrics <strong>by name</strong>. A
        renamed or dropped metric silently matches nothing, so the cards above say when no
        boundary names them.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: '#8a8378' }}>
            <th style={{ padding: '6px 8px', borderBottom: '1px solid #e5e0d8' }}>Date</th>
            <th style={{ padding: '6px 8px', borderBottom: '1px solid #e5e0d8' }}>Status</th>
            <th style={{ padding: '6px 8px', borderBottom: '1px solid #e5e0d8' }}>Change</th>
            <th style={{ padding: '6px 8px', borderBottom: '1px solid #e5e0d8' }}>Metrics named</th>
          </tr>
        </thead>
        <tbody>
          {boundaries.map((b: BoundaryRow) => (
            <tr key={b.id}>
              <td style={{ padding: '6px 8px', borderBottom: '1px solid #f2eee8', whiteSpace: 'nowrap' }}>
                {/* An 'expected' row has no date and cannot be placed on a time axis. */}
                {b.changed_at ? b.changed_at.slice(0, 10) : <em style={{ color: '#a09789' }}>not yet dated</em>}
              </td>
              <td style={{ padding: '6px 8px', borderBottom: '1px solid #f2eee8' }}>{b.status}</td>
              <td style={{ padding: '6px 8px', borderBottom: '1px solid #f2eee8' }}>{b.title}</td>
              <td style={{ padding: '6px 8px', borderBottom: '1px solid #f2eee8', color: '#6b645c' }}>
                {(b.metrics_affected ?? []).join(', ') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
