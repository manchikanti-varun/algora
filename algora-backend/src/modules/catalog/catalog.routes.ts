import { Router } from 'express';
import { z } from 'zod';
import { parseCsv, toCsv, MAX_CSV_ROWS } from '../../lib/csv';
import { badRequest, forbidden, notFound, parse } from '../../lib/errors';
import { parseLeetCodeUrl } from '../../lib/leetcodeUrl';
import { maybeTransaction, supportsTransactions } from '../../lib/lease';
import { objectId, pagination } from '../../lib/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { CatalogProblem, Chapter, Problem } from '../../models';
import { canManageCourses } from '../access';
import { audit } from '../audit/audit';
import { escapeRegex, metadataStatus, titleKey } from './catalog-shared';

export const catalogRouter = Router();
catalogRouter.use(requireAuth, requireRole('SUPER_ADMIN', 'TRAINER'));

const difficulty = z.enum(['EASY', 'MEDIUM', 'HARD']);
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,100}$/);
const number = z.number().int().positive().max(99999999);
const metadata = z.object({
  problemNumber: number.optional(),
  title: z.string().trim().min(1).max(150),
  slug: slug.optional(),
  url: z.string().trim().max(300),
  difficulty: z.string().trim().toUpperCase().pipe(difficulty),
  topics: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  isPremium: z.boolean().optional(),
}).strict();

function normalize(input: unknown, source: string) {
  const row = parse(metadata, input);
  const canonical = parseLeetCodeUrl(row.url);
  if (row.slug && row.slug !== canonical.slug) throw badRequest('Slug must match the LeetCode URL');
  const topics = [...new Set(row.topics.map(titleKey))];
  return {
    ...row, ...canonical, titleKey: titleKey(row.title), topics, source, platform: 'leetcode',
    metadataStatus: metadataStatus({ problemNumber: row.problemNumber, topics, isPremium: row.isPremium }),
  };
}

catalogRouter.get('/', async (req, res) => {
  const q = parse(pagination.extend({
    q: z.string().trim().max(300).optional(),
    topic: z.string().trim().max(60).optional(),
    difficulty: difficulty.optional(),
    premium: z.enum(['true', 'false']).optional(),
  }), req.query);
  const filter: Record<string, unknown> = {};
  if (q.difficulty) filter.difficulty = q.difficulty;
  if (q.topic) filter.topics = titleKey(q.topic);
  if (q.premium) filter.isPremium = q.premium === 'true';

  // Local search only: number, slug, URL, title and topics. LeetCode is never contacted here.
  const key = q.q ? titleKey(q.q) : undefined;
  const numeric = key && /^\d+$/.test(key) ? Number(key) : undefined;
  let urlSlug: string | undefined;
  if (q.q?.includes('://')) {
    try { urlSlug = parseLeetCodeUrl(q.q).slug; } catch { urlSlug = undefined; }
  }
  if (key) {
    const regex = escapeRegex(key);
    const clauses: Record<string, unknown>[] = [{ slug: key }, { titleKey: { $regex: `^${regex}` } }, { titleKey: { $regex: regex } }, { topics: key }];
    if (numeric !== undefined) clauses.push({ problemNumber: numeric });
    if (urlSlug) clauses.push({ slug: urlSlug });
    filter.$or = clauses;
  }

  const skip = (q.page - 1) * q.pageSize;
  let items: Record<string, unknown>[];
  let total: number;
  if (key) {
    // Rank: exact number, exact slug/URL, exact title, title prefix, partial title, topic match.
    const branches: Record<string, unknown>[] = [];
    if (numeric !== undefined) branches.push({ case: { $eq: ['$problemNumber', numeric] }, then: 0 });
    branches.push({ case: { $in: ['$slug', [...new Set([urlSlug, key].filter((value): value is string => !!value))]] }, then: 1 });
    const regex = escapeRegex(key);
    branches.push({ case: { $eq: ['$titleKey', key] }, then: 2 });
    branches.push({ case: { $regexMatch: { input: '$titleKey', regex: `^${regex}` } }, then: 3 });
    branches.push({ case: { $regexMatch: { input: '$titleKey', regex } }, then: 4 });
    branches.push({ case: { $in: [key, { $ifNull: ['$topics', []] }] }, then: 5 });
    const [result] = await CatalogProblem.aggregate<{ items: Record<string, unknown>[]; total: { count: number }[] }>([
      { $match: filter },
      { $addFields: { _rank: { $switch: { branches, default: 6 } } } },
      { $sort: { _rank: 1, problemNumber: 1, titleKey: 1, _id: 1 } },
      { $facet: {
        items: [{ $skip: skip }, { $limit: q.pageSize }, { $project: { _rank: 0 } }],
        total: [{ $count: 'count' }],
      } },
    ]);
    items = result?.items ?? [];
    total = result?.total[0]?.count ?? 0;
  } else {
    [items, total] = await Promise.all([
      CatalogProblem.find(filter).sort({ problemNumber: 1, titleKey: 1, _id: 1 }).skip(skip).limit(q.pageSize).lean(),
      CatalogProblem.countDocuments(filter),
    ]);
  }
  const [catalogTotal, numbered] = await Promise.all([
    CatalogProblem.countDocuments(),
    CatalogProblem.countDocuments({ problemNumber: { $exists: true } }),
  ]);
  res.json({ items, total, catalogTotal, numbered, page: q.page, pageSize: q.pageSize });
});

