interface Draft { values: Record<string, string>; expiresAt: number }
const drafts = new Map<string, Draft>();
export function readAiDraft(key: string) {
  const draft = drafts.get(key);
  if (!draft || draft.expiresAt <= Date.now()) return {};
  return draft.values;
}
export function rememberAiDraft(key: string, values: Record<string, string>) {
  drafts.delete(key);
  const safe = Object.fromEntries(Object.entries(values).map(([field, value]) => [field, value
    .replace(/\b(?:gsk_|sk-|ghp_|AKIA|AIza)[\w-]{12,}\b/g, '[redacted credential]')
    .replace(/\bBearer\s+[^\s]+|\beyJ[\w-]+\.[\w-]+\.[\w-]+/gi, '[redacted credential]')
    .replace(/\b(?:password|secret|api[_ -]?key|token)\s*[:=]\s*["']?[^\s"';,]+/gi, '[redacted credential]')]));
  drafts.set(key, { values: safe, expiresAt: Date.now() + 3600000 });
  if (drafts.size > 12) drafts.delete(drafts.keys().next().value!);
}
export function clearAiDrafts() { drafts.clear(); }
