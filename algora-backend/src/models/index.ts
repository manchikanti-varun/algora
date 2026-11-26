export * from './student-request';
import { StudentRequest } from './student-request';
export * from './user';
export * from './org';
export * from './content';
export * from './progress';
export * from './settings';
import { User } from './user';
import * as org from './org';
import * as content from './content';
import * as progress from './progress';
import * as settings from './settings';

/** Build all indexes (used at startup and in tests). */
export async function syncAllIndexes() {
  const models = [User, StudentRequest, ...Object.values(org), ...Object.values(content), ...Object.values(progress), ...Object.values(settings)] as any[];
  await Promise.all(models.filter((m) => typeof m?.syncIndexes === 'function').map((m) => m.syncIndexes()));
}
