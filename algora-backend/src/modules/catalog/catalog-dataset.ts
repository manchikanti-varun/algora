import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { parseLeetCodeUrl } from '../../lib/leetcodeUrl';
import { CatalogProblem } from '../../models';
import { classify, difficultyCode, metadataStatus, normalizeTopic, titleKey } from './catalog-shared';

/** One record of `data/leetcode/problems.json`. Exactly the metadata Algora may redistribute. */
export type DatasetProblem = {
  id: number;
  title: string;
  slug: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  url: string;
  isPremium: boolean;
  topics: string[];
  platform: 'leetcode';
};

export type DatasetMetadata = {
  datasetVersion: string;
  platform: 'leetcode';
  totalProblems: number;
  sourceUrl: string;
  sourceName?: string;
  license: string;
  retrievedAt: string;
  lastUpdated: string;
  checksum: { algorithm: 'sha256'; target: string; value: string };
  counts?: Record<string, number>;
  fields?: string[];
  excluded?: string[];
};

export type DatasetIssue = { index?: number; slug?: string; message: string };

const recordSchema = z.object({
  id: z.number().int().positive().max(99_999_999),
  title: z.string().trim().min(1).max(150),
  slug: z.string().trim().regex(/^[a-z0-9-]{1,100}$/, 'Slug must be lowercase letters, digits and dashes'),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']),
  url: z.string().trim().min(1).max(300),
  isPremium: z.boolean(),
  topics: z.array(z.string().trim().min(1).max(60)).max(30),
  platform: z.literal('leetcode'),
}).strict();

const metadataSchema = z.object({
  datasetVersion: z.string().trim().min(1).max(60),
  platform: z.literal('leetcode'),
  totalProblems: z.number().int().nonnegative(),
  sourceUrl: z.string().url(),
  sourceName: z.string().optional(),
  license: z.string().trim().min(1),
  retrievedAt: z.string().trim().min(1),
  lastUpdated: z.string().trim().min(1),
  checksum: z.object({ algorithm: z.literal('sha256'), target: z.string(), value: z.string().regex(/^[a-f0-9]{64}$/) }),
  counts: z.record(z.string(), z.number()).optional(),
  fields: z.array(z.string()).optional(),
  excluded: z.array(z.string()).optional(),
}).strict();

export type LoadedDataset = {
  dir: string;
  bytes: number;
  checksum: string;
  problems: DatasetProblem[];
  metadata: DatasetMetadata;
};

/** Locate `algora-backend/data/leetcode` from either the package directory or the repository root. */
export function datasetDir(): string {
  const cwd = process.cwd();
  const candidates = [path.join(cwd, 'data/leetcode'), path.join(cwd, 'algora-backend/data/leetcode')];
  const found = candidates.find((dir) => fs.existsSync(path.join(dir, 'problems.json')));
  return found ?? candidates[0];
}

export const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

/**
 * Parse and validate the dataset. Returns every valid problem plus per-record issues; callers decide
 * whether issues are fatal (the importer refuses a dataset with any issues).
 */
