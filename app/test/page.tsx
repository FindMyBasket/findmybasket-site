// Test page at /test - exists only to prove Next.js is rendering.
// Once Phase 1 is verified working, we can delete this and build the
// real catalogue routes.

export default function TestPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-cream px-6">
      <div className="max-w-xl text-center">
        <p className="text-xs uppercase tracking-widest text-gold font-medium mb-4">
          Phase 1 verification
        </p>
        <h1 className="font-serif text-5xl text-ink mb-6">
          Next.js is <em className="italic text-gold">live</em>
        </h1>
        <p className="text-ink-light text-base leading-relaxed mb-8">
          This route is rendered by Next.js. The rest of FindMyBasket
          continues to serve from the existing static HTML files.
        </p>
        <div className="bg-warm-white border border-border rounded-2xl p-6 text-left">
          <p className="text-sm text-ink-light mb-3">
            <span className="font-medium text-ink">Design tokens loaded:</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <span className="px-3 py-1 text-xs rounded-full bg-cream border border-border">cream</span>
            <span className="px-3 py-1 text-xs rounded-full bg-ink text-cream">ink</span>
            <span className="px-3 py-1 text-xs rounded-full bg-gold text-white">gold</span>
            <span className="px-3 py-1 text-xs rounded-full bg-sage text-white">sage</span>
          </div>
        </div>
      </div>
    </main>
  );
}
