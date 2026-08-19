/**
 * Brand-hub outbound merchant extraction and the joined-programme comparison.
 *
 * Work-list items 224-226. Pure functions, so the detection logic can be tested without a
 * network — which matters here because the case it was built for (Abib) was CORRECTED before
 * the check existed, so live data can no longer demonstrate a finding.
 *
 * ── WHY THIS ASKS THE AWIN API RATHER THAN FOLLOWING THE LINKS ───────────────────────
 *
 * The obvious design is to resolve each affiliate link and match the final URL against
 * `awin1.com/closedMerchant.html`. That string is specific and matchable and the idea works.
 *
 *   BUT RESOLVING AN AFFILIATE LINK REGISTERS A CLICK.
 *
 * A weekly probe over every brand hub manufactures clicks that can never convert, in the same
 * publisher account whose click and conversion figures this project pulls into
 * `metrics_awin_weekly`. The check would corrupt the data it sits beside and degrade the
 * publisher metrics the network judges us by.
 *
 *   A MONITORING PROBE THAT TRAVERSES A METERED PATH BECOMES PART OF WHAT IT MEASURES.
 *
 * So the question is asked directly — IS THIS PROGRAMME STILL JOINED? — rather than inferred
 * from where a redirect lands. No clicks are generated.
 */

/** An AWIN merchant id referenced by a hub, and where in the row it was found. */
export type HubMerchantRef = { slug: string; merchantId: string; source: 'body' | 'offer' };

/**
 * Every AWIN merchant id a hub links to, from the editorial body AND the offer CTA.
 *
 * BOTH FIELDS, DELIBERATELY. Abib carried its links in `body_html` and no offer;
 * iLĀPOTHECARY carries an empty body and its only link in `offer.cta_url`. A check that read
 * one field would have covered exactly one of the two hubs it exists for.
 */
export function extractMerchantIds(
  hub: { slug: string; body_html?: string | null; offer?: unknown },
): HubMerchantRef[] {
  const out: HubMerchantRef[] = [];
  const scan = (text: string, source: 'body' | 'offer') => {
    // awinmid may arrive HTML-escaped (&amp;) or raw, in either order of parameters.
    for (const m of String(text ?? '').matchAll(/awinmid=(\d+)/g)) {
      if (!out.some((r) => r.merchantId === m[1] && r.source === source)) {
        out.push({ slug: hub.slug, merchantId: m[1], source });
      }
    }
  };
  scan(hub.body_html ?? '', 'body');
  const offer = hub.offer as { cta_url?: string } | null | undefined;
  if (offer && typeof offer === 'object') scan(JSON.stringify(offer), 'offer');
  return out;
}

export type ProgrammeFinding = { key: string; summary: string };

/**
 * A hub linking to a merchant we are no longer joined to is a finding.
 *
 * `finding_key` is `hub:{slug}:mid:{merchantId}` — STABLE ACROSS RUNS, with no timestamp and no
 * measured value in it, so `report_count` rises and item 194's escalation actually works. A key
 * carrying a date or a count would create a new row every run and silently disable it.
 */
export function findClosedProgrammeLinks(
  refs: HubMerchantRef[],
  joinedMerchantIds: Set<string>,
): ProgrammeFinding[] {
  const seen = new Set<string>();
  const findings: ProgrammeFinding[] = [];
  for (const r of refs) {
    if (joinedMerchantIds.has(r.merchantId)) continue;
    const key = `hub:${r.slug}:mid:${r.merchantId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      key,
      summary: `/brands/${r.slug} links to AWIN merchant ${r.merchantId}, which is no longer a `
        + `joined programme (found in ${r.source}). Its affiliate links now land on AWIN's `
        + `closed-merchant page, and any commission claim on that page is false.`,
    });
  }
  return findings;
}
