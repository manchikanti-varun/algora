import { beforeEach, it, expect } from 'vitest';
import { setupCoding, rawSubmission } from './coding-fixtures.js';
import { AppError } from '../middleware/errors.js';
let f: Awaited<ReturnType<typeof setupCoding>>;
beforeEach(async () => {
  f = await setupCoding();
  const a = await f.link();
  await f.verify(a.id);
});
it('deduplicates concurrent refresh requests into one durable active job', async () => {
  const results = await Promise.all([f.queue(), f.queue(), f.queue()]);
  expect(new Set(results.map((j) => j.id)).size).toBe(1);
  expect(f.repo.jobs.size).toBe(1);
});
it('claims a job only once across workers', async () => {
  await f.queue();
  const jobs = await Promise.all([
    f.repo.claim(f.getNow().toISOString(), 'worker-a'),
    f.repo.claim(f.getNow().toISOString(), 'worker-b'),
  ]);
  expect(jobs.filter(Boolean)).toHaveLength(1);
});
it('recovers expired leases with a fresh fencing token after restart', async () => {
  await f.queue();
  const claimed = (await f.repo.claim(f.getNow().toISOString(), 'crashed'))!;
  f.advance(60001);
  const recovered = (await f.repo.claim(
    f.getNow().toISOString(),
    'replacement',
  ))!;
  expect(recovered.id).toBe(claimed.id);
  expect(recovered.attempts).toBe(2);
  expect(
    await f.repo.read.saveJob(
      { ...claimed, status: 'SUCCEEDED', active: false },
      'crashed',
    ),
  ).toBe(false);
});
it('uses a durable shared provider reservation across independent workers', async () => {
  const now = f.getNow().toISOString();
  const reservations = await Promise.all([
    f.repo.reserveProvider(now, 'a'),
    f.repo.reserveProvider(now, 'b'),
  ]);
  expect(reservations.filter(Boolean)).toHaveLength(1);
  await f.repo.releaseProvider('wrong', now);
  expect(await f.repo.reserveProvider(now, 'c')).toBe(false);
  f.advance(30001);
  expect(await f.repo.reserveProvider(f.getNow().toISOString(), 'c')).toBe(
    true,
  );
});
it('requeues rate limited work without running the provider', async () => {
  await f.queue();
  await f.repo.reserveProvider(f.getNow().toISOString(), 'busy');
  await f.service.processOne();
  const job = [...f.repo.jobs.values()][0]!;
  expect(job.status).toBe('RETRY_WAIT');
  expect(job.error).toBe('PROVIDER_RATE_LIMITED');
  expect(f.calls()).toBe(0);
});
it('persists a page cursor and resumes after a new service/worker instance', async () => {
  f.setResponse({
    status: 'OK',
    result: Array.from({ length: 100 }, (_, i) =>
      rawSubmission(f.getNow(), { id: i + 1 }),
    ),
  });
  await f.queue();
  await f.service.processOne();
  const job = [...f.repo.jobs.values()][0]!;
  expect(job.offset).toBe(101);
  expect(job.pages).toBe(1);
  expect(job.status).toBe('RETRY_WAIT');
  f.advance(4000);
  f.setResponse({ status: 'OK', result: [] });
  await f.service.processOne();
  expect([...f.repo.jobs.values()][0]?.status).toBe('SUCCEEDED');
  expect(f.repo.evidence.size).toBe(100);
});
it('caps one backfill job at five pages and persists its continuation', async () => {
  f.setResponse({
    status: 'OK',
    result: Array.from({ length: 100 }, (_, i) =>
      rawSubmission(f.getNow(), { id: i + 1 }),
    ),
  });
  await f.queue();
  for (let i = 0; i < 5; i++) {
    await f.service.processOne();
    f.advance(4000);
  }
  const job = [...f.repo.jobs.values()][0]!;
  expect(job.status).toBe('PARTIAL');
  expect(job.offset).toBe(501);
  f.advance(61000);
  await f.queue();
  expect([...f.repo.jobs.values()].at(-1)?.offset).toBe(501);
});
it('does not treat malformed/pending evidence as a complete negative result', async () => {
  f.setResponse({
    status: 'OK',
    result: [rawSubmission(f.getNow(), { verdict: 'TESTING' })],
  });
  await f.queue();
  await f.service.processOne();
  expect(
    (await f.service.dashboard(f.student.user.id, f.batch, {})).items[0]
      ?.reason,
  ).toBe('HISTORY_NOT_FULLY_CHECKED');
  expect([...f.repo.jobs.values()][0]?.status).toBe('PARTIAL');
});
it('applies exponential bounded retry delays for transient failures', async () => {
  f.setProviderError(new AppError(503, 'PROVIDER_UNAVAILABLE', 'offline'));
  await f.queue();
  await f.service.processOne();
  const job = [...f.repo.jobs.values()][0]!;
  expect(job.status).toBe('RETRY_WAIT');
  expect(Date.parse(job.nextAt) - f.getNow().getTime()).toBeGreaterThanOrEqual(
    30000,
  );
  expect(Date.parse(job.nextAt) - f.getNow().getTime()).toBeLessThan(33001);
});
it('stops retrying after the bounded provider retry budget', async () => {
  f.setProviderError(new AppError(503, 'PROVIDER_UNAVAILABLE', 'offline'));
  await f.queue();
  for (let i = 0; i < 5; i++) {
    await f.service.processOne();
    f.advance(1000000);
  }
  expect([...f.repo.jobs.values()][0]?.status).toBe('FAILED');
});
it('enforces manual cooldown after completed syncs', async () => {
  await f.queue();
  await f.service.processOne();
  await expect(f.queue()).rejects.toMatchObject({ code: 'SYNC_COOLDOWN' });
});
it('rechecks curriculum identity before attribution', async () => {
  await f.queue();
  f.repo.curriculum.learning.batches.get(f.batch)!.curriculumRevisionId =
    'a'.repeat(24);
  await f.service.processOne();
  expect(f.repo.evidence.size).toBe(0);
  expect([...f.repo.jobs.values()][0]?.status).toBe('CANCELLED');
});
it('rechecks current Student eligibility after network fetch before commit', async () => {
  await f.queue();
  const original = f.repo.reserveProvider.bind(f.repo);
  f.repo.reserveProvider = async (now, token) => {
    const ok = await original(now, token);
    f.repo.curriculum.learning.students.profiles.get(
      f.student.profile.id,
    )!.verificationStatus = 'REJECTED';
    return ok;
  };
  await f.service.processOne();
  expect(f.repo.evidence.size).toBe(0);
  expect(f.repo.rows.size).toBe(0);
});
it('automatic scheduling uses the same queue and cooldown as manual sync', async () => {
  await f.service.schedule();
  expect(f.repo.jobs.size).toBe(1);
  await f.service.schedule();
  expect(f.repo.jobs.size).toBe(1);
});

it('bounds wide assignment reconciliation and resumes without losing accepted evidence', async () => {
  for (let i = 1; i < 151; i++) {
    const day = {
      ...structuredClone(f.frozen),
      id: i.toString(16).padStart(24, '0'),
      dayNumber: 100 + i,
    };
    f.repo.curriculum.frozen.set(day.id, day);
  }
  await f.queue();
  await f.service.processOne();
  expect(f.repo.rows.size).toBe(100);
  expect([...f.repo.jobs.values()][0]?.offset).toBe(1);
  expect([...f.repo.jobs.values()][0]?.status).toBe('RETRY_WAIT');
  f.advance(4000);
  await f.service.processOne();
  expect(f.repo.rows.size).toBe(151);
  expect(
    (await f.service.dashboard(f.student.user.id, f.batch, {})).summary.solved,
  ).toBe(151);
});
