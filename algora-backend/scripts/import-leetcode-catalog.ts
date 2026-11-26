import mongoose from 'mongoose';
import { importCatalog, loadDataset, summarizeProblems } from '../src/modules/catalog/catalog-dataset';

/**
 * Import the versioned dataset into the MongoDB problem catalog.
 *   npm run catalog:import:dry-run   # report only, no writes
 *   npm run catalog:import           # bulk upsert (idempotent)
 *
 * Reads MONGODB_URI from the environment, like the migration scripts.
 */
async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const dryRun = !apply;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');

  const { loaded, issues } = loadDataset();
  const summary = summarizeProblems(loaded.problems);
  console.log(JSON.stringify({
    datasetVersion: loaded.metadata.datasetVersion,
    checksum: loaded.checksum,
    sourceUrl: loaded.metadata.sourceUrl,
    license: loaded.metadata.license,
    ...summary,
  }, null, 2));
  if (issues.length) {
    for (const issue of issues.slice(0, 50)) console.error(`Invalid: ${issue.slug ?? `record ${issue.index}`} — ${issue.message}`);
    throw new Error(`Refusing to import: dataset has ${issues.length} issue(s)`);
  }
  if (dryRun) console.log('Dry run: no database writes will be made.');

  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
  try {
    const result = await importCatalog(loaded.problems, { version: loaded.metadata.datasetVersion, dryRun });
    console.log(JSON.stringify(result, null, 2));
    if (result.counts.NUMBER_CONFLICT) {
      console.error(`${result.counts.NUMBER_CONFLICT} dataset record(s) skipped because another slug owns the problem number.`);
    }
    if (result.errors.length) process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Catalog import failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
