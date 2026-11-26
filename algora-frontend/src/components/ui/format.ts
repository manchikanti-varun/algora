/** Formatting helpers. All user-visible dates go through these so wording stays consistent. */
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
/** "SYNC_SUCCESS" -> "Sync success". Fallback only; prefer the labels in lib/status.ts. */
export const human = (s: string) => s.replace(/[_.]/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const fmtDate = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const fmtDateTime = (d?: string | Date | null) => (d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtTime = (d?: string | Date | null) => (d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
export function timeAgo(d?: string | Date | null) {
  if (!d) return 'never';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 0) return 'just now';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(d);
}
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 10) / 10}%`);
