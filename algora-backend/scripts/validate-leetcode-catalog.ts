import { compareDatasets, datasetDir, loadDataset, summarizeProblems, validateDataset } from '../src/modules/catalog/catalog-dataset';
import fs from 'node:fs';

/**
 * Validate the versioned catalog without touching MongoDB.
 *   npm run catalog:validate
 *   npm run catalog:validate -- --compare <previous-problems.json>
 */
function main() {
  const argv = process.argv.slice(2);
  const compareAt = argv.indexOf('--compare');
  const comparePath = compareAt === -1 ? undefined : argv[compareAt + 1];
  const { loaded, issues } = loadDataset();
  const summary = summarizeProblems(loaded.problems);
  const report: Record<string, unknown> = {
    dir: datasetDir(),
    datasetVersion: loaded.metadata.datasetVersion,
    sourceUrl: loaded.metadata.sourceUrl,
    license: loaded.metadata.license,
    retrievedAt: loaded.metadata.retrievedAt,
    lastUpdated: loaded.metadata.lastUpdated,
    checksum: loaded.checksum,
    fileBytes: loaded.bytes,
    fileSizeKb: Math.round(loaded.bytes / 102.4) / 10,
    ...summary,
    issues,
  };

  if (comparePath) {
    if (!fs.existsSync(comparePath)) throw new Error(`Comparison file not found: ${comparePath}`);
    const previous = validateDataset(JSON.parse(fs.readFileSync(comparePath, 'utf8')));
    if (previous.issues.length) {
      // A previous snapshot with issues can still be compared; report them so the diff is trustworthy.
      report.previousIssues = previous.issues.slice(0, 20);
    }
    const diff = compareDatasets(previous.problems, loaded.problems);
    report.diff = { added: diff.added, removed: diff.removed, modified: diff.modified };
    console.log(`Dataset diff against ${comparePath}`);
    console.log(`  added:    ${diff.added.length}`);
    console.log(`  removed:  ${diff.removed.length}`);
    console.log(`  modified: ${diff.modified.length}`);
    for (const row of diff.added.slice(0, 50)) console.log(`  + ${row.id} ${row.slug} — ${row.title}`);
    for (const row of diff.removed.slice(0, 50)) console.log(`  - ${row.id} ${row.slug} — ${row.title}`);
    for (const row of diff.modified.slice(0, 50)) console.log(`  ~ ${row.id} ${row.slug} (${row.fields.join(', ')})`);
    if (diff.added.length > 50 || diff.removed.length > 50 || diff.modified.length > 50) console.log('  …truncated');
  }

  console.log(JSON.stringify(report, null, 2));
  if (issues.length) {
    console.error(`Catalog dataset is invalid (${issues.length} issue${issues.length === 1 ? '' : 's'}).`);
    process.exitCode = 1;
  }
}

main();
