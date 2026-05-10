import type { Metadata } from 'next';
import RoutineBuilder from './RoutineBuilder';
import './routine-builder.css';

export const metadata: Metadata = {
  title: 'Your routine | FindMyBasket',
  description:
    'Review your beauty routine and find the best value way to buy everything across UK retailers. Compare prices, optimise your basket, save money.',
  alternates: {
    canonical: 'https://www.findmybasket.co.uk/app',
  },
  openGraph: {
    title: 'Your routine | FindMyBasket',
    description:
      'Review your beauty routine and find the best value way to buy everything across UK retailers.',
    url: 'https://www.findmybasket.co.uk/app',
    type: 'website',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'FindMyBasket Routine Builder',
  url: 'https://www.findmybasket.co.uk/app',
  applicationCategory: 'ShoppingApplication',
  operatingSystem: 'Web',
  description:
    'Build your beauty routine and find the best value way to buy everything across UK retailers.',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'GBP',
  },
};

export default function AppPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <RoutineBuilder />
    </>
  );
}
