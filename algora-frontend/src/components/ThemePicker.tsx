'use client';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Menu, type MenuItem } from './ui';
export type Theme = 'light' | 'dark' | 'system';
const themeEvent = 'algora:theme';
function currentTheme(): Theme {
  const value = document.documentElement.dataset.theme;
  return value === 'light' || value === 'dark' ? value : 'system';
}
function subscribe(callback: () => void) {
  window.addEventListener(themeEvent, callback);
  return () => window.removeEventListener(themeEvent, callback);
}
export function setTheme(value: Theme) {
  document.documentElement.dataset.theme = value;
  try { localStorage.setItem('algora.theme', value); } catch { /* the choice still applies for this session */ }
  window.dispatchEvent(new Event(themeEvent));
}
export const useTheme = () => useSyncExternalStore(subscribe, currentTheme, (): Theme => 'system');
const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'System', icon: Monitor }, { value: 'light', label: 'Light', icon: Sun }, { value: 'dark', label: 'Dark', icon: Moon },
];
/** Theme entries for an account menu. */
export function themeMenuItems(theme: Theme): MenuItem[] {
  return OPTIONS.map((o) => ({
    label: `${o.label} theme`, icon: theme === o.value ? <Check size={15} aria-hidden /> : <o.icon size={15} aria-hidden />, onSelect: () => setTheme(o.value),
  }));
}
/** Stand-alone theme control (public pages). */
export function ThemePicker() {
  const theme = useTheme();
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return <Menu label="Color theme" icon={<Icon size={16} aria-hidden />} items={themeMenuItems(theme)} />;
}
