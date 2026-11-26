import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { CatalogProblem, Problem, User } from '../src/models';
import { importCatalog, loadDataset, validateDataset } from '../src/modules/catalog/catalog-dataset';
import { login, resetDb, startDb, stopDb } from './helpers';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);

const admin = () => login(`tok|sub-admin|admin@example.com|Admin`);
const trainer = async () => {
  await User.create({ googleSub: 't1', email: 'trainer@example.com', role: 'TRAINER', fullName: 'Trainer One', trainerId: 'tr_t1' });
  return login(`tok|t1|trainer@example.com|Trainer One`);
};
const entry = (over: Record<string, unknown> = {}) => ({
  problemNumber: 704, title: 'Binary Search', difficulty: 'EASY',
  url: 'https://leetcode.com/problems/binary-search/', topics: ['Array', 'Binary Search'], isPremium: false, ...over,
});

it('validates the committed dataset and its checksum', () => {
  const { loaded, issues } = loadDataset();
  expect(issues).toEqual([]);
  expect(loaded.problems).toHaveLength(3511);
  expect(loaded.metadata.totalProblems).toBe(loaded.problems.length);
  expect(loaded.problems.find((row) => row.id === 704)).toEqual({
    id: 704, title: 'Binary Search', slug: 'binary-search', difficulty: 'Easy',
    url: 'https://leetcode.com/problems/binary-search/', isPremium: false,
    topics: ['Array', 'Binary Search'], platform: 'leetcode',
  });
});

it('rejects invalid dataset records with reasons instead of guessing metadata', () => {
  const datasetRow = (over: Record<string, unknown> = {}) => ({
    id: 704, title: 'Binary Search', slug: 'binary-search', difficulty: 'Easy',
    url: 'https://leetcode.com/problems/binary-search/', isPremium: false, topics: ['Array'], platform: 'leetcode', ...over,
  });
  const { problems, issues } = validateDataset([
    datasetRow(),
    datasetRow({ id: 705 }),
    datasetRow({ id: 706, title: 'Mismatch', url: 'https://leetcode.com/problems/two-sum/' }),
    datasetRow({ id: 707, title: '', slug: 'empty-title', url: 'https://leetcode.com/problems/empty-title/' }),
    { ...datasetRow({ id: 708 }), description: 'full statement' },
  ]);
  expect(problems).toHaveLength(1);
  expect(issues).toHaveLength(4);
  expect(issues.map((issue) => issue.message)).toEqual([
    expect.stringContaining('Duplicate slug'),
    expect.stringContaining('URL and slug disagree'),
    expect.stringContaining('title'),
    expect.stringContaining('description'),
  ]);
});

it('imports idempotently, keeping assignments, custom problems and manual entries', async () => {
  const { call } = await admin();
  const { loaded } = loadDataset();
  const records = loaded.problems.filter((row) => row.id <= 5);

  const first = await importCatalog(records, { version: 'test-1', dryRun: false });
  expect(first.counts).toEqual({ INSERT: 5, UPDATE: 0, UNCHANGED: 0, NUMBER_CONFLICT: 0, WRITE_ERROR: 0 });
  expect(await CatalogProblem.countDocuments()).toBe(5);

  const course = (await call('post', '/courses', { title: 'DSA' })).body;
  const chapter = (await call('post', `/courses/${course._id}/chapters`, { title: 'Arrays' })).body;
  const catalog = await CatalogProblem.findOne({ slug: 'two-sum' }).lean();
  await call('post', `/problem-library/chapters/${chapter._id}/assign`, { ids: [String(catalog!._id)] });
  // A custom problem that is not part of any dataset.
  await Problem.create({
    chapterId: chapter._id, courseId: course._id, title: 'Custom warm-up', url: 'https://leetcode.com/problems/custom-warm-up/',
    slug: 'custom-warm-up', difficulty: 'EASY', order: 99,
  });
  await call('post', '/problem-library', entry({ problemNumber: 900001, slug: undefined, url: 'https://leetcode.com/problems/manual-extra/' }));

  const second = await importCatalog(records, { version: 'test-1', dryRun: false });
  expect(second.counts).toEqual({ INSERT: 0, UPDATE: 0, UNCHANGED: 5, NUMBER_CONFLICT: 0, WRITE_ERROR: 0 });
  expect(await CatalogProblem.countDocuments()).toBe(6);
  const assignment = await Problem.findOne({ slug: 'two-sum' }).lean();
  expect(assignment?.catalogId).toEqual(catalog!._id);
  expect(await Problem.exists({ slug: 'custom-warm-up' })).toBeTruthy();
  expect(await CatalogProblem.exists({ url: 'https://leetcode.com/problems/manual-extra/' })).toBeTruthy();
  expect(second.after?.catalogTotal).toBe(6);
});

