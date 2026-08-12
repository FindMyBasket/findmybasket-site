import { CategoryPage } from '../../components/CategoryPage';

export const revalidate = 3600;

export const metadata = {
  title: 'Beauty supplement prices across UK retailers | FindMyBasket',
  description:
    'Compare beauty supplement prices across multiple UK retailers, delivery included. Collagen, hair-skin-nails complexes and biotin from Vida Glow, Solgar, Hair Gain, Ancient + Brave and more.',
  alternates: { canonical: 'https://www.findmybasket.co.uk/supplements' },
};

export default async function SupplementsPage() {
  return (
    <CategoryPage
      category="supplements"
      displayName="Supplements"
      // Deliberately describes what the category IS rather than how large it is.
      // Copy that quotes a count is copy that goes stale the next time the
      // classifier runs; see docs/standing-rule-frozen-catalogue-state.md.
      intro="Compare prices across multiple UK retailers on ingestible beauty supplements, delivery included. Collagen, hair-skin-nails complexes and biotin, from the same brands you already buy skincare from."
    />
  );
}
