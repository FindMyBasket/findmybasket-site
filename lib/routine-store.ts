// Client-side routine store. The routine lives in localStorage so it persists
// across pages, sessions, and the boundary between the Next.js side of the
// site and the legacy /app.html routine builder.
//
// Storage key: fmb_routine
// Value: JSON array of { id, name, brand, category }

export interface RoutineItem {
  id: number;
  name: string;
  brand: string;
  category: string;
}

const KEY = 'fmb_routine';
const EVENT = 'fmb_routine_change';

function safeRead(): RoutineItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (it): it is RoutineItem =>
        typeof it === 'object' &&
        it !== null &&
        typeof it.id === 'number' &&
        typeof it.name === 'string'
    );
  } catch {
    return [];
  }
}

function safeWrite(items: RoutineItem[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
    // Notify other components on the same page
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    // Quota exceeded or storage disabled - silently no-op
  }
}

export function getRoutine(): RoutineItem[] {
  return safeRead();
}

export function addToRoutine(item: RoutineItem): { added: boolean; total: number } {
  const items = safeRead();
  if (items.find(p => p.id === item.id)) {
    return { added: false, total: items.length };
  }
  items.push(item);
  safeWrite(items);
  return { added: true, total: items.length };
}

export function removeFromRoutine(id: number): { total: number } {
  const items = safeRead().filter(p => p.id !== id);
  safeWrite(items);
  return { total: items.length };
}

export function clearRoutine() {
  safeWrite([]);
}

export function isInRoutine(id: number): boolean {
  return safeRead().some(p => p.id === id);
}

// Subscribe to changes - returns an unsubscribe function
export function onRoutineChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const wrapped = () => handler();
  window.addEventListener(EVENT, wrapped);
  // Also listen for cross-tab/cross-page localStorage changes
  const storageHandler = (e: StorageEvent) => {
    if (e.key === KEY) handler();
  };
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(EVENT, wrapped);
    window.removeEventListener('storage', storageHandler);
  };
}

// Build a URL to send the user to the routine builder with the current
// routine pre-loaded. The legacy /app.html supports ?routine=id1,id2,id3
export function buildRoutineUrl(): string {
  const items = safeRead();
  if (items.length === 0) return '/app.html';
  const ids = items.map(p => p.id).join(',');
  return `/app.html?routine=${ids}`;
}