it('does not overwrite a problem number that a different slug owns', async () => {
  const { call } = await admin();
  await call('post', '/problem-library', entry({ problemNumber: 704, title: 'Manual 704', url: 'https://leetcode.com/problems/manual-704/' }));
  const { loaded } = loadDataset();
  const result = await importCatalog(loaded.problems.filter((row) => row.id === 704), { version: 'test-1', dryRun: true });
  expect(result.counts.NUMBER_CONFLICT).toBe(1);
  expect(result.conflicts[0]).toEqual({ slug: 'binary-search', problemNumber: 704, existingSlug: 'manual-704' });
});

it('ranks exact number, slug/URL, title, prefix, partial title and topic matches in order', async () => {
  const { call } = await admin();
  for (const row of [
    entry(),
    entry({ problemNumber: 1, title: 'Two Sum', url: 'https://leetcode.com/problems/two-sum/', topics: ['Array', 'Hash Table'] }),
    entry({ problemNumber: 33, title: 'Search in Rotated Sorted Array', difficulty: 'MEDIUM', url: 'https://leetcode.com/problems/search-in-rotated-sorted-array/' }),
    entry({ problemNumber: 74, title: 'Search a 2D Matrix', difficulty: 'MEDIUM', url: 'https://leetcode.com/problems/search-a-2d-matrix/' }),
    entry({ problemNumber: 10, title: 'Regular Expression Matching', difficulty: 'HARD', url: 'https://leetcode.com/problems/regular-expression-matching/', topics: ['String', 'Dynamic Programming'], isPremium: true }),
  ]) expect((await call('post', '/problem-library', row)).status).toBe(201);

  const slugs = async (query: string, extra = '') =>
    (await call('get', `/problem-library?q=${encodeURIComponent(query)}${extra}`)).body.items.map((row: { slug: string }) => row.slug);

  expect((await slugs('704'))[0]).toBe('binary-search');
  expect((await slugs('two-sum'))[0]).toBe('two-sum');
  expect((await slugs('https://leetcode.com/problems/two-sum/description/'))[0]).toBe('two-sum');
  expect((await slugs('Two Sum'))[0]).toBe('two-sum');
  // Prefix matches rank above the partial title match (Binary Search), ordered by problem number.
  expect((await slugs('search')).slice(0, 3)).toEqual(['search-in-rotated-sorted-array', 'search-a-2d-matrix', 'binary-search']);
  expect((await slugs('nary sear'))[0]).toBe('binary-search');
  expect((await slugs('dynamic programming'))[0]).toBe('regular-expression-matching');

  const filtered = await call('get', '/problem-library?difficulty=HARD&premium=true&topic=Dynamic%20Programming');
  expect(filtered.body.items.map((row: { slug: string }) => row.slug)).toEqual(['regular-expression-matching']);
  expect((await call('get', '/problem-library?premium=false')).body.total).toBe(4);
  expect((await call('get', '/problem-library?q=search&pageSize=1')).body).toMatchObject({ total: 3, page: 1, pageSize: 1 });
  expect((await call('get', '/problem-library?q=search&pageSize=1&page=2')).body.items[0].slug).toBe('search-a-2d-matrix');
});

it('lets trainers add missing problems manually but not import datasets', async () => {
  const { call } = await trainer();
  const created = await call('post', '/problem-library', entry({
    problemNumber: 2, title: 'Add Two Numbers', url: 'https://leetcode.com/problems/add-two-numbers/',
    topics: ['Linked List', 'Math'], isPremium: false,
  }));
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({ slug: 'add-two-numbers', platform: 'leetcode', source: 'MANUAL' });
  expect((await call('get', '/problem-library?q=2')).body.items[0].slug).toBe('add-two-numbers');
  expect((await call('post', '/problem-library/import', {
    rows: [entry()], source: 'fixture', apply: false,
  })).status).toBe(403);
});
