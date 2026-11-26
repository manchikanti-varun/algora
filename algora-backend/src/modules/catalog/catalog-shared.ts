/** Canonicalisation rules shared by the catalog API, the dataset validator and the importer. */
export const titleKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
export const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const normalizeTopic = (value: string) => titleKey(value);
export const difficultyCode = (value: string) => value.trim().toUpperCase() as 'EASY' | 'MEDIUM' | 'HARD';
export const metadataStatus = (row: { problemNumber?: number; topics: string[]; isPremium?: boolean }): 'PARTIAL' | 'AVAILABLE' =>
  row.problemNumber !== undefined && row.topics.length > 0 && row.isPremium !== undefined ? 'AVAILABLE' : 'PARTIAL';

/** Buckets a dataset against the catalog's existing content: insert, update or unchanged. */
type Comparable = {
  title: string; difficulty: string; url: string; topics: string[];
  isPremium?: boolean | null; problemNumber?: number | null; source: string;
};

export function classify(existing: Comparable | undefined, desired: Comparable): 'INSERT' | 'UPDATE' | 'UNCHANGED' {
  if (!existing) return 'INSERT';
  const sameTopics = [...existing.topics].sort().join('|') === [...desired.topics].sort().join('|');
  const same =
    existing.title === desired.title &&
    existing.difficulty === desired.difficulty &&
    existing.url === desired.url &&
    existing.problemNumber === desired.problemNumber &&
    existing.isPremium === desired.isPremium &&
    existing.source === desired.source &&
    sameTopics;
  return same ? 'UNCHANGED' : 'UPDATE';
}