catalogRouter.post('/resolve', async (req, res) => {
  const { input } = parse(z.object({ input: z.string().trim().min(1).max(16000) }).strict(), req.body);
  const identifiers = input.split(/[,\n\r]+/).map((part) => part.trim()).filter(Boolean)
    .flatMap((part) => /^\d+(\s+\d+)+$/.test(part) ? part.split(/\s+/) : [part]);
  if (!identifiers.length || identifiers.length > 100) throw badRequest('Enter between 1 and 100 problem identifiers');
  const lookups = identifiers.map((identifier) => {
    const key = titleKey(identifier);
    if (/^\d+$/.test(key)) return { identifier, number: Number(key) };
    if (key.includes('://')) {
      try { return { identifier, slug: parseLeetCodeUrl(identifier).slug }; }
      catch { return { identifier, invalid: true }; }
    }
    return { identifier, text: key };
  });
  const numbers = lookups.flatMap((row) => row.number === undefined ? [] : [row.number]);
  const slugs = lookups.flatMap((row) => row.slug ?? row.text ?? []);
  const titles = lookups.flatMap((row) => row.text ?? []);
  const entries = await CatalogProblem.find({ $or: [
    { problemNumber: { $in: numbers } }, { slug: { $in: slugs } }, { titleKey: { $in: titles } },
  ] }).lean();
  const seen = new Set<string>();
  const rows = lookups.map((row) => {
    const { identifier } = row;
    if (row.invalid) return { identifier, status: 'INVALID_URL' };
    const matches = entries.filter((entry) => row.number !== undefined ? entry.problemNumber === row.number
      : row.slug ? entry.slug === row.slug : entry.slug === row.text || entry.titleKey === row.text);
    if (!matches.length) return { identifier, status: 'UNRECOGNIZED' };
    if (matches.length > 1) return { identifier, status: 'AMBIGUOUS' };
    const problem = matches[0];
    const status = seen.has(problem.slug) ? 'DUPLICATE' : 'MATCHED';
    seen.add(problem.slug);
    return { identifier, status, problem };
  });
  res.json({ rows });
});

// Trainers and Super Admins may add a missing problem by hand; nothing is fetched from LeetCode.
catalogRouter.post('/', async (req, res) => {
  const problem = await CatalogProblem.create(normalize(req.body, 'MANUAL'));
  await audit(req, 'catalog.create', { type: 'CatalogProblem', id: problem._id });
  res.status(201).json(problem);
});

catalogRouter.get('/template', requireRole('SUPER_ADMIN'), (_req, res) => {
  res.attachment('problem-catalog-template.csv').type('text/csv').send(toCsv(
    ['problemNumber', 'title', 'slug', 'difficulty', 'url', 'topics', 'isPremium'], [],
  ));
});

