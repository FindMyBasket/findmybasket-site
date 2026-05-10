// BreadcrumbList JSON-LD generator.
// https://developers.google.com/search/docs/appearance/structured-data/breadcrumb

const SITE_URL = 'https://www.findmybasket.co.uk';

export interface BreadcrumbItem {
  name: string;
  url: string; // path, will be prefixed with SITE_URL
}

export function buildBreadcrumbJsonLd(items: BreadcrumbItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.name,
      item: `${SITE_URL}${item.url.startsWith('/') ? item.url : '/' + item.url}`,
    })),
  };
}
