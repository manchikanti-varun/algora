'use client';
import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; use_fedcm_for_prompt?: boolean; ux_mode?: string }) => void;
      renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
    } } };
  }
}
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

export function GoogleSignIn({ onCredential }: { onCredential: (idToken: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(CLIENT_ID ? null : 'Google sign-in is not configured (NEXT_PUBLIC_GOOGLE_CLIENT_ID is missing).');
  const cb = useRef(onCredential);
  useEffect(() => { cb.current = onCredential; });
  useEffect(() => {
    if (!CLIENT_ID) return;
    const init = () => {
      if (!window.google || !ref.current) return;
      window.google.accounts.id.initialize({ client_id: CLIENT_ID, callback: (r) => cb.current(r.credential), use_fedcm_for_prompt: true });
      window.google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', width: 300 });
    };
    if (window.google) return init();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = init;
    s.onerror = () => setError('Could not load Google sign-in. Check your connection or content blockers.');
    document.head.appendChild(s);
  }, []);
  return (
    <div>
      <div ref={ref} aria-label="Continue with Google" className="min-h-11" />
      {error && <p role="alert" className="mt-2 text-sm text-rose-600">{error}</p>}
    </div>
  );
}
