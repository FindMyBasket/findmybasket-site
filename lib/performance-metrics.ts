import { supabase } from './supabase';

// Reads for the performance half of the ops panel. SERVER ONLY — `supabase` is the
// service-role client. Same protection argument as lib/quality-metrics.ts: the page is
// gated by middleware, the DATA is protected by the absence of any anon grant, and the
// second of those does not depend on the first being right.

export interface Ga4Row {
  week_start: string;
  sessions: number | null;
  qualified_sessions: number | null;
  comparison_views: number | null;
  outbound_clicks_awin: number | null;
  outbound_clicks_rakuten: number | null;
  outbound_clicks_amazon: number | null;
  outbound_clicks_other: number | null;
  updated_at: string;
}

export interface AwinWeek {
  week_start: string;
  clicks: number;
  sales: number;
  value: number;
  comm: number;
  advertisers: number;
}

export interface ClickSource {
  week_start: string;
  ours: number | null;
  ga4: number | null;
  awin: number | null;
}

/**
 * A WEEK IS PARTIAL UNTIL ITS LAST DAY HAS PASSED, AND A PARTIAL WEEK IS NOT A SMALL WEEK.
 *
 * This mattered immediately. The first reading of AWIN's series treated the current
 * partial week as a member and produced a segment conversion claim that was wrong by two
 * orders of magnitude. Every total on this page therefore excludes the partial week and
 * says so, rather than quietly summing a week that is still being written.
 */
export function isPartialWeek(weekStart: string, now = new Date()): boolean {
  const end = new Date(`${weekStart}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 7);
  return now.getTime() < end.getTime();
}

export async function getGa4Rows(limit = 13): Promise<Ga4Row[]> {
  const { data, error } = await supabase
    .from('metrics_ga4_weekly')
    .select('*')
    .order('week_start', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`metrics_ga4_weekly read failed: ${error.message}`);
  return (data ?? []) as Ga4Row[];
}

/** AWIN is stored per (week, advertiser, region), so the weekly view is an aggregate. */
export async function getAwinWeeks(limit = 12): Promise<AwinWeek[]> {
  const { data, error } = await supabase
    .from('metrics_awin_weekly')
    .select('week_start, clicks, total_no, total_value, total_comm, advertiser_id')
    .order('week_start', { ascending: false });
  if (error) throw new Error(`metrics_awin_weekly read failed: ${error.message}`);

  const by = new Map<string, AwinWeek>();
  for (const r of (data ?? []) as Record<string, number | string | null>[]) {
    const k = String(r.week_start);
    const w = by.get(k) ?? { week_start: k, clicks: 0, sales: 0, value: 0, comm: 0, advertisers: 0 };
    w.clicks += Number(r.clicks ?? 0);
    w.sales += Number(r.total_no ?? 0);
    w.value += Number(r.total_value ?? 0);
    w.comm += Number(r.total_comm ?? 0);
    // Advertisers that PRODUCED something. A joined advertiser with a silent week is a
    // real row in the table and must not inflate this count.
    if (Number(r.clicks ?? 0) > 0 || Number(r.total_no ?? 0) > 0) w.advertisers += 1;
    by.set(k, w);
  }
  return [...by.values()].sort((a, b) => (a.week_start < b.week_start ? 1 : -1)).slice(0, limit);
}

/** Our own first-party outbound click log, weekly. */
export async function getOurClicks(sinceWeeks = 12): Promise<Map<string, number>> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - sinceWeeks * 7 - 7);
  const { data, error } = await supabase
    .from('outbound_clicks')
    .select('created_at')
    .gte('created_at', since.toISOString());
  if (error) throw new Error(`outbound_clicks read failed: ${error.message}`);

  const by = new Map<string, number>();
  for (const r of (data ?? []) as { created_at: string }[]) {
    const d = new Date(r.created_at);
    const dow = (d.getUTCDay() + 6) % 7; // Mon = 0, to match every other weekly series
    d.setUTCDate(d.getUTCDate() - dow);
    const k = d.toISOString().slice(0, 10);
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  return by;
}

/**
 * THE RECONCILIATION. Three independent counts of one event — a visitor leaving for a
 * retailer — lined up by week.
 *
 * This is the most load-bearing thing on the page. Commission per click is the steering
 * metric for the entire funnel, and this is its denominator. On the first reading the
 * three sources disagreed by up to seven times and moved in three different directions,
 * which means at least two of them are wrong.
 *
 * Rendered as a table and never as a single reconciled number, because there is no basis
 * for choosing one, and averaging three counts of the same event would invent a fourth.
 */
export function reconcileClicks(
  ga4: Ga4Row[],
  awin: AwinWeek[],
  ours: Map<string, number>,
): ClickSource[] {
  const weeks = new Set<string>([
    ...ga4.map((r) => r.week_start),
    ...awin.map((r) => r.week_start),
    ...ours.keys(),
  ]);
  const ga4By = new Map(ga4.map((r) => [r.week_start, r.outbound_clicks_awin]));
  const awinBy = new Map(awin.map((r) => [r.week_start, r.clicks]));
  return [...weeks]
    .sort()
    .reverse()
    .map((w) => ({
      week_start: w,
      // null and 0 are different facts: no row at all versus a row saying none.
      ours: ours.has(w) ? (ours.get(w) as number) : null,
      ga4: ga4By.has(w) ? (ga4By.get(w) ?? null) : null,
      awin: awinBy.has(w) ? (awinBy.get(w) ?? null) : null,
    }));
}
