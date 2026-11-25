/**
 * One-off, idempotent migration of LeetCode links from the old ownership-verification lifecycle to simplified account
 * linking. See src/modules/leetcode/link-migration.ts for the rules.
 *
 * Usage (from algora-backend):
 *   npm run migrate:leetcode-links            # dry run, prints a summary
 *   npm run migrate:leetcode-links -- --apply # writes changes
 * In production supply MONGODB_URI the way the server does (for example --env-file=.env.production).
 */
import mongoose from 'mongoose';
import { migrateLeetcodeLinks } from '../../src/modules/leetcode/link-migration';

const APPLY = process.argv.includes('--apply');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(uri, { autoCreate: false, autoIndex: false });
  const report = await migrateLeetcodeLinks(APPLY);
  const lines = Object.entries(report.counts).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `  ${k}: ${v}`);
  console.log(`${APPLY ? 'Applied' : 'DRY RUN (pass --apply to write)'} — migration summary:\n${lines.join('\n')}`);
  for (const conflict of report.conflicts) console.log(JSON.stringify(conflict));
  if (!APPLY) console.log('No documents were modified.');
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('Migration failed:', (e as Error).message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