export function validateDataset(raw: unknown): { problems: DatasetProblem[]; issues: DatasetIssue[] } {
  if (!Array.isArray(raw)) return { problems: [], issues: [{ message: 'Dataset must be a JSON array of problem records' }] };
  const problems: DatasetProblem[] = [];
  const issues: DatasetIssue[] = [];
  const seenSlugs = new Map<string, number>();
  const seenIds = new Map<number, number>();
  for (const [index, entry] of raw.entries()) {
    const parsed = recordSchema.safeParse(entry);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'record'} ${issue.message}`).join('; ');
      issues.push({ index, message: details });
      continue;
    }
    const row = parsed.data;
    let canonical: { slug: string; url: string };
    try {
      canonical = parseLeetCodeUrl(row.url);
    } catch {
      issues.push({ index, slug: row.slug, message: 'URL must be an https://leetcode.com/problems/<slug>/ link' });
      continue;
    }
    if (canonical.slug !== row.slug || canonical.url !== row.url) {
      issues.push({ index, slug: row.slug, message: 'URL and slug disagree; URL must be the canonical problem link' });
      continue;
    }
    const firstSlugAt = seenSlugs.get(row.slug);
    if (firstSlugAt !== undefined) {
      issues.push({ index, slug: row.slug, message: `Duplicate slug (first seen at record ${firstSlugAt})` });
      continue;
    }
    const firstIdAt = seenIds.get(row.id);
    if (firstIdAt !== undefined) {
      issues.push({ index, slug: row.slug, message: `Duplicate problem number ${row.id} (first seen at record ${firstIdAt})` });
      continue;
    }
    seenSlugs.set(row.slug, index);
    seenIds.set(row.id, index);
    problems.push(row);
  }
  return { problems, issues };
}

export function summarizeProblems(problems: DatasetProblem[]) {
  const count = (predicate: (row: DatasetProblem) => boolean) => problems.filter(predicate).length;
  const numbers = problems.map((row) => row.id).sort((a, b) => a - b);
  const highest = numbers.at(-1) ?? 0;
  const present = new Set(numbers);
  let missingNumbers = 0;
  for (let value = 1; value <= highest; value++) if (!present.has(value)) missingNumbers++;
  return {
    total: problems.length,
    easy: count((row) => row.difficulty === 'Easy'),
    medium: count((row) => row.difficulty === 'Medium'),
    hard: count((row) => row.difficulty === 'Hard'),
    free: count((row) => !row.isPremium),
    premium: count((row) => row.isPremium),
    withoutTopics: count((row) => row.topics.length === 0),
    lowestNumber: numbers[0] ?? null,
    highestNumber: highest || null,
    missingNumbers,
  };
}

/** Read both dataset files and check metadata against the actual payload. */
export function loadDataset(dir = datasetDir()): { loaded: LoadedDataset; issues: DatasetIssue[] } {
  const problemsFile = path.join(dir, 'problems.json');
  const metadataFile = path.join(dir, 'metadata.json');
  if (!fs.existsSync(problemsFile)) throw new Error(`Dataset file not found: ${problemsFile}`);
  if (!fs.existsSync(metadataFile)) throw new Error(`Dataset metadata not found: ${metadataFile}`);
  const bytes = fs.readFileSync(problemsFile);
  const checksum = sha256(bytes);
  let raw: unknown;
  let rawMetadata: unknown;
  try { raw = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('problems.json is not valid JSON'); }
  try { rawMetadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8')); } catch { throw new Error('metadata.json is not valid JSON'); }
  const parsedMetadata = metadataSchema.safeParse(rawMetadata);
  if (!parsedMetadata.success) {
    const details = parsedMetadata.error.issues.map((issue) => `${issue.path.join('.') || 'metadata'} ${issue.message}`).join('; ');
    throw new Error(`metadata.json is invalid: ${details}`);
  }
  const { problems, issues } = validateDataset(raw);
  const metadata = parsedMetadata.data;
  if (metadata.checksum.value !== checksum) {
    issues.push({ message: `Checksum mismatch: metadata.json says ${metadata.checksum.value}, problems.json is ${checksum}` });
  }
  if (metadata.totalProblems !== problems.length) {
    issues.push({ message: `totalProblems is ${metadata.totalProblems} but ${problems.length} valid records were read` });
  }
  const actual = summarizeProblems(problems);
  for (const [key, expected] of Object.entries(metadata.counts ?? {})) {
    const value = (actual as Record<string, unknown>)[key];
    if (typeof value === 'number' && value !== expected) issues.push({ message: `metadata count ${key} is ${expected}, actual ${value}` });
  }
  return { loaded: { dir, bytes: bytes.length, checksum, problems, metadata }, issues };
}

/** Added, removed and field-level changes between two dataset snapshots (for the update workflow). */
export function compareDatasets(previous: DatasetProblem[], current: DatasetProblem[]) {
  const before = new Map(previous.map((row) => [row.slug, row]));
  const after = new Map(current.map((row) => [row.slug, row]));
  const added = current.filter((row) => !before.has(row.slug)).map((row) => ({ id: row.id, slug: row.slug, title: row.title }));
  const removed = previous.filter((row) => !after.has(row.slug)).map((row) => ({ id: row.id, slug: row.slug, title: row.title }));
  const modified: { id: number; slug: string; fields: string[] }[] = [];
  for (const row of current) {
    const old = before.get(row.slug);
    if (!old) continue;
    const fields = (Object.keys(row) as (keyof DatasetProblem)[]).filter((key) => JSON.stringify(old[key]) !== JSON.stringify(row[key]));
    if (fields.length) modified.push({ id: row.id, slug: row.slug, fields });
  }
  return { added, removed, modified };
}

export type ImportCounts = { INSERT: number; UPDATE: number; UNCHANGED: number; NUMBER_CONFLICT: number; WRITE_ERROR: number };

export type ImportSummary = {
  applied: boolean;
  datasetVersion: string;
  source: string;
  total: number;
  counts: ImportCounts;
  conflicts: { slug: string; problemNumber: number; existingSlug?: string }[];
  errors: { slug: string; message: string }[];
  /** Existing catalog rows that received the platform field during this import. */
  platformBackfilled: number;
  durationMs: number;
  after?: { catalogTotal: number; numbered: number; storageBytes?: number; dataBytes?: number; indexBytes?: number };
};

/**
 * Upsert the dataset into the MongoDB catalog. Only ever inserts/updates catalog metadata: chapter
 * assignments, custom catalog rows and submission evidence are never deleted or rewritten.
 */
export async function importCatalog(
  problems: DatasetProblem[],
  opts: { version: string; dryRun: boolean; batchSize?: number },
): Promise<ImportSummary> {
  const started = Date.now();
  const source = `leetcode-dataset@${opts.version}`;
  const desired = problems.map((row) => {
    const topics = [...new Set(row.topics.map(normalizeTopic))];
    const problemNumber = row.id;
    return {
      platform: 'leetcode' as const,
      slug: row.slug,
      url: row.url,
      title: row.title,
      titleKey: titleKey(row.title),
      difficulty: difficultyCode(row.difficulty),
      problemNumber,
      topics,
      isPremium: row.isPremium,
      source,
      metadataStatus: metadataStatus({ problemNumber, topics, isPremium: row.isPremium }),
    };
  });
  const slugs = desired.map((row) => row.slug);
  const numbers = desired.map((row) => row.problemNumber);
  const existing = await CatalogProblem.find({ platform: 'leetcode', slug: { $in: slugs } })
    .select('slug url title difficulty problemNumber topics isPremium source').lean();
  const bySlug = new Map(existing.map((row) => [row.slug, row]));
  const owners = await CatalogProblem.find({ platform: 'leetcode', problemNumber: { $in: numbers }, slug: { $nin: slugs } })
    .select('slug problemNumber').lean();
  const ownerByNumber = new Map(owners.map((row) => [row.problemNumber as number, row.slug]));

  const counts: ImportCounts = { INSERT: 0, UPDATE: 0, UNCHANGED: 0, NUMBER_CONFLICT: 0, WRITE_ERROR: 0 };
  const conflicts: ImportSummary['conflicts'] = [];
  const errors: ImportSummary['errors'] = [];
  const pending: typeof desired = [];
  for (const row of desired) {
    const owner = ownerByNumber.get(row.problemNumber);
    if (owner) {
      counts.NUMBER_CONFLICT++;
      conflicts.push({ slug: row.slug, problemNumber: row.problemNumber, existingSlug: owner });
      continue;
    }
    const current = bySlug.get(row.slug);
    const status = classify(current, row);
    counts[status]++;
    if (status !== 'UNCHANGED') pending.push(row);
  }

  let platformBackfilled = 0;
  if (!opts.dryRun) {
    // Rows created before the platform field existed would otherwise be duplicated by the upsert.
    const legacy = await CatalogProblem.updateMany(
      { platform: { $exists: false } }, { $set: { platform: 'leetcode' } }, { timestamps: false },
    );
    platformBackfilled = legacy.modifiedCount;
    if (pending.length) {
      await CatalogProblem.createIndexes();
      const size = opts.batchSize ?? 500;
      for (let offset = 0; offset < pending.length; offset += size) {
        const batch = pending.slice(offset, offset + size);
        try {
          await CatalogProblem.bulkWrite(batch.map((row) => ({
            updateOne: { filter: { platform: row.platform, slug: row.slug }, update: { $set: row }, upsert: true },
          })), { ordered: false });
        } catch (error) {
          // Ordered:false runs every op; report the failures rather than aborting the import.
          const writeErrors = (error as { writeErrors?: { errmsg?: string; err?: { errmsg?: string }; index?: number }[] }).writeErrors ?? [];
          for (const failure of writeErrors) {
            const row = batch[failure.index ?? -1];
            counts.WRITE_ERROR++;
            errors.push({ slug: row?.slug ?? 'unknown', message: failure.errmsg ?? failure.err?.errmsg ?? 'Write failed' });
          }
          if (!writeErrors.length) throw error;
        }
      }
    }
  }

  let after: ImportSummary['after'];
  if (!opts.dryRun) {
    const [catalogTotal, numbered] = await Promise.all([
      CatalogProblem.countDocuments(),
      CatalogProblem.countDocuments({ problemNumber: { $exists: true } }),
    ]);
    let storageBytes: number | undefined;
    let dataBytes: number | undefined;
    let indexBytes: number | undefined;
    try {
      const stats = await CatalogProblem.db.db!.command({ collStats: CatalogProblem.collection.name }) as {
        storageSize?: number; size?: number; totalIndexSize?: number;
      };
      storageBytes = stats.storageSize;
      dataBytes = stats.size;
      indexBytes = stats.totalIndexSize;
    } catch { /* stats are informational only */ }
    after = { catalogTotal, numbered, storageBytes, dataBytes, indexBytes };
  }

  return {
    applied: !opts.dryRun, datasetVersion: opts.version, source, total: problems.length,
    counts, conflicts, errors, platformBackfilled, durationMs: Date.now() - started, after,
  };
}
