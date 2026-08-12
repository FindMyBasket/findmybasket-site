/**
 * The guard on the sitemap's brand list.
 *
 * THE FAILURE WORTH CATCHING IS NOT A SLOW BUILD, IT IS A QUIET ONE. If
 * fmb_active_brand_names() ever returns nothing — dropped function, a permissions
 * change, an RLS policy that hides products_active from the build's role — the old
 * paginating loop would have swallowed it silently: `if (error || !data) break`
 * exits the loop, `brandSlugs` stays empty, and the route emits a perfectly valid
 * sitemap with every brand page missing. Google reads that as 2,400 pages
 * withdrawn, and nothing anywhere reports it.
 *
 * A red build is recoverable in minutes. A sitemap that silently stops advertising
 * the brand pages is discovered in search console weeks later, and the index
 * position comes back slowly — the same shape as the GONE_IDS incident, where the
 * middleware told Google 3,894 live products were permanently deleted for thirteen
 * days because nothing was checking.
 *
 * So this throws. Deliberately. Failing the build is the intended behaviour, not a
 * side effect of being strict.
 *
 * It lives here rather than inline in the route so it can be tested without
 * credentials: the route imports lib/supabase, which throws at module load when
 * SUPABASE_URL is unset, so anything asserted inside it can only run against a live
 * database. This function is pure, so the guard itself is covered by
 * lib/__tests__/sitemap-brands.test.ts rather than merely being present.
 */

/** Thrown when the brand list is absent or empty. Named so the build log says why. */
export class EmptyBrandListError extends Error {
  constructor(detail: string) {
    super(
      `Sitemap brand list is unusable (${detail}). Refusing to emit a sitemap with no ` +
        `brand pages — that would withdraw every /brands/* URL from the index silently. ` +
        `Check fmb_active_brand_names() and the build role's access to products_active.`,
    );
    this.name = 'EmptyBrandListError';
  }
}

/**
 * Validate what `fmb_active_brand_names()` returned and hand back the names.
 *
 * @param value the RPC's `data` — expected to be a JSON array of brand names
 * @param error the RPC's `error`, passed through so one call site handles both
 */
export function requireBrandNames(value: unknown, error?: unknown): string[] {
  if (error) {
    const msg = (error as { message?: string })?.message ?? String(error);
    throw new EmptyBrandListError(`RPC errored: ${msg}`);
  }
  if (value === null || value === undefined) {
    throw new EmptyBrandListError('RPC returned null');
  }
  if (!Array.isArray(value)) {
    throw new EmptyBrandListError(`expected an array, got ${typeof value}`);
  }
  // Non-string entries would slugify to nonsense URLs rather than failing, so they
  // are rejected here rather than being coerced.
  const names = value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  if (names.length === 0) {
    throw new EmptyBrandListError(
      value.length === 0 ? 'array was empty' : `array held ${value.length} entries, none a usable string`,
    );
  }
  return names;
}
