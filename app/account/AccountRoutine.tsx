'use client';

// Signed-in account view: the tracked routine, editable in place.
//   add     -> fmb_track_product(product_id, slot, note)
//   remove  -> fmb_untrack_product(product_id)
//   edits   -> direct UPDATE on tracked_products (RLS owner policy scopes it;
//              fmb_track_product is add-only ON CONFLICT DO NOTHING, so
//              re-calling it cannot change slot/note on an existing row)
//   alerts  -> fmb_mark_alerts_seen(product_id?) — null marks all seen

import { useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

export interface RoutineRow {
  tracked_id: number;
  product_id: number;
  name: string;
  brand: string | null;
  image_url: string | null;
  slot: string | null;
  note: string | null;
  added_at: string;
  baseline_price: number | null;
  baseline_captured_at: string | null;
  current_price: number | null;
  current_retailer_id: number | null;
  current_retailer_name: string | null;
  delta_abs: number | null;
  delta_pct: number | null;
  in_stock_now: boolean | null;
  unseen_alerts: number;
  best_alert_price: number | null;
}

interface SearchProduct {
  id: number;
  name: string;
  brand: string | null;
  image_url: string | null;
}

const gbp = (v: number | null | undefined) =>
  v == null ? '—' : `£${Number(v).toFixed(2)}`;

export default function AccountRoutine({
  initialRoutine,
  email,
  initialAlertsEnabled = true,
}: {
  initialRoutine: RoutineRow[];
  email: string;
  initialAlertsEnabled?: boolean;
}) {
  const [routine, setRoutine] = useState<RoutineRow[]>(initialRoutine);
  const [busy, setBusy] = useState<number | null>(null); // product_id being mutated
  const [error, setError] = useState<string | null>(null);

  // Email price-drop alerts on/off. Optimistic toggle backed by fmb_set_alert_prefs.
  const [alertsEnabled, setAlertsEnabled] = useState(initialAlertsEnabled);
  const [alertsBusy, setAlertsBusy] = useState(false);

  const toggleAlerts = async () => {
    const next = !alertsEnabled;
    setAlertsBusy(true);
    setAlertsEnabled(next); // optimistic
    const { data, error: err } = await supabaseBrowser.rpc('fmb_set_alert_prefs', {
      p_enabled: next,
    });
    setAlertsBusy(false);
    if (err) {
      console.error('fmb_set_alert_prefs failed:', err.message);
      setAlertsEnabled(!next); // revert
      setError('Could not update your alert setting. Please try again.');
      return;
    }
    // Trust the server's returned row over the optimistic value.
    if (data && typeof (data as { email_alerts_enabled?: boolean }).email_alerts_enabled === 'boolean') {
      setAlertsEnabled((data as { email_alerts_enabled: boolean }).email_alerts_enabled);
    }
  };

  // ── data helpers ──────────────────────────────────────────────────────

  const refresh = async () => {
    const { data, error: err } = await supabaseBrowser.rpc('fmb_get_routine');
    if (err) {
      console.error('fmb_get_routine failed:', err.message);
      return;
    }
    setRoutine((data ?? []) as RoutineRow[]);
  };

  const untrack = async (productId: number) => {
    setBusy(productId);
    setError(null);
    const { error: err } = await supabaseBrowser.rpc('fmb_untrack_product', {
      p_product_id: productId,
    });
    setBusy(null);
    if (err) {
      console.error('fmb_untrack_product failed:', err.message);
      setError('Could not remove that product. Please try again.');
      return;
    }
    setRoutine(r => r.filter(row => row.product_id !== productId));
  };

  const saveEdit = async (productId: number, slot: string, note: string) => {
    const row = routine.find(r => r.product_id === productId);
    const nextSlot = slot.trim() || null;
    const nextNote = note.trim() || null;
    if (row && row.slot === nextSlot && row.note === nextNote) return;
    const { error: err } = await supabaseBrowser
      .from('tracked_products')
      .update({ slot: nextSlot, note: nextNote })
      .eq('product_id', productId);
    if (err) {
      console.error('tracked_products update failed:', err.message);
      setError('Could not save your changes. Please try again.');
      return;
    }
    setRoutine(r =>
      r.map(x => (x.product_id === productId ? { ...x, slot: nextSlot, note: nextNote } : x))
    );
  };

  const markSeen = async (productId?: number) => {
    const { error: err } = await supabaseBrowser.rpc('fmb_mark_alerts_seen', {
      p_product_id: productId ?? null,
    });
    if (err) {
      console.error('fmb_mark_alerts_seen failed:', err.message);
      return;
    }
    setRoutine(r =>
      r.map(x =>
        productId == null || x.product_id === productId ? { ...x, unseen_alerts: 0 } : x
      )
    );
  };

  const track = async (productId: number) => {
    setBusy(productId);
    setError(null);
    const { error: err } = await supabaseBrowser.rpc('fmb_track_product', {
      p_product_id: productId,
    });
    setBusy(null);
    if (err) {
      console.error('fmb_track_product failed:', err.message);
      setError('Could not add that product. Please try again.');
      return;
    }
    if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
      (window as any).gtag('event', 'track_product', { source: 'account' });
    }
    await refresh();
  };

  const signOut = async () => {
    await supabaseBrowser.auth.signOut();
    window.location.href = '/';
  };

  const totalUnseen = routine.reduce((n, r) => n + Number(r.unseen_alerts || 0), 0);

  // ── add-product search ────────────────────────────────────────────────

  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SearchProduct[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setMatches([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const json = await res.json();
        setMatches((json.products ?? []).slice(0, 6));
      } catch {
        /* typeahead failures are non-fatal */
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const tracked = new Set(routine.map(r => r.product_id));

  // ── render ────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl text-ink">Your routine</h1>
          <p className="mt-1 text-sm text-ink-light">Signed in as {email}</p>
        </div>
        <div className="flex items-center gap-4">
          {totalUnseen > 0 && (
            <button
              onClick={() => markSeen()}
              className="rounded border border-gold px-3 py-1.5 text-sm text-ink hover:bg-gold-light"
            >
              Mark all {totalUnseen} price alert{totalUnseen === 1 ? '' : 's'} read
            </button>
          )}
          <button
            onClick={signOut}
            className="text-sm text-ink-light underline hover:text-ink"
          >
            Sign out
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* email price-drop alerts toggle */}
      <div className="mt-6 flex items-start justify-between gap-4 rounded-lg border border-border bg-warm-white p-4">
        <div>
          <p className="font-medium text-ink">Email me when prices drop</p>
          <p className="mt-1 text-sm text-ink-light">
            We&apos;ll email you when a product in your routine gets cheaper across UK
            retailers. No more than one email a day.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={alertsEnabled}
          aria-label="Email me when prices drop"
          disabled={alertsBusy}
          onClick={toggleAlerts}
          className={`relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            alertsEnabled ? 'bg-sage' : 'bg-border'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              alertsEnabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {/* add a product */}
      <div className="relative mt-6 max-w-lg">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search to add a product…"
          className="w-full rounded border border-border bg-white px-3 py-2 text-ink focus:border-gold focus:outline-none"
        />
        {matches.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded border border-border bg-white shadow-lg">
            {matches.map(p => (
              <li key={p.id}>
                <button
                  disabled={tracked.has(p.id) || busy === p.id}
                  onClick={async () => {
                    await track(p.id);
                    setQuery('');
                    setMatches([]);
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-cream disabled:opacity-50"
                >
                  {p.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_url} alt="" className="h-8 w-8 rounded object-cover" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">
                    {p.brand ? `${p.brand} — ` : ''}
                    {p.name}
                  </span>
                  {tracked.has(p.id) && (
                    <span className="text-xs text-ink-light">already tracked</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* the routine */}
      {routine.length === 0 ? (
        <p className="mt-10 text-ink-light">
          Nothing tracked yet. Search above to add products, or build a routine
          in the{' '}
          <a href="/app" className="underline">
            routine builder
          </a>{' '}
          and save it.
        </p>
      ) : (
        <ul className="mt-8 space-y-4">
          {routine.map(row => (
            <RoutineCard
              key={row.tracked_id}
              row={row}
              busy={busy === row.product_id}
              onRemove={() => untrack(row.product_id)}
              onMarkSeen={() => markSeen(row.product_id)}
              onSaveEdit={(slot, note) => saveEdit(row.product_id, slot, note)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RoutineCard({
  row,
  busy,
  onRemove,
  onMarkSeen,
  onSaveEdit,
}: {
  row: RoutineRow;
  busy: boolean;
  onRemove: () => void;
  onMarkSeen: () => void;
  onSaveEdit: (slot: string, note: string) => void;
}) {
  const [slot, setSlot] = useState(row.slot ?? '');
  const [note, setNote] = useState(row.note ?? '');

  const drop =
    row.delta_abs != null && row.delta_abs < 0 ? true : row.delta_abs != null ? false : null;

  return (
    <li className="rounded-lg border border-border bg-warm-white p-4">
      <div className="flex items-start gap-4">
        {row.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.image_url}
            alt=""
            className="h-16 w-16 shrink-0 rounded object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <a
              href={`/product/${row.product_id}`}
              className="font-medium text-ink hover:underline"
            >
              {row.brand ? `${row.brand} — ` : ''}
              {row.name}
            </a>
            {row.unseen_alerts > 0 && (
              <button
                onClick={onMarkSeen}
                title="Mark seen"
                className="rounded-full bg-gold px-2 py-0.5 text-xs font-medium text-ink hover:opacity-80"
              >
                {row.unseen_alerts} new alert{row.unseen_alerts === 1 ? '' : 's'}
              </button>
            )}
          </div>

          <p className="mt-1 text-sm text-ink-light">
            {row.current_price != null ? (
              <>
                Now {gbp(row.current_price)}
                {row.current_retailer_name ? ` at ${row.current_retailer_name}` : ''}
                {row.in_stock_now === false && ' · out of stock'}
              </>
            ) : (
              'No live price right now'
            )}
            {row.baseline_price != null && (
              <> · tracked since {gbp(row.baseline_price)}</>
            )}
            {drop != null && row.delta_pct != null && Number(row.delta_pct) !== 0 && (
              <span className={drop ? 'text-green-700' : 'text-red-700'}>
                {' '}
                ({drop ? '↓' : '↑'} {Math.abs(Number(row.delta_pct)).toFixed(0)}%)
              </span>
            )}
          </p>

          <div className="mt-3 flex flex-wrap gap-3">
            <input
              value={slot}
              onChange={e => setSlot(e.target.value)}
              onBlur={() => onSaveEdit(slot, note)}
              placeholder="Slot (e.g. AM cleanser)"
              className="w-44 rounded border border-border bg-white px-2 py-1 text-sm text-ink focus:border-gold focus:outline-none"
            />
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              onBlur={() => onSaveEdit(slot, note)}
              placeholder="Note"
              className="min-w-44 flex-1 rounded border border-border bg-white px-2 py-1 text-sm text-ink focus:border-gold focus:outline-none"
            />
          </div>
        </div>
        <button
          onClick={onRemove}
          disabled={busy}
          className="shrink-0 text-sm text-ink-light underline hover:text-ink disabled:opacity-50"
        >
          Remove
        </button>
      </div>
    </li>
  );
}
