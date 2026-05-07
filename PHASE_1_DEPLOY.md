# Phase 1 deploy guide

## What this is

The minimum scaffolding to get Next.js running in your repo without breaking
the existing site. After deploying this, your live site at findmybasket.co.uk
keeps working, and a new `/test` route renders a Next.js page proving the
setup is alive.

## Files included

```
package.json              # Next.js + React + TypeScript dependencies
next.config.js            # Next.js config with image domains
tsconfig.json             # TypeScript config
postcss.config.js         # PostCSS for Tailwind
tailwind.config.ts        # Tailwind with FindMyBasket design tokens
vercel.json               # Updated routes (replaces existing vercel.json)
app/globals.css           # Tailwind base + body styling
app/layout.tsx            # Root HTML shell with Google Fonts
app/page.tsx              # Root redirect to existing /index.html
app/test/page.tsx         # Test page proving Next.js is alive
.gitignore-additions      # Lines to merge into your .gitignore
```

## Deploy steps

1. Create a new branch in your repo called `nextjs-rebuild`
2. Add all the files above to the branch
3. Replace your existing `vercel.json` with the one in this scaffold
4. Append the contents of `.gitignore-additions` to your existing `.gitignore`
5. Commit and push

Vercel will auto-detect Next.js (because it sees `package.json` with `next`)
and build a preview deploy. The preview URL will be something like
`findmybasket-git-nextjs-rebuild-yourname.vercel.app`.

## Verification checklist

After preview deploys, check:

1. Preview homepage loads (the existing index.html)
2. `<preview-url>/test` shows the Next.js test page with the gold "Phase 1
   verification" badge and design tokens displayed
3. `<preview-url>/cerave-cheapest-uk.html` still serves the existing article
4. `<preview-url>/app.html` still serves the routine builder
5. `<preview-url>/partners` redirects to `/partners.html`

If all 5 pass, Phase 1 is verified. Merge to main when ready.

## Common issues

**Build fails with "Couldn't find any pages"**
- Vercel might be looking in the wrong directory. Check Vercel project settings:
  Root Directory should be empty (use repo root)

**Vercel builds but shows 404 on /test**
- The Next.js app directory might not be detected. Verify `app/page.tsx` and
  `app/test/page.tsx` exist at the repo root, NOT inside a subfolder

**Existing /index.html doesn't load anymore**
- The Next.js root page is taking over. Verify `vercel.json` rewrites haven't
  removed the static fallback behaviour

## What this does NOT do yet

- No catalogue routes (Phase 2)
- No real homepage in Next.js (existing static one stays)
- No category pages, brand pages, product pages
- No Supabase queries
- No styled nav or footer in Next.js (will come with first real route)

This is just "Next.js can render in our Vercel deploy." Phase 2 builds the
first real catalogue page.
