import { SiteLayout } from '../../components/SiteLayout';

// Test page at /test - kept around as a quick "is the rebuild healthy"
// check. Now wraps in SiteLayout to verify the nav and footer render.

export default function TestPage() {
  return (
    <SiteLayout>
      <main className="min-h-[calc(100vh-300px)] flex items-center justify-center bg-cream px-6 py-16">
        <div className="max-w-xl text-center">
          <p className="text-xs uppercase tracking-widest text-gold font-medium mb-4">
            Phase 2 verification
          </p>
          <h1 className="font-serif text-5xl text-ink mb-6">
            Catalogue routes <em className="italic text-gold">live</em>
          </h1>
          <p className="text-ink-light text-base leading-relaxed mb-8">
            Phase 2 is shipped. Try the new category routes:
          </p>
          <div className="grid grid-cols-3 gap-3">
            <a href="/skincare" className="bg-warm-white border border-border rounded-2xl px-4 py-3 text-sm text-ink hover:border-gold transition-colors">Skincare</a>
            <a href="/makeup" className="bg-warm-white border border-border rounded-2xl px-4 py-3 text-sm text-ink hover:border-gold transition-colors">Makeup</a>
            <a href="/hair" className="bg-warm-white border border-border rounded-2xl px-4 py-3 text-sm text-ink hover:border-gold transition-colors">Hair</a>
          </div>
        </div>
      </main>
    </SiteLayout>
  );
}
