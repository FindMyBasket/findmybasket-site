'use client';

// Magic-link sign-in card. No passwords: signInWithOtp emails a link that
// lands on /auth/confirm, which establishes the session and claims any
// legacy email-keyed routine.

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function LoginCard({ linkError }: { linkError?: boolean }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = email.trim().toLowerCase();
    if (!addr.includes('@') || !addr.includes('.')) {
      setErrorMsg('Please enter a valid email address.');
      setStatus('error');
      return;
    }
    setStatus('sending');
    setErrorMsg(null);
    const { error } = await supabaseBrowser.auth.signInWithOtp({ email: addr });
    if (error) {
      console.error('signInWithOtp failed:', error.message);
      setErrorMsg('Could not send the sign-in link. Please try again in a minute.');
      setStatus('error');
      return;
    }
    setStatus('sent');
  };

  return (
    <div className="mx-auto max-w-md rounded-lg border border-border bg-warm-white p-8">
      <h1 className="font-serif text-3xl text-ink">Your account</h1>
      <p className="mt-3 text-ink-light">
        Sign in with your email to manage your saved routine and see price
        changes across UK retailers. No password needed — we email you a
        sign-in link.
      </p>

      {linkError && status === 'idle' && (
        <p className="mt-4 rounded border border-border bg-cream p-3 text-sm text-ink">
          That sign-in link has expired or was already used. Enter your email
          for a fresh one.
        </p>
      )}

      {status === 'sent' ? (
        <p className="mt-6 rounded border border-sage bg-sage-light p-4 text-ink">
          Check your inbox — we&apos;ve sent a sign-in link to{' '}
          <strong>{email.trim().toLowerCase()}</strong>. The link is valid for
          one hour.
        </p>
      ) : (
        <form onSubmit={sendLink} className="mt-6">
          <label htmlFor="account-email" className="block text-sm font-medium text-ink">
            Email address
          </label>
          <input
            id="account-email"
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-2 w-full rounded border border-border bg-white px-3 py-2 text-ink focus:border-gold focus:outline-none"
          />
          <button
            type="submit"
            disabled={status === 'sending'}
            className="mt-4 w-full rounded bg-ink px-4 py-2.5 font-medium text-cream transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {status === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
          </button>
          {status === 'error' && errorMsg && (
            <p className="mt-3 text-sm text-red-700">{errorMsg}</p>
          )}
        </form>
      )}
    </div>
  );
}
