'use client';

import { SunMoon } from 'lucide-react';
import { useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark' | 'system';
const themeEvent = 'algora:theme';

function currentTheme(): Theme {
  const value = document.documentElement.dataset.theme;
  return value === 'light' || value === 'dark' ? value : 'system';
}

function subscribe(callback: () => void) {
  window.addEventListener(themeEvent, callback);
  return () => window.removeEventListener(themeEvent, callback);
}

export function ThemePicker() {
  const theme = useSyncExternalStore(subscribe, currentTheme, (): Theme => 'system');
  return <label className="flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-1.5 py-1 text-sm text-slate-700">
    <SunMoon size={15} aria-hidden="true" />
    <span className="sr-only">Color theme</span>
    <select value={theme} className="rounded bg-white text-xs focus-visible:outline-2 focus-visible:outline-indigo-600"
      onChange={(event) => {
        const value = event.target.value as Theme;
        document.documentElement.dataset.theme = value;
        try { localStorage.setItem('algora.theme', value); } catch { /* The session preference still works. */ }
        window.dispatchEvent(new Event(themeEvent));
      }}>
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </label>;
}
