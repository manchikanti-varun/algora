import { describe, it, expect } from 'vitest';
import { apiGet, healthSchema } from '@/lib/api/client';

// Opt-in: requires the real backend listening at NEXT_PUBLIC_API_BASE_URL.
describe.runIf(process.env.RUN_CONNECTIVITY_TEST === 'true')(
  'live API connection',
  () => {
    it('calls the real health endpoint through the frontend client', async () => {
      expect(await apiGet('/health', healthSchema)).toEqual({
        service: 'algora-backend',
        status: 'ok',
      });
    });
  },
);