catalogRouter.post('/import', requireRole('SUPER_ADMIN'), async (req, res) => {
  const input = parse(z.object({
    csv: z.string().max(900000).optional(),
    rows: z.array(z.unknown()).min(1).max(MAX_CSV_ROWS).optional(),
    source: z.string().trim().min(1).max(150),
    apply: z.boolean().default(false),
    update: z.boolean().default(false),
  }).strict(), req.body);
  if ((input.csv === undefined) === (input.rows === undefined)) throw badRequest('Supply exactly one CSV or JSON dataset');
  const rows = input.rows ?? parseCsv(input.csv!).map((row) => ({
    title: row.title, slug: row.slug || undefined, url: row.url, difficulty: row.difficulty,
    problemNumber: row.problemnumber ? Number(row.problemnumber) : undefined,
    topics: row.topics ? row.topics.split(';') : [],
    isPremium: row.ispremium ? (/^(true|false)$/i.test(row.ispremium) ? row.ispremium.toLowerCase() === 'true' : row.ispremium) : undefined,
  }));
  const seenSlugs = new Set<string>();
  const seenNumbers = new Set<number>();
  const results = [];
  for (const [index, raw] of rows.entries()) {
    const row = index + 1;
    try {
      const entry = normalize(raw, input.source);
      if (seenSlugs.has(entry.slug) || (entry.problemNumber !== undefined && seenNumbers.has(entry.problemNumber))) {
        results.push({ row, slug: entry.slug, status: 'DUPLICATE_IN_FILE' });
        continue;
      }
      seenSlugs.add(entry.slug);
      if (entry.problemNumber !== undefined) seenNumbers.add(entry.problemNumber);
      const existing = await CatalogProblem.findOne({ slug: entry.slug }).lean();
      const numberOwner = entry.problemNumber === undefined ? null : await CatalogProblem.exists({ problemNumber: entry.problemNumber, slug: { $ne: entry.slug } });
      if (numberOwner || (existing?.problemNumber !== undefined && entry.problemNumber !== undefined && existing.problemNumber !== entry.problemNumber)) {
        results.push({ row, slug: entry.slug, status: 'NUMBER_CONFLICT' });
        continue;
      }
      const status = existing ? input.update ? 'UPDATE' : 'SKIP_EXISTING' : 'INSERT';
      if (input.apply && status === 'INSERT') await CatalogProblem.create(entry);
      if (input.apply && existing && status === 'UPDATE') {
        const updated = await CatalogProblem.updateOne({ _id: existing._id, updatedAt: existing.updatedAt }, { $set: entry });
        if (!updated.matchedCount) {
          results.push({ row, slug: entry.slug, status: 'CONCURRENT_CHANGE' });
          continue;
        }
      }
      results.push({ row, slug: entry.slug, status });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const duplicate = 'code' in error && error.code === 11000;
      const invalid = 'status' in error && error.status === 400;
      if (!duplicate && !invalid) throw error;
      results.push({ row, status: duplicate ? 'CONCURRENT_CONFLICT' : 'INVALID', message: duplicate ? 'Catalog changed during import' : error.message, details: 'details' in error ? error.details : undefined });
    }
  }
  const counts = summarize(results);
  const errors = results.filter((row) => !['INSERT', 'UPDATE', 'SKIP_EXISTING'].includes(row.status));
  const errorCsv = errors.length ? toCsv(['row', 'slug', 'status', 'message'], errors.map((row) => [row.row, row.slug, row.status, row.message])) : null;
  if (input.apply) await audit(req, 'catalog.import', undefined, { source: input.source, rows: rows.length, update: input.update, counts });
  res.json({ applied: input.apply, counts, rows: results, errorCsv });
});

function summarize(rows: { status: string }[]) {
  return rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    return counts;
  }, {});
}

catalogRouter.post('/chapters/:id/assign', async (req, res) => {
  if (!canManageCourses(req.user!)) throw forbidden('Course management permission required');
  const chapterId = parse(objectId, req.params.id);
  const { ids } = parse(z.object({ ids: z.array(objectId).min(1).max(100) }).strict(), req.body);
  const ordered = [...new Set(ids)];
  if (!(await supportsTransactions())) throw badRequest('Bulk assignment requires a MongoDB replica set');
  const result = await maybeTransaction(async (session) => {
    const chapter = await Chapter.findOneAndUpdate(
      { _id: chapterId, status: 'ACTIVE' }, { $currentDate: { updatedAt: true } }, { session, timestamps: false },
    );
    if (!chapter) throw notFound('Active chapter not found');
    const entries = await CatalogProblem.find({ _id: { $in: ordered } }).session(session ?? null).lean();
    const byId = new Map(entries.map((entry) => [String(entry._id), entry]));
    if (byId.size !== ordered.length) throw badRequest('One or more catalog entries are unavailable');
    const existing = await Problem.find({ chapterId, status: 'ACTIVE', slug: { $in: entries.map((entry) => entry.slug) } })
      .session(session ?? null).select('slug').lean();
    const assigned = new Set(existing.map((entry) => entry.slug));
    const last = await Problem.findOne({ chapterId }).sort({ order: -1 }).session(session ?? null).select('order').lean();
    const additions = ordered.map((id) => byId.get(id)!).filter((entry) => !assigned.has(entry.slug));
    if (additions.length) await Problem.insertMany(additions.map((entry, index) => ({
      chapterId, courseId: chapter.courseId, catalogId: entry._id, slug: entry.slug, url: entry.url,
      title: entry.title, difficulty: entry.difficulty, order: (last?.order ?? -1) + index + 1,
    })), { session });
    return { added: additions.length, alreadyAssigned: existing.length, duplicateSelections: ids.length - ordered.length };
  });
  if (result.added) await audit(req, 'catalog.assign', { type: 'Chapter', id: chapterId }, result);
  res.json(result);
});
