import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { CatalogProblem, Problem } from '../src/models';
import { login, resetDb, startDb, stopDb, tok } from './helpers';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);

const admin = () => login(tok('sub-admin', 'admin@example.com', 'Admin'));
const binary = {
  problemNumber: 704, title: 'Binary Search', difficulty: 'Easy', slug: 'binary-search',
  url: 'https://leetcode.com/problems/binary-search/', topics: ['Array', 'Binary Search'], isPremium: false,
};
const twoSum = { problemNumber: 1, title: 'Two Sum', difficulty: 'Easy', url: 'https://leetcode.com/problems/two-sum/' };

it('validates import previews, persists valid rows and protects existing numbers', async () => {
  const { call } = await admin();
  const rows = [binary, binary, { ...twoSum, url: 'https://example.com/problems/two-sum/' }];
  const preview = await call('post', '/problem-library/import', { rows, source: 'Authorized fixture' });
  expect(preview.status).toBe(200);
  expect(preview.body.counts).toEqual({ INSERT: 1, DUPLICATE_IN_FILE: 1, INVALID: 1 });
  expect(preview.body.errorCsv).toContain('DUPLICATE_IN_FILE');
  expect(await CatalogProblem.countDocuments()).toBe(0);

  const csv = 'problemNumber,title,slug,difficulty,url,topics,isPremium\n704,Binary Search,binary-search,Easy,https://leetcode.com/problems/binary-search/,"Array;Binary Search",false';
  expect((await call('post', '/problem-library/import', { csv, source: 'Authorized fixture', apply: true })).body.counts).toEqual({ INSERT: 1 });
  expect((await call('post', '/problem-library/import', { csv, source: 'Authorized fixture', apply: true })).body.counts).toEqual({ SKIP_EXISTING: 1 });
  expect((await call('post', '/problem-library/import', {
    rows: [{ ...twoSum, problemNumber: 704 }], source: 'Authorized fixture', apply: true,
  })).body.counts).toEqual({ NUMBER_CONFLICT: 1 });
  expect(await CatalogProblem.countDocuments()).toBe(1);
});

it('looks up the frontend problem number, title, topic and canonical URL', async () => {
  const { call } = await admin();
  expect((await call('post', '/problem-library', binary)).status).toBe(201);
  for (const query of ['704', 'nary sear', 'https://www.leetcode.com/problems/BINARY-SEARCH/description/']) {
    const result = await call('get', '/problem-library?q=' + encodeURIComponent(query));
    expect(result.body.items).toHaveLength(1);
    expect(result.body.items[0]).toMatchObject({ slug: 'binary-search', isPremium: false });
  }
  expect((await call('get', '/problem-library?topic=Binary%20Search&difficulty=EASY&premium=false')).body.total).toBe(1);
  expect((await call('get', '/problem-library?premium=true')).body.total).toBe(0);

  const result = await call('post', '/problem-library/resolve', { input: '704, Binary Search, 999, https://example.com/' });
  expect(result.body.rows.map((row: { status: string }) => row.status)).toEqual(['MATCHED', 'DUPLICATE', 'UNRECOGNIZED', 'INVALID_URL']);
});

it('appends catalog assignments in input order and deduplicates concurrent requests', async () => {
  const { call } = await admin();
  const course = (await call('post', '/courses', { title: 'DSA' })).body;
  const chapter = (await call('post', `/courses/${course._id}/chapters`, { title: 'Arrays' })).body;
  const a = (await call('post', '/problem-library', binary)).body;
  const b = (await call('post', '/problem-library', twoSum)).body;
  const path = `/problem-library/chapters/${chapter._id}/assign`;
  const request = () => call('post', path, { ids: [a._id, b._id, a._id] });
  const results = await Promise.all([request(), request()]);
  expect(results.map((result) => result.status)).toEqual([200, 200]);
  expect(results.map((result) => result.body.added).sort()).toEqual([0, 2]);
  const assignments = await Problem.find({ chapterId: chapter._id }).sort({ order: 1 }).lean();
  expect(assignments.map((row) => row.slug)).toEqual(['binary-search', 'two-sum']);
  expect(assignments.map((row) => String(row.catalogId))).toEqual([a._id, b._id]);
  const edited = await call('patch', `/problems/${assignments[0]._id}`, { title: 'Search a sorted array', url: binary.url });
  expect(edited.body.catalogId).toBe(a._id);
  expect((await call('patch', `/problems/${assignments[0]._id}`, { status: 'ARCHIVED' })).status).toBe(200);
  expect(await CatalogProblem.countDocuments()).toBe(2);
});

it('copies, moves and archives assignments without deleting catalog entries', async () => {
  const { call } = await admin();
  const course = (await call('post', '/courses', { title: 'Practice' })).body;
  const source = (await call('post', `/courses/${course._id}/chapters`, { title: 'Source' })).body;
  const target = (await call('post', `/courses/${course._id}/chapters`, { title: 'Destination' })).body;
  const entry = (await call('post', '/problem-library', binary)).body;
  await call('post', `/problem-library/chapters/${source._id}/assign`, { ids: [entry._id] });
  const original = await Problem.findOne({ chapterId: source._id }).orFail();
  const path = `/chapters/${source._id}/problems/bulk`;
  const ids = [String(original._id)];
  const transfer = { ids, targetChapterId: target._id };
  expect((await call('post', path, { ...transfer, action: 'copy' })).body).toEqual({ added: 1, archived: 0, skipped: 0 });
  expect((await call('post', path, { ...transfer, action: 'move' })).body).toEqual({ added: 0, archived: 0, skipped: 1 });
  expect((await Problem.findById(original._id))?.status).toBe('ACTIVE');
  const duplicate = await Problem.findOne({ chapterId: target._id }).orFail();
  expect((await call('post', path, { action: 'archive', ids: [String(duplicate._id)] })).status).toBe(400);
  expect((await call('post', `/chapters/${target._id}/problems/bulk`, { action: 'archive', ids: [String(duplicate._id)] })).body.archived).toBe(1);
  expect((await call('post', path, { ...transfer, action: 'move' })).body).toEqual({ added: 1, archived: 1, skipped: 0 });
  expect((await call('post', path, { ...transfer, action: 'move' })).body).toEqual({ added: 0, archived: 0, skipped: 1 });
  expect((await call('get', `/chapters/${target._id}/problems/export`)).text).toContain('Binary Search,EASY,binary-search');
  expect(await CatalogProblem.countDocuments()).toBe(1);
});
