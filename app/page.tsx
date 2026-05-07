import { redirect } from 'next/navigation';

// During the rebuild, the live homepage is the existing static index.html.
// The Next.js root redirects to it. Once we build a proper homepage in
// Next.js (Phase 7+), we replace this with a real page component.
export default function HomePage() {
  redirect('/index.html');
}
