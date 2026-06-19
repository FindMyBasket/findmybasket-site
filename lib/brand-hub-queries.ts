import { supabase } from './supabase';

// Data-driven Brand Spotlight hubs (table-backed, see migration
// 20260617040000_brand_hubs.sql). Content lives in Supabase so new hubs are
// launched by adding rows, not writing pages.

export interface BrandHubPillar {
  title: string;
  body: string;
}

export interface BrandHubOffer {
  headline: string;
  code: string;
  body: string;
  expires_at: string | null; // ISO timestamp, or null for a standing offer
  cta_url: string;
}

export interface BrandHub {
  slug: string;
  display_name: string;
  accent_treatment: string;
  logo_path: string | null;
  eyebrow: string | null;
  lede: string | null;
  pillars: BrandHubPillar[];
  show_comparison: boolean;
  single_path_note: string | null;
  offer: BrandHubOffer | null;
  disclosure: string | null;
  zone_note: string | null;
  range_sub: string | null;
}

export interface BrandHubProduct {
  id: number;
  name: string;
  category: string | null;
  benefit_tags: string | null;
  description: string | null;
  price: number | null;
  volume: string | null;
  image_path: string | null;
  buy_url: string | null;
  sort_order: number;
}

export interface BrandHubData {
  hub: BrandHub;
  products: BrandHubProduct[];
}

// Lightweight row for the Brand Spotlight index (/brands). Only the fields a
// card needs, so the index stays cheap as more hubs are seeded.
export interface BrandHubSummary {
  slug: string;
  display_name: string;
  accent_treatment: string;
  logo_path: string | null;
  eyebrow: string | null;
  lede: string | null;
}

// Every published hub, ordered for display. The index renders whatever rows
// exist, so new hubs appear with no code change once their row is added.
export async function getAllBrandHubs(): Promise<BrandHubSummary[]> {
  const { data, error } = await supabase
    .from('brand_hubs')
    .select('slug, display_name, accent_treatment, logo_path, eyebrow, lede')
    .order('display_name', { ascending: true });

  if (error || !data) return [];
  return data as BrandHubSummary[];
}

// Returns null when no hub row exists for the slug, so the route can fall back to
// the price-comparison brand page.
export async function getBrandHub(slug: string): Promise<BrandHubData | null> {
  const { data: hub, error } = await supabase
    .from('brand_hubs')
    .select(
      'slug, display_name, accent_treatment, logo_path, eyebrow, lede, pillars, show_comparison, single_path_note, offer, disclosure, zone_note, range_sub'
    )
    .eq('slug', slug)
    .maybeSingle();

  if (error || !hub) return null;

  const { data: productRows } = await supabase
    .from('brand_hub_products')
    .select(
      'id, name, category, benefit_tags, description, price, volume, image_path, buy_url, sort_order'
    )
    .eq('brand_slug', slug)
    .order('sort_order', { ascending: true });

  const products: BrandHubProduct[] = (productRows ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    benefit_tags: p.benefit_tags,
    description: p.description,
    // numeric comes back as a string from PostgREST
    price: p.price == null ? null : Number(p.price),
    volume: p.volume,
    image_path: p.image_path,
    buy_url: p.buy_url,
    sort_order: p.sort_order ?? 0,
  }));

  return {
    hub: {
      ...hub,
      pillars: Array.isArray(hub.pillars) ? (hub.pillars as BrandHubPillar[]) : [],
      offer: (hub.offer as BrandHubOffer | null) ?? null,
    } as BrandHub,
    products,
  };
}

// An offer renders only when it is present AND not past its expiry. A null
// expires_at means a standing offer (no end date). Time-bound offers (e.g.
// Clarins campaigns) therefore stop rendering automatically once expired.
export function liveOffer(offer: BrandHubOffer | null): BrandHubOffer | null {
  if (!offer) return null;
  if (!offer.headline || !offer.code) return null;
  if (offer.expires_at) {
    const expiry = new Date(offer.expires_at).getTime();
    if (!Number.isNaN(expiry) && expiry <= Date.now()) return null;
  }
  return offer;
}
