'use client';

// Re-opens the cookie preferences modal exposed by public/fmb-cookie-banner.js.
// globals.css omits @tailwind base, so reset UA button chrome explicitly.
export function CookieSettingsButton({ className = '' }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        const w = window as unknown as { FMBCookies?: { open: () => void } };
        w.FMBCookies?.open();
      }}
      className={`appearance-none border-0 bg-transparent p-0 cursor-pointer text-left ${className}`}
    >
      Cookie Settings
    </button>
  );
}
