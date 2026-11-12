import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
describe('explicit provisioning command guard', () => {
  it('refuses noninteractive execution before attempting database work or printing the configured subject', async () => {
    let failure: unknown;
    try {
      await promisify(execFile)(
        process.execPath,
        [
          resolve('node_modules/tsx/dist/cli.mjs'),
          'src/scripts/provision-super-admin.ts',
        ],
        {
          env: {
            ...process.env,
            PROVISION_SUPER_ADMIN_SUBJECT: 'test-only-subject',
            LOG_LEVEL: 'silent',
          },
          timeout: 10000,
        },
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeDefined();
    const result = failure as { code: number; stdout: string; stderr: string };
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('interactive terminal');
    expect(result.stdout + result.stderr).not.toContain('test-only-subject');
  }, 15000);
});
