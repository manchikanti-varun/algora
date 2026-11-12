import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
describe('HTTP foundation', () => {
  it('serves liveness without database', async () => {
    const r = await request(createApp()).get('/api/v1/health');
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('ok');
    expect(r.headers['x-request-id']).toBeTruthy();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
  it.each([true, false])(
    'reports dependency readiness %s',
    async (available) => {
      const r = await request(createApp(async () => available)).get(
        '/api/v1/ready',
      );
      expect(r.status).toBe(available ? 200 : 503);
      expect(r.body.success).toBe(available);
    },
  );
  it('sanitizes unexpected errors', async () => {
    const r = await request(
      createApp(async () => {
        throw Error('secret credential');
      }),
    ).get('/api/v1/ready');
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('secret');
  });
  it('returns consistent unknown route errors', async () => {
    const r = await request(createApp()).get('/unknown');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
  });
  it('rejects malformed JSON', async () => {
    const r = await request(createApp())
      .post('/unknown')
      .set('Content-Type', 'application/json')
      .send('{');
    expect(r.status).toBe(400);
  });
  it('rejects large payloads', async () => {
    const r = await request(createApp())
      .post('/unknown')
      .send({ value: 'a'.repeat(40000) });
    expect(r.status).toBe(413);
  });
  it('rejects unlisted origins', async () => {
    expect(
      (
        await request(createApp())
          .get('/api/v1/health')
          .set('Origin', 'https://unknown.example')
      ).status,
    ).toBe(403);
  });
  it('allows configured origin', async () => {
    const r = await request(createApp())
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:3000');
    expect(r.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
  });
  it('limits requests', async () => {
    const app = createApp();
    for (let i = 0; i < 120; i++) await request(app).get('/unknown');
    expect((await request(app).get('/unknown')).status).toBe(429);
  });
});
