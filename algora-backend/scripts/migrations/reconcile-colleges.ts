/**
 * Read-only college registry audit, plus explicit, idempotent merges of known duplicates.
 *
 * Usage (from algora-backend, with the same MONGODB_URI the server uses):
 *   npm run migrate:colleges                                             # dry run: legacy codes + duplicate candidates
 *   npm run migrate:colleges -- --merge <duplicateId>:<canonicalId>      # dry run of one merge
 *   npm run migrate:colleges -- --merge <duplicateId>:<canonicalId> --apply
 *
 * Nothing is merged automatically and only explicitly listed pairs are touched. Merges archive the duplicate, move
 * student/batch references to the canonical college, and are audited. Re-running the same pair is a no-op.
 */
import mongoose from 'mongoose';
import { applyCollegeMerge, collegeRegistryReport, previewCollegeMerge } from '../../src/modules/colleges/reconcile';

const APPLY = process.argv.includes('--apply');
const pairs: [string, string][] = [];
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] !== '--merge') continue;
  const [source, target] = (process.argv[i + 1] ?? '').split(':');
  if (!source || !target) throw new Error(`Invalid --merge value "${process.argv[i + 1]}"; expected sourceId:canonicalId`);
  pairs.push([source, target]);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(uri, { autoCreate: false, autoIndex: false });

  const report = await collegeRegistryReport();
  console.log(`College registry report (${APPLY ? 'APPLY' : 'DRY RUN — pass --apply to write'})`);
  console.log(`  ${JSON.stringify(report.totals)}`);
  for (const college of report.colleges) console.log(`  college ${college._id} ${college.label} status=${college.status} students=${college.students} batches=${college.batches} aliases=${JSON.stringify(college.aliases)}`);
  for (const college of report.missingCodes) console.log(`  missing-code ${college._id} "${college.name}" students=${college.students} batches=${college.batches}`);
  for (const conflict of report.aliasConflicts) console.log(`  alias-conflict key=${conflict.key} ${conflict.colleges.map((c) => `${c._id}=${c.label}`).join(' | ')}`);
  for (const group of report.duplicateCandidates) {
    console.log(`  possible-duplicate key=${group.key} suggested=${group.suggestedTargetId}`);
    for (const college of group.colleges) console.log(`    ${college._id} ${college.label} status=${college.status} students=${college.students} batches=${college.batches}`);
  }
  for (const mapping of report.proposedMappings) console.log(`  proposed-merge ${mapping.sourceId}:${mapping.targetId} (${mapping.reason})`);
  for (const item of report.manualReview) console.log(`  manual-review ${item._id} ${item.label}: ${item.reason}`);
  if (!report.duplicateCandidates.length) console.log('  No same-name duplicate candidates. Nothing is merged automatically.');

  for (const [source, target] of pairs) {
    const preview = await previewCollegeMerge(source, target);
    const result = APPLY ? await applyCollegeMerge(source, target) : preview;
    console.log(`  merge ${JSON.stringify(result)}`);
  }
  if (!APPLY) console.log('No documents were modified.');
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('College reconciliation failed:', (error as Error).message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
