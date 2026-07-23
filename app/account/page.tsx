import type { Metadata } from 'next';
import { SiteNav } from '../../components/SiteNav';
import { SiteFooter } from '../../components/SiteLayout';
import { createAuthServerClient } from '../../lib/supabase-auth-server';
import LoginCard from './LoginCard';
import AccountRoutine, { type RoutineRow } from './AccountRoutine';

// Session comes from cookies, so this page can never be static.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your account | FindMyBasket',
  description:
    'Sign in to manage your saved routine and see price changes across UK retailers.',
  robots: { index: false, follow: false },
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const supabase = createAuthServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let routine: RoutineRow[] = [];
  if (user) {
    const { data, error } = await supabase.rpc('fmb_get_routine');
    if (error) {
      console.error('fmb_get_routine failed:', error.message);
    } else {
      routine = (data ?? []) as RoutineRow[];
    }
  }

  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-site px-4 py-10 min-h-[60vh]">
        {user ? (
          <AccountRoutine initialRoutine={routine} email={user.email ?? ''} />
        ) : (
          <LoginCard linkError={searchParams.error === 'link'} />
        )}
      </main>
      <SiteFooter />
    </>
  );
}
