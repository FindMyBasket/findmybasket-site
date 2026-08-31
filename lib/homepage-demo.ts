import artefact from './homepage-demo.json';

/**
 * The homepage demo artefact, written by scripts/generate-homepage-demo.mjs at build time.
 *
 * TYPED HERE RATHER THAN INFERRED. TypeScript infers a JSON import's type from the file on
 * disk, and the COMMITTED state of that file is the fallback — so `demo.best` would not
 * typecheck in the repo and would typecheck after a build. A type that depends on whether a
 * build has run is not a type. Item 513.
 */
export type HomepageDemo =
  | { kind: 'fallback' }
  | {
      kind: 'demo';
      products: { name: string; brand: string }[];
      best: { retailer: string; delivered: number };
      worse: { retailer: string; delivered: number };
      gap: number;
    };

export const homepageDemo = artefact as HomepageDemo;
